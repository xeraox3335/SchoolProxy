'use strict';

require('dotenv').config();

const http = require('http');
const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { handleConnect, handleHttpProxy } = require('./src/systemProxy');
const handleWebProxy = require('./src/webProxy');
const { getHomepage } = require('./src/homepage');

// ─── App setup ───────────────────────────────────────────────────────────────

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;

// Trust reverse-proxy headers (X-Forwarded-For, X-Forwarded-Proto, etc.)
// when deployed behind nginx / Heroku / Railway / Fly
app.set('trust proxy', 1);

// ── Security headers (tuned for proxy use) ──
app.use(
  helmet({
    contentSecurityPolicy: false,       // we manage CSP per-response in webProxy.js
    crossOriginEmbedderPolicy: false,   // required for loading cross-origin content
    crossOriginResourcePolicy: false,
  })
);

// ── Request logging ──
app.use(morgan(process.env.LOG_FORMAT || 'combined'));

// ── Rate limiting ──
// High ceiling so loading a single proxied page (dozens of sub-resources) doesn't trip it.
if (process.env.RATE_LIMIT !== 'false') {
  app.use(
    rateLimit({
      windowMs: 60 * 1000,          // 1-minute window
      max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 2000,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests – slow down and try again.' },
    })
  );
}

// ── Body parsing for the homepage form only ──
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ─── Routes ──────────────────────────────────────────────────────────────────

// Homepage: render the proxy UI when no ?target is provided
app.get('/', (req, res, next) => {
  if (req.query.target) return next(); // fall through to web-proxy middleware
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(getHomepage());
});

// Form submission: redirect to GET /?target=…
app.post('/', (req, res) => {
  let url = (req.body.url || req.body.target || '').trim();
  if (!url) return res.redirect('/');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  res.redirect(302, `/?target=${encodeURIComponent(url)}`);
});

// Web proxy: handles /?target=URL (any HTTP method)
app.use('/', handleWebProxy);

// System-proxy HTTP fallback: browser sent a full absolute URL as the request path
app.use((req, res, next) => {
  if (/^https?:\/\//i.test(req.url)) {
    return handleHttpProxy(req, res);
  }
  next();
});

// Generic 404
app.use((_req, res) => {
  res.status(404).send('Not found');
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('[Express]', err);
  if (!res.headersSent) res.status(500).send('Internal Server Error');
});

// ─── HTTP Server ─────────────────────────────────────────────────────────────

const server = http.createServer(app);

// CONNECT method → HTTPS tunnel (system proxy)
server.on('connect', handleConnect);

// ─── Graceful shutdown ───────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`\n[SchoolProxy] Received ${signal} – shutting down gracefully…`);
  server.close(() => {
    console.log('[SchoolProxy] Server closed. Bye!');
    process.exit(0);
  });
  // Force-exit after 10 s if connections don't drain
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ─── Start ───────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════╗
║           SchoolProxy  –  ready  🚀            ║
╠════════════════════════════════════════════════╣
║  Web proxy:                                    ║
║  http://localhost:${String(PORT).padEnd(27)}║
║  /?target=https://example.com                  ║
║                                                ║
║  System / Windows proxy:                       ║
║  Host: localhost   Port: ${String(PORT).padEnd(21)}║
║  (HTTP + HTTPS CONNECT tunnel)                 ║
╚════════════════════════════════════════════════╝`);
});
