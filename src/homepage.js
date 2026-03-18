'use strict';

/** Returns the HTML for the proxy homepage. */
function getHomepage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SchoolProxy</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      padding: 48px 40px 36px;
      width: 100%;
      max-width: 520px;
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
    }
    .logo { font-size: 42px; margin-bottom: 12px; }
    h1 { color: #e0e0e0; font-size: 26px; font-weight: 700; margin-bottom: 6px; }
    .subtitle { color: #888; font-size: 14px; margin-bottom: 32px; }
    form { display: flex; gap: 10px; }
    input[type="text"] {
      flex: 1;
      padding: 13px 16px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      color: #e0e0e0;
      font-size: 15px;
      outline: none;
      transition: border-color 0.2s, background 0.2s;
    }
    input[type="text"]::placeholder { color: #555; }
    input[type="text"]:focus {
      border-color: #4a9eff;
      background: rgba(74, 158, 255, 0.08);
    }
    button {
      padding: 13px 22px;
      background: linear-gradient(135deg, #4a9eff, #6e5aeb);
      color: white;
      border: none;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: opacity 0.2s, transform 0.1s;
    }
    button:hover { opacity: 0.88; }
    button:active { transform: scale(0.97); }
    .divider { border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 28px 0 20px; }
    .info { font-size: 13px; color: #666; line-height: 1.7; }
    .info strong { color: #999; }
    code {
      background: rgba(255,255,255,0.07);
      padding: 1px 6px;
      border-radius: 4px;
      font-family: 'Fira Mono', 'Courier New', monospace;
      font-size: 12px;
      color: #aaa;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      margin-right: 4px;
    }
    .badge-web { background: rgba(74, 158, 255, 0.2); color: #4a9eff; }
    .badge-sys { background: rgba(110, 90, 235, 0.2); color: #a58fff; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🔒</div>
    <h1>SchoolProxy</h1>
    <p class="subtitle">Anonymous, fast web proxy</p>

    <form method="POST" action="/">
      <input type="text" name="url" placeholder="https://example.com" autofocus
             autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" />
      <button type="submit">Browse</button>
    </form>

    <hr class="divider">

    <div class="info">
      <p><span class="badge badge-web">WEB</span>
         <strong>Web Proxy</strong> – access any site via URL parameter:<br>
         <code>/?target=https://example.com</code>
      </p>
      <br>
      <p><span class="badge badge-sys">SYS</span>
         <strong>System Proxy</strong> – configure your OS / browser to use
         this server as an HTTP proxy on port <code>PORT</code>.
         All HTTP and HTTPS traffic will be tunnelled through it.
      </p>
    </div>
  </div>
</body>
</html>`;
}

module.exports = { getHomepage };
