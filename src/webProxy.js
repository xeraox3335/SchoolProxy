'use strict';

const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { URL } = require('url');
const { rewriteHtml, rewriteCss } = require('./urlRewriter');
const { getInjectionScript } = require('./injectionScript');

const MAX_RESPONSE_SIZE = parseInt(process.env.MAX_RESPONSE_SIZE, 10) || 50 * 1024 * 1024; // 50 MB
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 30_000;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Determine the proxy's own base URL from the incoming request. */
function getProxyBase(req) {
  const proto =
    req.headers['x-forwarded-proto'] ||
    (req.socket && req.socket.encrypted ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

/** Escape HTML entities (for safe error output). */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Make an outbound HTTP/HTTPS request to `targetUrl`.
 * Returns the raw IncomingMessage (caller is responsible for consuming it).
 */
function fetchUrl(targetUrl, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (err) {
      return reject(new Error(`Invalid URL: ${targetUrl}`));
    }

    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers,
      timeout: REQUEST_TIMEOUT_MS,
      // Allow self-signed certs on target (common in school environments)
      rejectUnauthorized: process.env.REJECT_UNAUTHORIZED !== 'false',
    };

    const req = client.request(options, resolve);
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`Upstream request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    if (body && body.length) req.write(body);
    req.end();
  });
}

/** Return a decompressed readable stream for a response. */
function decompress(res) {
  const enc = (res.headers['content-encoding'] || '').toLowerCase();
  if (enc === 'gzip') return res.pipe(zlib.createGunzip());
  if (enc === 'br') return res.pipe(zlib.createBrotliDecompress());
  if (enc === 'deflate') return res.pipe(zlib.createInflate());
  return res;
}

/** Buffer a readable stream. Rejects if it exceeds MAX_RESPONSE_SIZE. */
function bufferStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    stream.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_RESPONSE_SIZE) {
        reject(new Error('Upstream response too large'));
        stream.destroy();
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/**
 * Build the request headers to send upstream.
 * Strips hop-by-hop and proxy-specific headers; sets a realistic User-Agent.
 */
function buildUpstreamHeaders(req, targetUrl) {
  const parsed = new URL(targetUrl);
  const HOP_BY_HOP = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailers', 'transfer-encoding', 'upgrade',
    'proxy-connection',
  ]);

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
  }
  // Override host to match the target
  headers['host'] = parsed.host;
  // Accept decompressed responses so we can inspect/rewrite them
  headers['accept-encoding'] = 'gzip, deflate, br';
  // Provide a realistic user-agent if absent
  if (!headers['user-agent']) {
    headers['user-agent'] =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  }
  return headers;
}

/**
 * Rewrite Set-Cookie headers so they work on the proxy origin.
 * Strips Domain and Secure attributes (proxy is HTTP during dev).
 */
function rewriteSetCookies(cookies) {
  if (!Array.isArray(cookies)) cookies = [cookies];
  return cookies.map((c) =>
    c
      .replace(/;\s*domain=[^;]*/gi, '')
      .replace(/;\s*samesite=[^;]*/gi, '; SameSite=Lax')
  );
}

// ─── Main handler ────────────────────────────────────────────────────────────

/**
 * Express middleware: handles `GET|POST|… /?target=URL` web-proxy requests.
 * Calls next() if no ?target param is present (so the homepage can render).
 */
async function handleWebProxy(req, res, next) {
  const targetUrl = req.query.target;
  if (!targetUrl) return next();

  // ---- Validate target URL ----
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return res.status(400).send('Invalid target URL');
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return res.status(400).send('Only http and https targets are supported');
  }

  const proxyBase = getProxyBase(req);

  try {
    // ---- Collect request body for write methods ----
    let body = null;
    if (['POST', 'PUT', 'PATCH'].includes(req.method.toUpperCase())) {
      body = await bufferStream(req);
    }

    const upstreamHeaders = buildUpstreamHeaders(req, targetUrl);
    const upstreamRes = await fetchUrl(targetUrl, {
      method: req.method,
      headers: upstreamHeaders,
      body,
    });

    // ---- Follow / rewrite redirects ----
    if ([301, 302, 303, 307, 308].includes(upstreamRes.statusCode)) {
      const loc = upstreamRes.headers.location;
      if (loc) {
        const resolved = new URL(loc, targetUrl).href;
        upstreamRes.resume(); // discard body
        return res.redirect(302, `${proxyBase}/?target=${encodeURIComponent(resolved)}`);
      }
    }

    // ---- Build safe response headers ----
    const PASSTHROUGH_HEADERS = [
      'content-type', 'cache-control', 'expires', 'last-modified', 'etag',
      'accept-ranges',
    ];
    const responseHeaders = {};
    for (const h of PASSTHROUGH_HEADERS) {
      if (upstreamRes.headers[h]) responseHeaders[h] = upstreamRes.headers[h];
    }
    // Rewrite cookies
    if (upstreamRes.headers['set-cookie']) {
      responseHeaders['set-cookie'] = rewriteSetCookies(upstreamRes.headers['set-cookie']);
    }
    // Permissive CSP on the proxy side so our injected script works
    responseHeaders['content-security-policy'] =
      "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:";

    // ---- Determine content type ----
    const ct = (upstreamRes.headers['content-type'] || '').toLowerCase();
    const isHtml = ct.includes('text/html');
    const isCss = ct.includes('text/css');

    if (isHtml || isCss) {
      // Decompress & buffer so we can rewrite
      const bodyStream = decompress(upstreamRes);
      const buf = await bufferStream(bodyStream);
      const text = buf.toString('utf-8');

      let rewritten;
      if (isHtml) {
        const script = getInjectionScript(proxyBase);
        rewritten = rewriteHtml(text, targetUrl, proxyBase, script);
      } else {
        rewritten = rewriteCss(text, targetUrl, proxyBase);
      }

      // content-encoding was handled by decompress(); don't forward it
      delete responseHeaders['content-encoding'];
      responseHeaders['content-length'] = Buffer.byteLength(rewritten, 'utf-8');

      res.writeHead(upstreamRes.statusCode, responseHeaders);
      res.end(rewritten);
    } else {
      // Stream binary / non-text content (images, fonts, JS, etc.)
      if (upstreamRes.headers['content-length']) {
        responseHeaders['content-length'] = upstreamRes.headers['content-length'];
      }
      if (upstreamRes.headers['content-encoding']) {
        responseHeaders['content-encoding'] = upstreamRes.headers['content-encoding'];
      }
      res.writeHead(upstreamRes.statusCode, responseHeaders);
      upstreamRes.pipe(res);
    }
  } catch (err) {
    console.error(`[WebProxy] Error proxying ${targetUrl}: ${err.message}`);
    if (!res.headersSent) {
      res.status(502).send(`<!DOCTYPE html>
<html>
<head><title>Proxy Error</title>
<style>body{font-family:sans-serif;max-width:600px;margin:60px auto;padding:20px;}
h2{color:#c00;}code{background:#f4f4f4;padding:2px 6px;border-radius:3px;}</style>
</head>
<body>
  <h2>⚠ Proxy Error</h2>
  <p>Could not fetch: <code>${escapeHtml(targetUrl)}</code></p>
  <p>Reason: <code>${escapeHtml(err.message)}</code></p>
  <p><a href="/">← Back to proxy</a></p>
</body>
</html>`);
    }
  }
}

module.exports = handleWebProxy;
