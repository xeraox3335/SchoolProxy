'use strict';

const cheerio = require('cheerio');

/**
 * Resolve a potentially-relative URL against a base URL.
 * Returns null if the URL should not be rewritten (data URIs, anchors, etc.).
 */
function resolveUrl(base, relative) {
  if (!relative || typeof relative !== 'string') return null;
  const trimmed = relative.trim();
  // Skip non-rewritable schemes and bare anchors
  if (/^(data:|javascript:|mailto:|tel:|blob:|#)/i.test(trimmed)) return relative;
  try {
    return new URL(trimmed, base).href;
  } catch {
    return null;
  }
}

/**
 * Convert an absolute target URL into a proxy URL.
 */
function toProxyUrl(targetUrl, proxyBase) {
  if (!targetUrl) return '#';
  if (/^(data:|javascript:|mailto:|tel:|blob:|#)/i.test(targetUrl)) return targetUrl;
  return `${proxyBase}/?target=${encodeURIComponent(targetUrl)}`;
}

/**
 * Rewrite a single HTML attribute in-place (mutates el.attribs).
 */
function rewriteAttr(el, attr, baseUrl, proxyBase) {
  const val = el.attribs && el.attribs[attr];
  if (!val) return;
  const resolved = resolveUrl(baseUrl, val);
  if (resolved && resolved !== val) {
    el.attribs[attr] = toProxyUrl(resolved, proxyBase);
  } else if (resolved === val && /^https?:\/\//i.test(val)) {
    // already absolute – still wrap through proxy
    el.attribs[attr] = toProxyUrl(val, proxyBase);
  }
}

/**
 * Rewrite CSS text: url(…) → url("proxyBase/?target=encodedUrl")
 */
function rewriteCss(css, baseUrl, proxyBase) {
  return css.replace(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi, (match, quote, url) => {
    if (/^(data:|#)/i.test(url)) return match;
    const resolved = resolveUrl(baseUrl, url);
    if (!resolved) return match;
    return `url("${toProxyUrl(resolved, proxyBase)}")`;
  });
}

/**
 * Rewrite a srcset attribute value.
 */
function rewriteSrcset(srcset, baseUrl, proxyBase) {
  // srcset: "url1 1x, url2 2x" or "url1 100w, url2 200w"
  return srcset.replace(/([^\s,]+)(\s+[\d.]+[wx])?/g, (match, url, descriptor) => {
    if (!url) return match;
    const resolved = resolveUrl(baseUrl, url);
    if (!resolved) return match;
    return toProxyUrl(resolved, proxyBase) + (descriptor || '');
  });
}

/**
 * Fully rewrite all URLs in an HTML document so every request goes through
 * the proxy. Also removes Content-Security-Policy meta tags, integrity
 * attributes, and injects the interception script into <head>.
 *
 * @param {string} html          Raw HTML text
 * @param {string} baseUrl       URL of the page being proxied (used to resolve relative URLs)
 * @param {string} proxyBase     Base URL of the proxy server (e.g. https://proxy.example.com)
 * @param {string} injectionScript  JavaScript text to inject into <head>
 * @returns {string} Rewritten HTML
 */
function rewriteHtml(html, baseUrl, proxyBase, injectionScript) {
  const $ = cheerio.load(html, { decodeEntities: false });

  // Remove CSP meta tags – they would block our injected script / rewritten URLs
  $('meta[http-equiv="Content-Security-Policy"]').remove();
  $('meta[http-equiv="content-security-policy"]').remove();

  // Remove <base> tags so relative resolution works off our rewritten hrefs
  $('base').remove();

  // Remove integrity attributes (SRI would block resources we rewrote)
  $('[integrity]').removeAttr('integrity');
  $('[crossorigin]').removeAttr('crossorigin');

  // ----- href-bearing elements -----
  $('a[href], area[href]').each((_, el) => rewriteAttr(el, 'href', baseUrl, proxyBase));
  $('link[href]').each((_, el) => rewriteAttr(el, 'href', baseUrl, proxyBase));

  // ----- src-bearing elements -----
  $('[src]').each((_, el) => rewriteAttr(el, 'src', baseUrl, proxyBase));

  // ----- srcset -----
  $('[srcset]').each((_, el) => {
    if (el.attribs.srcset) {
      el.attribs.srcset = rewriteSrcset(el.attribs.srcset, baseUrl, proxyBase);
    }
  });

  // ----- action (forms) -----
  $('form[action]').each((_, el) => rewriteAttr(el, 'action', baseUrl, proxyBase));

  // ----- inline styles -----
  $('[style]').each((_, el) => {
    if (el.attribs.style) {
      el.attribs.style = rewriteCss(el.attribs.style, baseUrl, proxyBase);
    }
  });

  // ----- <style> blocks -----
  $('style').each((_, el) => {
    const content = $(el).html();
    if (content) $(el).html(rewriteCss(content, baseUrl, proxyBase));
  });

  // ----- meta refresh -----
  $('meta[http-equiv="refresh"]').each((_, el) => {
    const content = el.attribs.content || '';
    const match = content.match(/^(\d+;\s*url=)(.+)$/i);
    if (match) {
      const resolved = resolveUrl(baseUrl, match[2]);
      if (resolved) {
        el.attribs.content = match[1] + toProxyUrl(resolved, proxyBase);
      }
    }
  });

  // ----- Inject our interception script as first child of <head> -----
  const scriptTag = `<script>${injectionScript}</script>`;
  if ($('head').length) {
    $('head').prepend(scriptTag);
  } else if ($('body').length) {
    $('body').prepend(scriptTag);
  } else {
    $.root().prepend(scriptTag);
  }

  return $.html();
}

module.exports = { resolveUrl, toProxyUrl, rewriteHtml, rewriteCss };
