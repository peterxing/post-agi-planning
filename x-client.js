// x-client.js — X (Twitter) API v2 client for the Post-AGI daily refresh.
// Credentials load from C:\Users\peterxing\pap-secrets\.env (OUTSIDE all served/deployed dirs).
//
// Auth model (empirically verified against this app's tier):
//   * App-only Bearer            -> user lookup + user timeline (POSTS + REPOSTS). Works now.
//   * OAuth 1.0a User Context    -> also unlocks LIKES (needs X_ACCESS_TOKEN + X_ACCESS_SECRET).
//   * OAuth 2.0 User Context     -> unlocks BOOKMARKS (and likes) (needs X_OAUTH2_TOKEN from x-auth.js).
// harvestActivity() returns posts+reposts always, and likes/bookmarks automatically when the
// matching user token is present — so the site lights those up the moment they're configured.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENV_PATH = process.env.X_ENV_PATH || 'C:\\Users\\peterxing\\pap-secrets\\.env';

function loadEnv(p = ENV_PATH) {
  const out = {};
  let txt;
  try { txt = fs.readFileSync(p, 'utf8'); } catch { return out; }
  for (let line of txt.split(/\r?\n/)) {
    line = line.replace(/^\uFEFF/, '');
    if (!line || line.trimStart().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const ENV = loadEnv();
const BEARER = (ENV.X_BEARER_TOKEN || '').trim(); // use verbatim — X requires the URL-encoded form
const CK = ENV.X_API_KEY || '';
const CS = ENV.X_API_SECRET || '';
const AT = ENV.X_ACCESS_TOKEN || '';
const AS = ENV.X_ACCESS_SECRET || '';
const O2 = (ENV.X_OAUTH2_TOKEN || '').trim();
const API = 'https://api.twitter.com';

function pct(s) { return encodeURIComponent(s).replace(/[!*()']/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()); }

// OAuth 1.0a user-context signing (used only when AT/AS present).
function oauth1Header(method, url, extraParams = {}) {
  const u = new URL(url);
  const oauth = {
    oauth_consumer_key: CK,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: AT,
    oauth_version: '1.0',
  };
  const all = { ...oauth, ...extraParams };
  for (const [k, v] of u.searchParams.entries()) all[k] = v;
  const base = Object.keys(all).sort().map(k => `${pct(k)}=${pct(all[k])}`).join('&');
  const sigBase = [method.toUpperCase(), pct(u.origin + u.pathname), pct(base)].join('&');
  const key = `${pct(CS)}&${pct(AS)}`;
  const sig = crypto.createHmac('sha1', key).update(sigBase).digest('base64');
  oauth.oauth_signature = sig;
  return 'OAuth ' + Object.keys(oauth).sort().map(k => `${pct(k)}="${pct(oauth[k])}"`).join(', ');
}

// auth: 'app' (bearer) | 'oauth1' (user ctx, needs AT/AS) | 'oauth2' (user ctx, needs O2)
async function xGet(pathQuery, { auth = 'app' } = {}) {
  const url = API + pathQuery;
  const headers = { 'User-Agent': 'pap-refresh/1.0' };
  if (auth === 'oauth1' && AT && AS) headers['Authorization'] = oauth1Header('GET', url);
  else if (auth === 'oauth2' && O2) headers['Authorization'] = 'Bearer ' + O2;
  else headers['Authorization'] = 'Bearer ' + BEARER;
  const r = await fetch(url, { headers });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return {
    status: r.status,
    ok: r.ok,
    json,
    text,
    limit: r.headers.get('x-rate-limit-remaining'),
    reset: r.headers.get('x-rate-limit-reset'),
  };
}

const TW_FIELDS = 'tweet.fields=created_at,public_metrics,referenced_tweets,lang&expansions=referenced_tweets.id,referenced_tweets.id.author_id,author_id&user.fields=username,name';

async function getUserId(username) {
  return xGet(`/2/users/by/username/${encodeURIComponent(username)}?user.fields=id,username,name,public_metrics`);
}
async function getUserTweets(id, max = 100, token = null) {
  return xGet(`/2/users/${id}/tweets?max_results=${max}&exclude=replies&${TW_FIELDS}` + (token ? `&pagination_token=${token}` : ''));
}
async function getLikedTweets(id, max = 100, auth = 'oauth1', token = null) {
  return xGet(`/2/users/${id}/liked_tweets?max_results=${max}&${TW_FIELDS}` + (token ? `&pagination_token=${token}` : ''), { auth });
}
async function getBookmarks(id, max = 100, token = null) {
  return xGet(`/2/users/${id}/bookmarks?max_results=${max}&${TW_FIELDS}` + (token ? `&pagination_token=${token}` : ''), { auth: 'oauth2' });
}
async function searchAllTweets(query, max = 500, token = null) {
  const count = Math.max(10, Math.min(500, Number(max) || 500));
  return xGet(`/2/tweets/search/all?query=${encodeURIComponent(query)}&max_results=${count}&${TW_FIELDS}`
    + (token ? `&next_token=${encodeURIComponent(token)}` : ''));
}

// ---- normalization helpers ----
function cleanX(s) {
  return String(s || '').replace(/https?:\/\/t\.co\/\w+/g, ' ').replace(/\s+/g, ' ').trim();
}
function indexIncludes(json) {
  const inc = json.includes || {};
  const incT = Object.fromEntries((inc.tweets || []).map(t => [t.id, t]));
  const incU = Object.fromEntries((inc.users || []).map(u => [u.id, u]));
  return { incT, incU };
}
function norm(t, author, kind, activityId = null) {
  const pm = t.public_metrics || {};
  return {
    id: String(t.id),
    activityId: String(activityId || t.id),
    activitySource: 'x-api-user-timeline',
    created: t.created_at,
    text: cleanX(t.full_text || t.text),
    author: author || '',
    likes: pm.like_count || 0,
    rts: pm.retweet_count || 0,
    kind,
  };
}

// Harvest @peterxing's realtime activity. Posts + reposts always; likes when a user token (OAuth1/2)
// is present; bookmarks when an OAuth2 user token is present. Returns { id, items, caps }.
async function harvestActivity({ maxPosts = 300, maxLikes = 100, maxBookmarks = 100 } = {}) {
  const u = await getUserId('peterxing');
  if (!u.ok || !(u.json && u.json.data)) return null;
  const id = u.json.data.id;
  const items = [];
  const seen = new Set();
  const add = (it) => { if (!it || !it.id) return; const k = it.id + ':' + it.kind; if (seen.has(k)) return; seen.add(k); items.push(it); };
  const caps = {
    posts: 0,
    reposts: 0,
    likes: 0,
    bookmarks: 0,
    timelinePages: 0,
    timelineComplete: false,
  };

  // POSTS + REPOSTS (+ quotes counted as posts: his own commentary)
  let tok = null;
  for (let page = 0; page < Math.ceil(maxPosts / 100) && (page === 0 || tok); page++) {
    const r = await getUserTweets(id, 100, tok);
    if (!r.ok || !(r.json && r.json.data)) break;
    caps.timelinePages++;
    const { incT, incU } = indexIncludes(r.json);
    for (const t of r.json.data) {
      const refs = t.referenced_tweets || [];
      const rt = refs.find(x => x.type === 'retweeted');
      if (rt) {
        const o = incT[rt.id]; if (!o) continue;
        const au = (incU[o.author_id] || {}).username || '';
        add(norm(o, au, 'repost', t.id)); caps.reposts++;
      } else {
        const au = (incU[t.author_id] || {}).username || 'peterxing';
        add(norm(t, au, 'post')); caps.posts++;
      }
    }
    tok = (r.json.meta || {}).next_token;
    if (!tok) {
      caps.timelineComplete = true;
      break;
    }
  }

  // LIKES (OAuth1 preferred, else OAuth2)
  if (maxLikes > 0 && ((AT && AS) || O2)) {
    const auth = (AT && AS) ? 'oauth1' : 'oauth2';
    const r = await getLikedTweets(id, maxLikes, auth);
    if (r.ok && r.json && r.json.data) {
      const { incU } = indexIncludes(r.json);
      for (const t of r.json.data) { add(norm(t, (incU[t.author_id] || {}).username || '', 'like')); caps.likes++; }
    } else if (r.status === 403) caps.likes = -1; // token missing/insufficient
  }

  // BOOKMARKS (OAuth2 only)
  if (maxBookmarks > 0 && O2) {
    const r = await getBookmarks(id, maxBookmarks);
    if (r.ok && r.json && r.json.data) {
      const { incU } = indexIncludes(r.json);
      for (const t of r.json.data) { add(norm(t, (incU[t.author_id] || {}).username || '', 'bookmark')); caps.bookmarks++; }
    } else if (r.status === 403) caps.bookmarks = -1;
  }

  return { id, items, caps };
}

async function harvestFullArchive({ maxPosts = 20000 } = {}) {
  const items = [];
  const seen = new Set();
  const add = item => {
    if (!item || !item.id || seen.has(item.id)) return;
    seen.add(item.id);
    items.push(item);
  };
  const caps = {
    posts: 0,
    reposts: 0,
    timelinePages: 0,
    timelineComplete: false,
  };
  let token = null;
  while (items.length < maxPosts) {
    const response = await searchAllTweets('from:peterxing -is:reply', Math.min(500, maxPosts - items.length), token);
    if (!response.ok || !(response.json && response.json.data)) {
      return {
        items,
        caps,
        status: response.status,
        remaining: response.limit,
        reset: response.reset,
      };
    }
    caps.timelinePages++;
    const { incT, incU } = indexIncludes(response.json);
    for (const tweet of response.json.data) {
      const refs = tweet.referenced_tweets || [];
      const retweet = refs.find(ref => ref.type === 'retweeted');
      if (retweet) {
        const original = incT[retweet.id];
        if (!original) continue;
        add(norm(original, (incU[original.author_id] || {}).username || '', 'repost', tweet.id));
        caps.reposts++;
      } else {
        add(norm(tweet, (incU[tweet.author_id] || {}).username || 'peterxing', 'post', tweet.id));
        caps.posts++;
      }
    }
    token = response.json.meta && response.json.meta.next_token;
    if (!token) {
      caps.timelineComplete = true;
      break;
    }
  }
  return { items, caps, status: 200, remaining: null, reset: null };
}

async function harvestSearchQueries(namedQueries, { maxPerQuery = 5000 } = {}) {
  const items = new Map();
  const stats = [];
  const delayMs = Math.max(1000, Number(process.env.X_SEARCH_DELAY_MS) || 1200);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  for (const definition of namedQueries || []) {
    const name = String(definition && definition.name || '').trim();
    const terms = String(definition && definition.query || '').trim();
    if (!name || !terms) continue;
    let token = null;
    let pages = 0;
    let status = 200;
    let complete = false;
    let remaining = null;
    let reset = null;
    const found = new Set();
    while (found.size < maxPerQuery) {
      let response;
      for (let attempt = 0; attempt < 4; attempt++) {
        response = await searchAllTweets(
          `from:peterxing (${terms}) -is:reply`,
          Math.min(500, maxPerQuery - found.size),
          token
        );
        if (response.status !== 429) break;
        await wait(delayMs * (attempt + 2));
      }
      status = response.status;
      remaining = response.limit;
      reset = response.reset;
      if (!response.ok || !(response.json && response.json.data)) break;
      pages++;
      const { incT, incU } = indexIncludes(response.json);
      for (const tweet of response.json.data) {
        const refs = tweet.referenced_tweets || [];
        const retweet = refs.find(ref => ref.type === 'retweeted');
        let item;
        if (retweet) {
          const original = incT[retweet.id];
          if (!original) continue;
          item = norm(original, (incU[original.author_id] || {}).username || '', 'repost', tweet.id);
        } else {
          item = norm(tweet, (incU[tweet.author_id] || {}).username || 'peterxing', 'post', tweet.id);
        }
        item.activitySource = 'x-api-full-archive-search';
        item.archiveQueries = [name];
        found.add(item.id);
        const prior = items.get(item.id);
        if (prior) {
          prior.archiveQueries = [...new Set([...(prior.archiveQueries || []), name])];
        } else {
          items.set(item.id, item);
        }
      }
      token = response.json.meta && response.json.meta.next_token;
      if (!token) {
        complete = true;
        break;
      }
      await wait(delayMs);
    }
    stats.push({
      name,
      count: found.size,
      pages,
      complete,
      status,
      remaining: remaining == null ? null : Number(remaining),
      resetAt: reset ? new Date(Number(reset) * 1000).toISOString() : null,
    });
    if (status === 429) break;
    await wait(delayMs);
  }
  return { items: [...items.values()], stats };
}

module.exports = {
  loadEnv, ENV, xGet, getUserId, getUserTweets, getLikedTweets, getBookmarks, searchAllTweets,
  harvestActivity, harvestFullArchive, harvestSearchQueries,
  hasUserToken: !!(AT && AS), hasOauth2: !!O2,
};

// ---- CLI probe ----
if (require.main === module && process.argv.includes('--probe')) {
  (async () => {
    const report = { when: new Date().toISOString(), bearer: BEARER ? 'present' : 'MISSING', oauth1: (AT && AS) ? 'present' : 'absent', oauth2: O2 ? 'present' : 'absent', tests: {} };
    const note = (k, r) => {
      const n = r.json && r.json.meta ? r.json.meta.result_count : (r.json && r.json.data ? (Array.isArray(r.json.data) ? r.json.data.length : 1) : 0);
      report.tests[k] = { status: r.status, ok: r.ok, count: n, remaining: r.limit, error: r.json && r.json.title ? `${r.json.title}: ${r.json.detail || ''}`.trim() : (r.ok ? null : (r.text || '').slice(0, 160)) };
      console.log(`[${k}] HTTP ${r.status} ok=${r.ok} count=${n} remaining=${r.limit} ${report.tests[k].error ? ':: ' + report.tests[k].error : ''}`);
    };
    const u = await getUserId('peterxing'); note('user_lookup', u);
    const id = u.json && u.json.data && u.json.data.id;
    if (id) {
      console.log(`peterxing id=${id} followers=${u.json.data.public_metrics ? u.json.data.public_metrics.followers_count : '?'}`);
      note('user_tweets(posts+reposts)', await getUserTweets(id, 100));
      note('liked_tweets(oauth1)', await getLikedTweets(id, 10, 'oauth1'));
      if (O2) note('liked_tweets(oauth2)', await getLikedTweets(id, 10, 'oauth2'));
      note('bookmarks(oauth2)', await getBookmarks(id, 10));
    }
    fs.writeFileSync(path.join(__dirname, 'x-debug.json'), JSON.stringify(report, null, 2));
    console.log('\nCAPABILITY SUMMARY:');
    for (const [k, v] of Object.entries(report.tests)) console.log(`  ${k.padEnd(26)} ${v.ok ? 'OK (' + v.count + ')' : 'NO  [' + v.status + '] ' + (v.error || '')}`);
    console.log('\nWrote x-debug.json');
  })().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
}
