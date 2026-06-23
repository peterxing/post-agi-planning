const http = require('http');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const PORT = 8787;
const types = { '.html':'text/html; charset=utf-8', '.png':'image/png', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml', '.json':'application/json; charset=utf-8' };

// Default-deny: the public site only needs these files + static image/style assets. Everything else
// (server-side scripts x-*.js / refresh-signals.js / server.js, *.ps1, *.md, debug/raw JSON, etc.) is
// 404'd so the Cloudflare tunnel never leaks operational code, secrets paths, or the raw harvest.
const ALLOW_FILES = new Set(['index.html', 'signals.json', 'predictions.json', 'author.json']);
const ALLOW_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.css', '.woff', '.woff2']);

http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
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
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => console.log('Serving ' + DIR + ' on http://127.0.0.1:' + PORT));
