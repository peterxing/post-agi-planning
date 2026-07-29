const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIR = __dirname;
const PORT = 8787;
const types = { '.html':'text/html; charset=utf-8', '.png':'image/png', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml', '.json':'application/json; charset=utf-8' };

// Default-deny: the public site only needs these files + static image/style assets. Everything else
// (server-side scripts x-*.js / refresh-signals.js / server.js, *.ps1, *.md, debug/raw JSON, etc.) is
// 404'd so the Cloudflare tunnel never leaks operational code, secrets paths, or the raw harvest.
const ALLOW_FILES = new Set([
  'index.html',
  'app.js',
  'styles.css',
  'signals.json',
  'predictions.json',
  'author.json',
]);
const ALLOW_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.css', '.woff', '.woff2']);
const COMPRESS_EXT = new Set(['.html', '.css', '.js', '.json', '.svg']);

http.createServer((req, res) => {
  let url;
  try {
    url = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400); res.end('Bad request'); return;
  }
  url = url.replace(/\/{2,}/g, '/');
  if (url === '/' || url === '') url = '/index.html';
  const rel = path.normalize(url).replace(/^(\.\.[\/\\])+/, '');
  const file = path.join(DIR, rel);
  // Security: never serve dotfiles (.env, .git, ...) or anything outside DIR.
  const segs = rel.split(/[\/\\]/).filter(Boolean);
  if (segs.some(s => s.startsWith('.')) || !file.startsWith(DIR + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  // Default-deny everything that is not an allowed page/sidecar or a static asset.
  const base = (segs[segs.length - 1] || '').toLowerCase();
  const ext = path.extname(base);
  if (!ALLOW_FILES.has(base) && !ALLOW_EXT.has(ext)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const headers = {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': ext === '.json' ? 'no-cache' : 'public, max-age=0, must-revalidate',
      'Vary': 'Accept-Encoding',
    };
    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (!acceptsGzip || !COMPRESS_EXT.has(ext) || data.length < 1024) {
      res.writeHead(200, headers);
      res.end(data);
      return;
    }
    zlib.gzip(data, { level: 6 }, (gzipError, compressed) => {
      if (gzipError) {
        res.writeHead(500);
        res.end('Compression failed');
        return;
      }
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
      res.end(compressed);
    });
  });
}).listen(PORT, '127.0.0.1', () => console.log('Serving ' + DIR + ' on http://127.0.0.1:' + PORT));
