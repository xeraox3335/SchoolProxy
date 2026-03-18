# SchoolProxy 🔒

A production-ready **dual-mode proxy server** built with Node.js that supports:

1. **Web proxy** – access any website via a URL parameter (`/?target=https://example.com`).  
   Every sub-resource (CSS, JS, images, XHR, fetch) is automatically redirected back through the proxy – no traffic ever leaves directly from the browser.
2. **System / Windows proxy** – configure your OS or browser to use the server as an HTTP proxy. HTTP CONNECT tunnelling is supported for HTTPS connections.

Both modes support many concurrent connections (Node.js event loop) and are ready for production deployment.

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Copy and edit the environment file (optional)
cp .env.example .env

# 3. Start the server
npm start
```

The server starts on **port 3000** by default (override with `PORT=…`).

---

## Web proxy

Open your browser and navigate to:

```
http://localhost:3000
```

Enter any URL in the form, or go directly to:

```
http://localhost:3000/?target=https://example.com
```

### How "no traffic outside the proxy" works

| Mechanism | What it covers |
|-----------|---------------|
| Server-side HTML rewriting (`cheerio`) | `<a href>`, `<img src>`, `<link href>`, `<script src>`, `<form action>`, `srcset`, `<meta refresh>`, inline `style=""`, `<style>` blocks |
| Server-side CSS rewriting (regex) | `url(…)` inside `.css` files |
| Client-side JS injection | `window.fetch`, `XMLHttpRequest`, `window.open` – all overridden to route through the proxy |
| Form submit listener | Rewrites `action` just before submission |
| Redirect rewriting | `301/302/…` Location headers are rewritten to proxy URLs |
| CSP removal | `Content-Security-Policy` meta tags and response headers are stripped so injected scripts are never blocked |
| SRI removal | `integrity` / `crossorigin` attributes are stripped to prevent resource-blocking |

---

## System proxy (Windows / macOS / Linux / browser)

Point your HTTP proxy settings to:

```
Host: <your-server-ip>
Port: 3000   (or whatever PORT is set to)
```

- **HTTP traffic** is forwarded directly.  
- **HTTPS traffic** uses the HTTP `CONNECT` method to create an encrypted tunnel – the proxy does not inspect TLS content.

### Windows (System Settings)

1. Settings → Network & Internet → Proxy  
2. Enable "Use a proxy server"  
3. Address: `localhost`, Port: `3000`

### Browser (Firefox)

1. Preferences → Network Settings → Manual proxy  
2. HTTP Proxy: `localhost`, Port: `3000`  
3. Check "Also use this proxy for HTTPS"

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Listening port |
| `LOG_FORMAT` | `combined` | Morgan log format |
| `RATE_LIMIT` | `true` | Set `false` to disable rate limiting |
| `RATE_LIMIT_MAX` | `2000` | Max requests per IP per minute |
| `REQUEST_TIMEOUT_MS` | `30000` | Upstream request timeout (ms) |
| `TUNNEL_TIMEOUT_MS` | `60000` | CONNECT tunnel idle timeout (ms) |
| `MAX_RESPONSE_SIZE` | `52428800` | Max buffered response size (bytes) |
| `REJECT_UNAUTHORIZED` | `true` | Set `false` to allow self-signed target certs |

---

## Production deployment

### Render.com

**Option A – one-click blueprint (recommended)**

A `render.yaml` blueprint is included. Click the button below to deploy directly from your fork:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

**Option B – manual setup via the Render dashboard**

1. Sign in at [render.com](https://render.com) and click **New → Web Service**.
2. Connect your GitHub account and select the **SchoolProxy** repository.
3. Fill in the service settings:
   - **Name**: `schoolproxy` (or any name you like)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free (or paid for always-on instances)
4. Under **Environment Variables**, add any overrides from the table below (all have sensible defaults).
5. Click **Create Web Service** – Render will build and deploy the app automatically.

> **Note:** Render's free tier spins the service down after a period of inactivity. The first request after a sleep period may take a little longer than usual. Upgrade to a paid plan if you need the proxy to stay always-on.

### Heroku / Railway

```bash
git push heroku main        # or connect the repo in Railway dashboard
```

A `Procfile` (`web: node server.js`) is included.

### Docker / Fly.io

```bash
docker build -t schoolproxy .
docker run -p 3000:3000 schoolproxy
```

Or deploy with `fly launch` (auto-detects the `Dockerfile`).

### Behind a reverse proxy (nginx / Caddy)

Set `PORT` to an internal port and let nginx handle TLS termination.  
The app reads `X-Forwarded-Proto` and `X-Forwarded-Host` for correct proxy URL construction.

---

## Architecture

```
server.js                    ← Express app + http.Server
├── GET /                    ← Homepage (URL input form)
├── POST /                   ← Form submit → redirect to /?target=…
├── ANY /?target=URL         ← Web proxy (src/webProxy.js)
│   ├── fetchUrl()           ← http/https built-in modules
│   ├── rewriteHtml()        ← cheerio-based DOM rewrite (src/urlRewriter.js)
│   ├── rewriteCss()         ← regex-based CSS rewrite
│   └── getInjectionScript() ← client-side JS override (src/injectionScript.js)
├── http.Server 'connect'    ← HTTPS CONNECT tunnel (src/systemProxy.js)
└── Fallback middleware      ← HTTP system proxy (src/systemProxy.js)
```

---

## Limitations

- **WebSockets** are not rewritten through the web proxy (they work through the system proxy).  
- **JavaScript-constructed URLs** that bypass `fetch`/`XHR` (e.g. `<img>` set via `document.createElement`) are covered by the injected script; highly obfuscated SPAs may need additional handling.  
- **Cookie isolation** – cookies from different proxied domains share the proxy's cookie jar; this is inherent to the web-proxy model.  
- **HTTP/2** is not supported upstream (Node.js `http` / `https` modules use HTTP/1.1).
