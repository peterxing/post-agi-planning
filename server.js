const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createHash } = require('crypto');

const DIR = __dirname;
const types = { '.html':'text/html; charset=utf-8', '.png':'image/png', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.txt':'text/plain; charset=utf-8', '.svg':'image/svg+xml', '.json':'application/json; charset=utf-8' };

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
  'LICENSE',
  'game.html',
  'game.css',
  'game-entry.js',
  'game-core.mjs',
  'game-data.mjs',
  'game-ui.mjs',
  'game-world.mjs',
  'game-content.json',
  'three.webgpu.min.js',
  'three.core.min.js',
  'THREE-LICENSE.txt',
]);
const ALLOW_EXT = new Set([]);
const COMPRESS_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt']);

function gameCsp(html) {
  const hash = text => `'sha256-${createHash('sha256').update(text.replace(/\r\n?/g,'\n')).digest('base64')}'`;
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match=>match[1]).filter(text=>text.trim());
  const styles = [...html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g)].map(match=>match[1]);
  if (scripts.length !== 1 || styles.length !== 1) throw new Error('Game entry must have exactly the approved theme script and theme-token style.');
  return `default-src 'none'; script-src 'self' ${hash(scripts[0])}; style-src 'self' ${hash(styles[0])}; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; worker-src 'none'; media-src 'none'`;
}

function createPreviewServer() {
return http.createServer((req, res) => {
  if (!['GET','HEAD'].includes(req.method)) {
    res.writeHead(405,{Allow:'GET, HEAD'}); res.end('Method not allowed'); return;
  }
  let url;
  try {
    url = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400); res.end('Bad request'); return;
  }
  url = url.replace(/\/{2,}/g, '/');
  if (url === '/' || url === '') url = '/index.html';
  if (url === '/game') url = '/game.html';
  const rel = path.normalize(url).replace(/^(\.\.[\/\\])+/, '');
  let file = path.join(DIR, rel);
  // Security: never serve dotfiles (.env, .git, ...) or anything outside DIR.
  const segs = rel.split(/[\/\\]/).filter(Boolean);
  if (segs.some(s => s.startsWith('.')) || !file.startsWith(DIR + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  // Default-deny everything that is not an allowed page/sidecar or a static asset.
  const base = segs[segs.length - 1] || '';
  const ext = path.extname(base);
  if (segs.length !== 1 || (!ALLOW_FILES.has(base) && !ALLOW_EXT.has(ext))) {
    res.writeHead(404); res.end('Not found'); return;
  }
  if (base === 'LICENSE' && !fs.existsSync(file)) file = 'C:\\Users\\peterxing\\pap-site\\LICENSE';
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const headers = {
      'Content-Type': base === 'LICENSE' ? 'text/plain; charset=utf-8' : types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': ext === '.json' ? 'no-store, max-age=0, must-revalidate' : 'public, max-age=0, must-revalidate',
      'Vary': 'Accept-Encoding',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };
    if (base === 'game.html') {
      try { headers['Content-Security-Policy'] = gameCsp(data.toString('utf8')); }
      catch (error) { console.error(error.message); res.writeHead(500);res.end('Invalid game security policy');return; }
    }
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
});
}

if (require.main === module) {
  const argument = process.argv.find(value=>value.startsWith('--port='));
  const port = Number(argument ? argument.slice(7) : process.env.PAP_PREVIEW_PORT || 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Preview port must be an integer from 0 to 65535.');
  const server = createPreviewServer();
  server.listen(port,'127.0.0.1',()=>{
    const actual = server.address().port;
    console.log('Serving ' + DIR + ' on http://127.0.0.1:' + actual);
    console.log('PAP_PREVIEW_READY '+JSON.stringify({port:actual,pid:process.pid,root:DIR}));
  });
}
module.exports = { createPreviewServer, gameCsp, ALLOW_FILES };
