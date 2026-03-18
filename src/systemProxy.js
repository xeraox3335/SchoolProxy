'use strict';

const net = require('net');
const http = require('http');
const { URL } = require('url');

// ─── CONNECT tunnel (for HTTPS via system proxy) ─────────────────────────────

/**
 * Handler for HTTP CONNECT requests.
 * Called via server.on('connect', handleConnect).
 *
 * Establishes a raw TCP tunnel between the client and the target host so that
 * the client can perform its own TLS handshake; the proxy is transparent to the
 * HTTPS traffic.
 */
function handleConnect(req, clientSocket, head) {
  const [hostname, portStr] = req.url.split(':');
  const port = parseInt(portStr, 10) || 443;

  clientSocket.on('error', (err) => {
    console.error(`[SystemProxy] Client socket error (CONNECT ${req.url}): ${err.message}`);
  });

  const serverSocket = net.connect(port, hostname, () => {
    clientSocket.write(
      'HTTP/1.1 200 Connection Established\r\n' +
      'Proxy-Agent: SchoolProxy/1.0\r\n' +
      '\r\n'
    );

    // Forward any pipelined bytes that arrived with the CONNECT request
    if (head && head.length > 0) serverSocket.write(head);

    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.setTimeout(parseInt(process.env.TUNNEL_TIMEOUT_MS, 10) || 60_000);
  serverSocket.on('timeout', () => {
    console.warn(`[SystemProxy] Tunnel timeout for ${req.url}`);
    serverSocket.destroy();
    clientSocket.destroy();
  });
  serverSocket.on('error', (err) => {
    console.error(`[SystemProxy] Server socket error (CONNECT ${req.url}): ${err.message}`);
    if (clientSocket.writable) {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    }
    clientSocket.destroy();
  });
  serverSocket.on('end', () => clientSocket.destroy());
  clientSocket.on('end', () => serverSocket.destroy());
}

// ─── Plain-HTTP system proxy ──────────────────────────────────────────────────

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade', 'proxy-connection',
]);

/**
 * Handler for regular HTTP requests sent to the proxy in absolute-URI form
 * (e.g.  "GET http://example.com/path HTTP/1.1").
 * Should be used as a fallback Express middleware.
 */
function handleHttpProxy(req, res) {
  // Only handle absolute http:// URIs
  if (!req.url.startsWith('http://') && !req.url.startsWith('https://')) {
    res.writeHead(400);
    return res.end('Bad Request: absolute URI required');
  }

  let parsed;
  try {
    parsed = new URL(req.url);
  } catch {
    res.writeHead(400);
    return res.end('Bad Request: invalid URL');
  }

  const isHttps = parsed.protocol === 'https:';
  const client = isHttps ? require('https') : http;

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
  }
  headers['host'] = parsed.host;

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: req.method,
    headers,
    timeout: parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 30_000,
  };

  const proxyReq = client.request(options, (proxyRes) => {
    const responseHeaders = {};
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) responseHeaders[k] = v;
    }
    res.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`[SystemProxy] HTTP proxy error for ${req.url}: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502);
      res.end('Bad Gateway');
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy(new Error('Upstream timeout'));
  });

  req.pipe(proxyReq);
}

module.exports = { handleConnect, handleHttpProxy };
