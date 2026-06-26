// x-auth.js — one-time OAuth 2.0 User-Context (PKCE) login for x.com/peterxing.
//
// WHY: app-only Bearer auth (already configured) unlocks his POSTS + REPOSTS in realtime. His private
// BOOKMARKS (and reliably his LIKES) require a USER-CONTEXT token. This script runs the OAuth2 PKCE
// flow once, logged in as @peterxing, and writes X_OAUTH2_TOKEN (+ refresh token) into pap-secrets/.env.
// After that, refresh-signals.js / x-client.js automatically include likes + bookmarks every day.
//
// PREREQUISITES (do once in the X developer portal — see X-API-SETUP.md):
//   1. In your app's "User authentication settings": enable OAuth 2.0, App type = Web/Native (PKCE),
//      and add the redirect URI EXACTLY:  http://127.0.0.1:8723/callback
//   2. Copy the OAuth 2.0 "Client ID" (and Client Secret if your app is "Confidential") and put them in
//      pap-secrets/.env as  X_OAUTH2_CLIENT_ID=...   (and  X_OAUTH2_CLIENT_SECRET=...  if confidential).
//
// USAGE:
//   node x-auth.js            # full login: opens the authorize URL, captures the code, saves the token
//   node x-auth.js --refresh  # silently mint a fresh access token from the saved refresh token (daily)
//
// No secret is ever printed or committed. Tokens live only in pap-secrets/.env (never served/deployed).

const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

const ENV_PATH = process.env.X_ENV_PATH || 'C:\\Users\\peterxing\\pap-secrets\\.env';
const REDIRECT = 'http://127.0.0.1:8723/callback';
const PORT = 8723;
const SCOPES = ['tweet.read', 'users.read', 'like.read', 'bookmark.read', 'offline.access'];
const AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';

function readEnv() {
  const env = {};
  try {
    const txt = fs.readFileSync(ENV_PATH, 'utf8').replace(/^\uFEFF/, '');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m) env[m[1]] = m[2];
    }
  } catch (e) {}
  return env;
}

// Merge keys into .env, preserving every other line/comment. Creates the file if missing.
function writeEnv(updates) {
  let lines = [];
  try { lines = fs.readFileSync(ENV_PATH, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/); } catch (e) {}
  const seen = {};
  lines = lines.map(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/i);
    if (m && updates[m[1]] !== undefined) { seen[m[1]] = true; return m[1] + '=' + updates[m[1]]; }
    return line;
  });
  for (const k of Object.keys(updates)) if (!seen[k]) lines.push(k + '=' + updates[k]);
  // collapse trailing blank lines to a single newline
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n');
}

function b64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

function tokenRequest(params, ENV) {
  const body = new URLSearchParams(params).toString();
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  // Confidential clients authenticate with HTTP Basic (client_id:client_secret); public clients send client_id in the body.
  if (ENV.X_OAUTH2_CLIENT_SECRET) {
    headers.Authorization = 'Basic ' + Buffer.from(ENV.X_OAUTH2_CLIENT_ID + ':' + ENV.X_OAUTH2_CLIENT_SECRET).toString('base64');
  }
  return fetch(TOKEN_URL, { method: 'POST', headers, body }).then(async r => {
    const txt = await r.text();
    let j = {}; try { j = JSON.parse(txt); } catch (e) {}
    if (!r.ok) throw new Error('token endpoint HTTP ' + r.status + ': ' + txt.slice(0, 300));
    return j;
  });
}

function persistToken(j) {
  const upd = { X_OAUTH2_TOKEN: j.access_token };
  if (j.refresh_token) upd.X_OAUTH2_REFRESH = j.refresh_token;
  if (j.expires_in) upd.X_OAUTH2_EXPIRES = new Date(Date.now() + j.expires_in * 1000).toISOString();
  writeEnv(upd);
}

async function refreshFlow(ENV) {
  if (!ENV.X_OAUTH2_REFRESH) { console.error('[x-auth] No X_OAUTH2_REFRESH in .env — run `node x-auth.js` once first.'); process.exit(2); }
  if (!ENV.X_OAUTH2_CLIENT_ID) { console.error('[x-auth] No X_OAUTH2_CLIENT_ID in .env (see X-API-SETUP.md).'); process.exit(2); }
  const j = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: ENV.X_OAUTH2_REFRESH,
    client_id: ENV.X_OAUTH2_CLIENT_ID,
  }, ENV);
  persistToken(j);
  console.error('[x-auth] Refreshed OAuth2 user token (expires in ' + (j.expires_in || '?') + 's). Likes + bookmarks active.');
}

async function loginFlow(ENV) {
  if (!ENV.X_OAUTH2_CLIENT_ID) {
    console.error('[x-auth] Missing X_OAUTH2_CLIENT_ID in ' + ENV_PATH + '.');
    console.error('         Add your app\'s OAuth 2.0 Client ID (X developer portal) and the redirect URI');
    console.error('         ' + REDIRECT + ' — full steps in X-API-SETUP.md.');
    process.exit(2);
  }
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  const authorize = AUTH_URL + '?' + new URLSearchParams({
    response_type: 'code',
    client_id: ENV.X_OAUTH2_CLIENT_ID,
    redirect_uri: REDIRECT,
    scope: SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/callback') { res.writeHead(404); res.end('not found'); return; }
      const err = u.searchParams.get('error');
      const gotState = u.searchParams.get('state');
      const gotCode = u.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      if (err) { res.end('<h2>Authorization failed: ' + err + '</h2>You can close this tab.'); server.close(); return reject(new Error('authorize error: ' + err)); }
      if (gotState !== state) { res.end('<h2>State mismatch — aborted.</h2>'); server.close(); return reject(new Error('state mismatch')); }
      res.end('<h2>&#10003; @peterxing authorized.</h2>Token saved. You can close this tab and return to the terminal.');
      server.close(); resolve(gotCode);
    });
    server.listen(PORT, '127.0.0.1', () => {
      console.error('[x-auth] Open this URL in a browser where you are logged in as @peterxing:\n\n' + authorize + '\n');
      // best-effort auto-open on Windows
      try { require('child_process').exec('cmd /c start "" "' + authorize + '"'); } catch (e) {}
      console.error('[x-auth] Waiting for the redirect to ' + REDIRECT + ' …');
    });
    server.on('error', reject);
  });

  const j = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT,
    client_id: ENV.X_OAUTH2_CLIENT_ID,
    code_verifier: verifier,
  }, ENV);
  persistToken(j);
  console.error('[x-auth] Success — OAuth2 user token saved to ' + ENV_PATH + '. Likes + bookmarks now active in the daily harvest.');
}

(async () => {
  const ENV = readEnv();
  try {
    if (process.argv.includes('--refresh')) await refreshFlow(ENV);
    else await loginFlow(ENV);
  } catch (e) { console.error('[x-auth] ERROR: ' + e.message); process.exit(1); }
})();
