// refresh-signals.js — build past-week-only @peterxing X signals (posts + reposts) mapped to the
// REHOBOAM timeline predictions, and write signals.json (loaded by index.html at runtime).
//
// HARVEST (X API v2 primary, syndication fallback)
//   PRIMARY: the authenticated X API v2 (x-client.js → harvestActivity()). Using @peterxing's app
//   credentials (pap-secrets/.env), it pulls his realtime timeline — POSTS + REPOSTS always, plus his
//   LIKES + BOOKMARKS when a user-context token is configured (see X-API-SETUP.md). This breaks the
//   auth-free syndication ceiling (which tops out months behind) and returns true past-week activity.
//   FALLBACK: if the API is unavailable, the script fetches @peterxing's public syndication timeline
//   (showReplies=false) and caches it to timeline-raw.json so the site never blanks.
//
// SOURCES & ACCESS
//   posts     : original @peterxing tweets + quote-tweets.
//   reposts   : tweets @peterxing retweeted (native retweets — returned by the API; the syndication
//               fallback only sees them if a foreign-author entry appears, or via optional reposts.json).
//   likes     : tweets @peterxing liked — requires an OAuth1/OAuth2 user-context token (X-API-SETUP.md).
//   bookmarks : tweets @peterxing bookmarked — requires an OAuth2 user-context token (bookmark.read).
//
// MATCHING (per-post relevance, tiered by recency)
//   The prediction set is loaded from predictions.json (revised DAILY from the latest news + his posts —
//   predictions are added / updated / removed there, not here). Every post is scored against every
//   prediction: phrase(3) + strong-word(2) + weak-word(1). Each post is assigned to the single prediction
//   it fits best, and each prediction takes its highest-scoring post. A PAST-WEEK post (<= PAST_WEEK_DAYS)
//   is preferred (+WEEK_BOOST); when a topic has none, the most recent post on that topic within
//   MAX_AGE_DAYS is shown instead (tier 'recent', honestly dated). Predictions with no relevant post fall
//   back to a live from:peterxing search. X's auth-free feed is capped at his recent timeline, so "most
//   recent" is the freshest the data allows.
//
//   node refresh-signals.js                 # harvest + match + write signals.json (+ optional reposts.json)
//   MAX_AGE_DAYS=365 PAST_WEEK_DAYS=7 node refresh-signals.js
const fs = require('fs');
const path = require('path');
const https = require('https');

const DIR = __dirname;
const RAW = path.join(DIR, 'timeline-raw.json');
const OUT = path.join(DIR, 'signals.json');
const DBG = path.join(DIR, 'signals-debug.json');
const PRED = path.join(DIR, 'predictions.json'); // daily-revised prediction set (source of truth)
const RECENT_DAYS = Number(process.env.RECENT_DAYS || 7); // kept for back-compat (unused directly)
// Recency tiers: a PAST-WEEK post (<= PAST_WEEK_DAYS) is preferred; otherwise the most recent post on
// the topic within MAX_AGE_DAYS is shown (honestly dated). MIN_SCORE gates out weak/spurious matches.
const PAST_WEEK_DAYS = Number(process.env.PAST_WEEK_DAYS || 7);
const MAX_AGE_DAYS   = Number(process.env.MAX_AGE_DAYS || 800);
const WEEK_BOOST     = 3;
const MIN_SCORE      = 2;
const SYND_URL = 'https://syndication.twitter.com/srv/timeline-profile/screen-name/peterxing?showReplies=false&lang=en&dnt=true';
const KIND_RANK = { post: 0, repost: 1, like: 2, bookmark: 3 }; // de-dup priority: keep the richest kind
const ACT = path.join('C:\\Users\\peterxing\\pap-secrets', 'x-activity.json'); // non-served raw activity dump

// Prediction table fallback. The LIVE matching set is loaded from predictions.json (revised daily);
// this inline copy is only used if that sidecar is missing/unparsable. Each post is scored against
// every prediction by weighted term hits:
//   phrases (normalized, punctuation→space) = 3pts · strong words (prefix match) = 2pts · weak words = 1pt
// `search` is the live-search fallback when no post scores >= MIN_SCORE for that prediction.
const DEFAULT_PREDICTIONS = [
  { year: 2026, maps: 'AI agents go mainstream', search: 'AI agents',
    phrases: ['ai agent','ai agents','agentic','autonomous agent','coding agent','claude code','open model','local model','frontier model','open source ai','open weights'],
    strong: ['agent','agents','exo','codex','opencode','llm','llms','inference','llama','mistral','deepseek','gguf','glm','qwen'],
    weak: ['model','models','ai','local','prompt'] },
  { year: 2027, maps: 'First trillion-dollar pure-AI company', search: 'AI company valuation',
    phrases: ['trillion dollar','market cap','pure ai','ai company','first ai company','trillion parameter'],
    strong: ['trillion','valuation','nvidia','ipo','revenue','arr','acquisition'],
    weak: ['company','billion','market','stock','startup'] },
  { year: 2028, maps: 'AGI passes comprehensive reasoning benchmarks', search: 'AGI',
    phrases: ['artificial general intelligence','human level','arc agi','frontier math','reasoning benchmark','passes the','general intelligence'],
    strong: ['agi','reasoning','benchmark','benchmarks','o3','gpt'],
    weak: ['reason','intelligence','model'] },
  { year: 2029, maps: 'Automation eliminates ~25% of current jobs', search: 'automation jobs',
    phrases: ['white collar','minimum wage','future of work','job losses','labour market','labor market','mass unemployment'],
    strong: ['job','jobs','automation','teleoperation','unemploy','unemployment','workforce','robot','robots','humanoid'],
    weak: ['work','labour','labor','wage','employ'] },
  { year: 2030, maps: 'AI-designed drugs gain FDA approval', search: 'AI drug discovery longevity',
    phrases: ['ai designed','drug discovery','clinical trial','fda approval','extend human life','protein folding','drug candidate'],
    strong: ['drug','drugs','longevity','fda','protein','cancer','clinical','biotech','disease'],
    weak: ['health','medicine','bio','cure','aging','ageing'] },
  { year: 2031, maps: 'Room-temperature superconductors arrive', search: 'superconductor',
    phrases: ['room temperature','room temp','lk 99','superconducting material'],
    strong: ['superconduct','superconductor','superconductors','superconductivity','lk99'],
    weak: ['quantum','material','materials'] },
  { year: 2032, maps: 'Synthetic biology yields artificial organisms', search: 'synthetic biology',
    phrases: ['synthetic biology','artificial cell','artificial organism','artificial life','synthetic cell','de novo'],
    strong: ['xenobot','xenobots','organism','organisms','genome','biology','biosynthetic'],
    weak: ['cell','cells','bio','dna','life'] },
  { year: 2033, maps: 'Acute rare-earth & compute shortages', search: 'rare earth supply chain',
    phrases: ['rare earth','rare earths','supply chain','export control','chip ban','compute shortage'],
    strong: ['lithium','mineral','minerals','tariff','tariffs','semiconductor','semiconductors'],
    weak: ['supply','shortage','export','mining','chips'] },
  { year: 2034, maps: 'First CRISPR-edited humans reach adulthood', search: 'CRISPR gene editing',
    phrases: ['gene editing','genome editing','gene edited','designer baby','designer babies'],
    strong: ['crispr','germline','embryo','embryos','genome'],
    weak: ['gene','genes','dna','edit','editing'] },
  { year: 2035, maps: 'Artificial superintelligence emerges', search: 'superintelligence',
    phrases: ['artificial superintelligence','recursive self','self improving','intelligence explosion','super intelligence'],
    strong: ['superintelligence','superintelligent','singularity','asi','superhuman'],
    weak: ['intelligence','exponential','alignment'] },
  { year: 2036, maps: 'Universal high income debated worldwide', search: 'universal basic income',
    phrases: ['universal basic income','universal high income','basic income','wealth redistribution','high income'],
    strong: ['ubi','redistribution','redistribute'],
    weak: ['income','welfare','inequality'] },
];

// Words ignored when auto-deriving match terms from a freshly-added prediction's own text.
const STOP = new Set(('the a an and or of to in on for with by from at as is are be into over under out '
  + 'first new more most least than then this that these those it its their his her our your they we '
  + 'becomes become begins begin reaches reach gains gain hits hit goes go enter enters runs run start '
  + 'starts across worldwide global major mainstream routine scale large small year years decade next '
  + 'human humans world wide level via per about around above below up down off near '
  + 'operate operates operating operational adoption launch launches launched pilot pilots ship ships '
  + 'shipping arrive arrives arrived emerge emerges emerged debate debated debates debating top tops '
  + 'toward towards within commercial comprehensive widespread cities city country countries nation '
  + 'nations company companies people percent units unit scales pass passes passing run running').split(/\s+/));

// Load the live prediction set from predictions.json (revised daily) and expand it into ONE matcher per
// EVENT (not per year), so every individual prediction can be mapped to its own @peterxing post/repost.
// Each matcher: {id:"YEAR-INDEX", year, evIndex, maps:<event title>, search, phrases, strong, sw, weak}.
// Terms are derived from the event's own title (sw = whole-word strong terms); the year's curated `match`
// keywords are applied only to that year's HEADLINE event so it keeps its high-quality topical matching.
function deriveTerms(y){
  const text = [y.summary, (y.match && y.match.headline) || '', ...(y.events || []).map(e => e.t)].join(' ');
  const words = String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/)
    .filter(w => w.length >= 5 && !STOP.has(w));
  return [...new Set(words)].slice(0, 14);
}
// Meaningful short tokens to keep even though they're < 4 chars.
const KEEP_SHORT = new Set(['agi','asi','ubi','fda','bci','llm','llms','xr','ev','evs','evtol','gpu','gpus','iot','dna','rna']);
// Topical vocabulary: matching a post on any of these is meaningful regardless of word length, so they
// count as a "solid" hit on their own. (Generic English words are NOT here, so a lone generic word can't
// bind a post to a prediction — it falls back to an honest search chip instead.)
const DOMAIN = new Set(('ai agi asi ubi uhi bci llm llms gpu gpus agent agents agentic robot robots robotic '
  + 'humanoid drone drones autonomous teleoperation automation fusion fission reactor nuclear solar quantum '
  + 'neural neuron genome genomic gene genes crispr dna rna brain biotech bioweapon longevity aging cancer '
  + 'drug drugs vaccine pandemic photonic photonics superconductor semiconductor chip chips lithium cobalt '
  + 'mining mars lunar moon orbital satellite rocket spaceflight starship climate carbon emissions renewable '
  + 'hydrogen battery blockchain bitcoin crypto ethereum token stablecoin defi deepfake biometric surveillance '
  + 'manufacturing factory trillion superintelligence transhuman cyborg implant implants prosthetic metaverse '
  + 'fertility demographic deepmind openai anthropic nvidia tesla spacex polymarket').split(/\s+/));
// Long-but-generic words that must NOT count as a solid hit on their own.
const SOFT = new Set(('mission million billion demonstrates platform platforms system systems business companies '
  + 'company services products projects programs general increase continues announced released available '
  + 'important different provides includes following community political national regional personal digital '
  + 'standard standards process processes feature features version versions content channel channels').split(/\s+/));
// Per-event match terms derived from the event title: multi-word `phrases` (weight 3) + single
// whole-word strong terms `sw` (weight 2). Whole-word (not prefix) avoids gene→general type bleed.
function deriveEventTerms(title){
  const ws = String(title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
  const ok = w => (w.length >= 4 && !STOP.has(w)) || KEEP_SHORT.has(w);
  const sw = [...new Set(ws.filter(ok))].slice(0, 12);
  const phrases = [];
  for (let i = 0; i < ws.length - 1; i++) if (ok(ws[i]) && ok(ws[i + 1])) phrases.push(ws[i] + ' ' + ws[i + 1]);
  const search = sw.slice(0, 3).join(' ') || String(title);
  return { phrases: [...new Set(phrases)].slice(0, 6), sw, search };
}
// Which event in a year does the curated headline describe? (max title-word overlap; default 0.)
function headlineIndex(events, headline){
  const hw = new Set(String(headline || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !STOP.has(w)));
  if (!hw.size) return 0;
  let best = 0, bestScore = -1;
  events.forEach((e, i) => {
    const ew = String(e && e.t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/);
    let s = 0; for (const w of ew) if (hw.has(w)) s++;
    if (s > bestScore) { bestScore = s; best = i; }
  });
  return best;
}

// "Reality Signals" themes: each card on the site's Reality-Signals grid is filled daily with @peterxing's
// most notable RECENT real item on that theme (his actual post/repost text + link), so the grid evolves
// with his timeline. Keywords are matched whole-word (multi-word phrases matched as substrings).
const REALITY_THEMES = [
  { tag: 'LABOUR',     kws: ['job', 'jobs', 'unemployment', 'layoff', 'layoffs', 'hiring', 'workforce', 'labor', 'labour', 'employment', 'white collar', 'wages', 'salary', 'ubi', 'graduate'] },
  { tag: 'CODE',       kws: ['code', 'coding', 'software', 'developer', 'developers', 'engineer', 'engineering', 'programming', 'programmer', 'agent', 'agents', 'agentic', 'vibe coding', 'devin', 'copilot'] },
  { tag: 'ROBOTS',     kws: ['robot', 'robots', 'humanoid', 'optimus', 'figure', 'automation', 'android', 'teleoperation', 'physical ai', 'unitree'] },
  { tag: 'CAPABILITY', kws: ['agi', 'asi', 'benchmark', 'reasoning', 'gpt', 'claude', 'gemini', 'grok', 'model', 'models', 'intelligence', 'superintelligence', 'llm', 'llms', 'frontier', 'o3', 'deepseek'] },
  { tag: 'MARKETS',    kws: ['market', 'markets', 'valuation', 'trillion', 'billion', 'ipo', 'fund', 'funding', 'invest', 'investment', 'economy', 'stock', 'revenue', 'raise', 'nvidia', 'openai'] },
  { tag: 'ABUNDANCE',  kws: ['energy', 'solar', 'fusion', 'nuclear', 'battery', 'grid', 'abundance', 'renewable', 'power', 'electricity', 'compute', 'datacenter', 'datacentre'] },
  { tag: 'LONGEVITY',  kws: ['longevity', 'aging', 'ageing', 'health', 'gene', 'crispr', 'biology', 'medicine', 'drug', 'drugs', 'cancer', 'disease', 'clinical', 'fda', 'protein', 'cell'] },
  { tag: 'GOVERNANCE', kws: ['policy', 'regulation', 'regulate', 'safety', 'governance', 'treaty', 'government', 'executive order', 'senate', 'congress', 'eu ai act', 'alignment'] },
];
// Score an item's text against a theme's keyword list. Single words match whole-word (+plural); multi-word
// keywords match as a substring. Returns { s: hit count, hit: matched terms }.
function themeScore(text, kws){
  const norm = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  let s = 0; const hit = [];
  for (const w of kws) {
    if (w.includes(' ')) { if (norm.includes(' ' + w + ' ') || norm.includes(' ' + w)) { s += 2; hit.push(w); } }
    else if (norm.includes(' ' + w + ' ') || norm.includes(' ' + w + 's ')) { s += 1; hit.push(w); }
  }
  return { s, hit };
}
function buildPredictions(){
  let years = null;
  try {
    const d = JSON.parse(fs.readFileSync(PRED, 'utf8').replace(/^\uFEFF/, ''));
    if (d && Array.isArray(d.years) && d.years.length) years = d.years;
  } catch(e){}
  const out = [];
  if (years) {
    for (const y of years) {
      if (!y || typeof y.year !== 'number' || !Array.isArray(y.events)) continue;
      const m = y.match || {};
      const cur = { phrases: Array.isArray(m.phrases) ? m.phrases : [], strong: Array.isArray(m.strong) ? m.strong : [], weak: Array.isArray(m.weak) ? m.weak : [] };
      const hasCur = !!(cur.phrases.length || cur.strong.length || cur.weak.length);
      const hi = hasCur ? headlineIndex(y.events, m.headline) : -1;
      y.events.forEach((e, i) => {
        if (!e || !e.t) return;
        const ev = deriveEventTerms(e.t);
        const slot = { id: y.year + '-' + i, year: y.year, evIndex: i, maps: e.t,
          search: (i === hi && m.search) ? m.search : ev.search,
          phrases: ev.phrases.slice(), strong: [], sw: ev.sw.slice(), weak: [] };
        if (i === hi && hasCur) { // headline event keeps the curated high-quality terms
          slot.phrases = [...new Set([...cur.phrases, ...slot.phrases])];
          slot.strong = cur.strong.slice();
          slot.weak = cur.weak.slice();
        }
        out.push(slot);
      });
    }
  }
  if (out.length) return out;
  // Offline fallback: inline defaults, one matcher per year (id = YEAR-0).
  return DEFAULT_PREDICTIONS.map(p => ({ id: p.year + '-0', year: p.year, evIndex: 0, maps: p.maps, search: p.search, phrases: p.phrases, strong: p.strong, sw: [], weak: p.weak }));
}


function token(id){
  try { return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, ''); }
  catch(e){ return String(Math.floor(Number(id) / 1e15) * Math.PI); }
}
function get(url){
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/json', 'Accept-Language': 'en-US,en;q=0.9'
    } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d }));
    });
    req.on('error', rej);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
  });
}
function cleanText(s){
  return String(s || '')
    .replace(/https?:\/\/t\.co\/\w+/g, ' ')
    .replace(/^(?:RT\s+)?(?:@\w+[:,]?\s+)+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function fmtDate(d){
  return d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
}
async function hydrate(id){
  try {
    const r = await get(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${token(id)}`);
    if (r.status !== 200) return null;
    const j = JSON.parse(r.body);
    if (!j || !j.created_at) return null;
    return { id: String(id), created: new Date(j.created_at), text: j.text || j.full_text || '', likes: j.favorite_count || 0, rts: 0, author: (j.user && j.user.screen_name) || '' };
  } catch(e){ return null; }
}

// Live harvest: fetch the syndication profile timeline directly. Returns the raw HTML body only if it
// actually contains tweet entries (the showReplies=false variant does; =true returns an empty shell).
async function harvestLive(){
  try {
    const r = await get(SYND_URL);
    if (!r || r.status !== 200 || !r.body || r.body.length < 5000) return null;
    const m = r.body.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    const j = JSON.parse(m[1]);
    const entries = (((j.props || {}).pageProps || {}).timeline || {}).entries || [];
    return entries.length ? r.body : null;
  } catch(e){ return null; }
}

// Score a post's text against one prediction. Returns score + `solid` (count of high-specificity hits):
// a hit is solid if it's a phrase, a curated strong term, or a single word that is topical (DOMAIN) or
// long enough to be specific (>=7 chars and not in SOFT). A match with solid===0 (only generic single
// words) is rejected so a lone common word can't bind a post to an unrelated prediction.
function scorePost(text, p){
  const norm = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  let score = 0, solid = 0; const hit = [];
  for (const ph of (p.phrases || [])) if (norm.includes(' ' + ph + ' ') || norm.includes(' ' + ph)) { score += 3; solid++; hit.push(ph); }
  for (const w of (p.strong || [])) if (norm.includes(' ' + w)) { score += 2; solid++; hit.push(w); }
  for (const w of (p.sw || [])) if (norm.includes(' ' + w + ' ') || norm.includes(' ' + w + 's ') || (w.endsWith('s') && norm.includes(' ' + w.slice(0, -1) + ' '))) { score += 2; if (DOMAIN.has(w) || (w.length >= 7 && !SOFT.has(w))) solid++; hit.push(w); }
  for (const w of (p.weak || []))   if (norm.includes(' ' + w + ' ')) { score += 1; hit.push(w); }
  return { score, solid, hit };
}

// ---- 1. Parse the harvested timeline into posts + reposts -------------------------------------
function parseTimeline(raw){
  let data = null;
  const m = raw.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (m) { try { data = JSON.parse(m[1]); } catch(e){} }
  if (!data) { try { data = JSON.parse(raw); } catch(e){} }
  if (!data) return null;

  let entries = null;
  try { entries = data.props.pageProps.timeline.entries; } catch(e){}
  const items = [];

  if (Array.isArray(entries)) {
    for (const en of entries) {
      const t = en && en.content && en.content.tweet;
      if (!t || !t.id_str || !(t.full_text || t.text) || !t.created_at) continue;
      const author = (t.user && (t.user.screen_name || t.user.screenName)) || '';
      const kind = author.toLowerCase() === 'peterxing' ? 'post' : 'repost';
      items.push({
        id: t.id_str, created: new Date(t.created_at), text: t.full_text || t.text,
        likes: t.favorite_count || 0, rts: t.retweet_count || 0, author: author || 'peterxing', kind,
      });
    }
  }

  // Fallback: if the structured path found nothing, recurse for any tweet-like node (treat by author).
  if (!items.length) {
    const acc = []; (function walk(n, d){
      if (!n || typeof n !== 'object' || d > 40) return;
      if (Array.isArray(n)) { for (const x of n) walk(x, d + 1); return; }
      const id = n.id_str || n.tweet_id || (typeof n.id === 'string' && /^\d{15,}$/.test(n.id) ? n.id : null);
      const txt = n.full_text || n.text; const dt = n.created_at;
      if (id && /^\d{15,}$/.test(String(id)) && txt && dt) {
        const author = (n.user && n.user.screen_name) || n.screen_name || '';
        if (author) acc.push({ id: String(id), created: new Date(dt), text: txt, likes: n.favorite_count || 0, rts: n.retweet_count || 0, author, kind: author.toLowerCase() === 'peterxing' ? 'post' : 'repost' });
      }
      for (const k in n) if (n[k] && typeof n[k] === 'object') walk(n[k], d + 1);
    })(data, 0);
    items.push(...acc);
  }
  return items;
}

// ---- 2. Ingest optional reposts.json / likes.json / bookmarks.json (IDs / URLs) ---------------
async function ingestList(file, kind){
  const p = path.join(DIR, file);
  if (!fs.existsSync(p)) return [];
  let arr;
  try { arr = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch(e){ console.error(`[refresh] ${file} is not valid JSON — skipping.`); return []; }
  if (!Array.isArray(arr)) arr = arr.items || arr.ids || arr.tweets || [];
  const out = [];
  for (const it of arr) {
    let id = null;
    if (typeof it === 'string' || typeof it === 'number') { const mm = String(it).match(/(\d{15,})/); id = mm ? mm[1] : null; }
    else if (it && typeof it === 'object') { id = it.id_str || it.tweet_id || it.id || (it.url && (String(it.url).match(/(\d{15,})/) || [])[1]); }
    if (!id) continue;
    const h = await hydrate(String(id));
    if (h) { h.kind = kind; out.push(h); }
  }
  console.error(`[refresh] ${file}: hydrated ${out.length} ${kind}(s).`);
  return out;
}

(async () => {
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8').replace(/^\uFEFF/, '')); } catch(e){}
  const prevEmbeds = (prev && prev.embeds) || {};

  // Load the live (daily-revised) prediction set, expanded to ONE matcher per event.
  const PREDICTIONS = buildPredictions();
  const predYears = new Set(PREDICTIONS.map(p => p.year)).size;
  console.error(`[refresh] Matching against ${PREDICTIONS.length} predictions across ${predYears} years.`);

  // PRIMARY source: the X API v2 (authenticated, realtime) — posts + reposts always, plus likes and
  // bookmarks when a user token is configured (see X-API-SETUP.md). Falls back to the auth-free
  // syndication scrape if the API is unavailable, so the site never blanks.
  let timeline = null; let apiCaps = null; let source = 'x-api';
  try {
    const xc = require('./x-client.js');
    const act = await xc.harvestActivity({ maxPosts: 300 });
    if (act && act.items && act.items.length) {
      timeline = act.items
        .map(it => ({ id: it.id, created: new Date(it.created), text: it.text, likes: it.likes, rts: it.rts, author: it.author || 'peterxing', kind: it.kind }))
        .filter(it => !isNaN(it.created.getTime()));
      apiCaps = act.caps;
      // Non-served debug dump (kept OUT of pap-deploy so the raw feed — incl. private bookmarks — is never served).
      try { fs.writeFileSync(ACT, JSON.stringify({ id: act.id, caps: act.caps, when: new Date().toISOString(), items: act.items.slice(0, 150) }, null, 2)); } catch(e){}
      console.error(`[refresh] X API harvest: ${timeline.length} items (posts ${act.caps.posts}, reposts ${act.caps.reposts}, likes ${act.caps.likes}, bookmarks ${act.caps.bookmarks}).`);
    } else {
      console.error('[refresh] X API harvest returned nothing — falling back to syndication scrape.');
    }
  } catch(e){ console.error('[refresh] X API harvest error (' + e.message + ') — falling back to syndication scrape.'); }

  // SECONDARY fallback: reuse the last good X API harvest cached in x-activity.json. Its REAL posts/
  // reposts (+ any likes/bookmarks), honestly dated, beat the auth-free syndication scrape — which
  // cannot see his reposts and lags months behind — whenever the live API is temporarily unavailable
  // (e.g. a quota/credit outage or a transient error). Only items still within MAX_AGE_DAYS are used.
  if (!timeline) {
    try {
      const cached = JSON.parse(fs.readFileSync(ACT, 'utf8').replace(/^\uFEFF/, ''));
      const mapped = ((cached && Array.isArray(cached.items)) ? cached.items : [])
        .map(it => ({ id: it.id, created: new Date(it.created), text: it.text, likes: it.likes, rts: it.rts, author: it.author || 'peterxing', kind: it.kind }))
        .filter(it => !isNaN(it.created.getTime()) && (Date.now() - it.created.getTime()) <= MAX_AGE_DAYS * 864e5);
      if (mapped.length) {
        timeline = mapped;
        apiCaps = cached.caps || null;
        source = 'x-api-cache';
        const cwhen = cached.when ? new Date(cached.when) : null;
        console.error(`[refresh] X API unavailable — reusing last good cached harvest x-activity.json (${mapped.length} recent real items, harvested ${cwhen && !isNaN(cwhen.getTime()) ? fmtDate(cwhen) : 'unknown'}).`);
      }
    } catch(e){}
  }

  if (!timeline) {
    source = 'syndication';
    // Harvest the auth-free syndication timeline; cache to timeline-raw.json. If the live fetch fails,
    // fall back to the cached copy so a transient network blip never blanks the site.
    let raw = await harvestLive();
    if (raw) {
      try { fs.writeFileSync(RAW, raw); console.error('[refresh] Syndication harvest OK — cached timeline-raw.json.'); }
      catch(e){ console.error('[refresh] Syndication harvest OK (cache write failed: ' + e.message + ').'); }
    } else {
      console.error('[refresh] Syndication harvest unavailable — falling back to cached timeline-raw.json.');
      try { raw = fs.readFileSync(RAW, 'utf8').replace(/^\uFEFF/, ''); }
      catch(e){ console.error('[refresh] No cached timeline-raw.json either. Keeping existing signals.json.'); process.exit(3); }
    }
    timeline = parseTimeline(raw);
    if (!timeline) { console.error('[refresh] Could not parse the harvested timeline. Keeping existing signals.json.'); process.exit(3); }
  }

  const reposts = await ingestList('reposts.json', 'repost');   // only posts + reposts are surfaced

  // Merge + de-dup by id (keep richest kind: post > repost).
  const byId = new Map();
  for (const it of [...timeline, ...reposts]) {
    if (!it || isNaN(it.created.getTime())) continue;
    const ex = byId.get(it.id);
    if (!ex || KIND_RANK[it.kind] < KIND_RANK[ex.kind]) byId.set(it.id, it);
  }
  const all = [...byId.values()].sort((a, b) => b.created - a.created);
  const now = Date.now();
  const eligible = all.filter(t => (now - t.created.getTime()) <= MAX_AGE_DAYS * 864e5);
  const pastWeek = all.filter(t => (now - t.created.getTime()) <= PAST_WEEK_DAYS * 864e5);

  const counts = { entries: timeline.length, posts: 0, reposts: 0, likes: 0, bookmarks: 0, uniques: all.length, eligible: eligible.length, pastWeek: pastWeek.length };
  for (const t of timeline) { const key = t.kind + 's'; if (counts[key] != null) counts[key]++; }
  counts.reposts += reposts.length; // owner-provided reposts.json
  const newest = all.length ? fmtDate(all[0].created) : '(none)';
  console.error(`[refresh] timeline=${counts.entries} (posts ${counts.posts}, reposts ${counts.reposts}); uniques ${counts.uniques}; newest ${newest}; eligible(<=${MAX_AGE_DAYS}d) ${counts.eligible}; past-week ${counts.pastWeek}.`);

  // A successfully-parsed harvest is enough; if nothing parsed at all, refuse to overwrite (broken harvest).
  if (!timeline.length) { console.error('[refresh] Timeline parsed but empty — keeping existing signals.json.'); process.exit(4); }
  if (!pastWeek.length) console.error('[refresh] No posts/reposts in the past week — using the most recent topical post per prediction (honestly dated), else a live search.');

  // ---- 3. Per-post relevance scoring → tiered per-PREDICTION assignment --------------------------
  // Score every eligible post against every PREDICTION (one per event); build (prediction, post) pairs.
  // Past-week posts get +WEEK_BOOST so they win when present; otherwise the best recent topical post is
  // used. Greedy assignment guarantees each post maps to one prediction and each prediction to one post,
  // so each prediction surfaces a DISTINCT @peterxing item (no post is reused across predictions).
  const cands = [];
  for (const p of PREDICTIONS) {
    for (const t of eligible) {
      const { score, solid, hit } = scorePost(t.text, p);
      if (score < MIN_SCORE || solid < 1) continue;
      const ageDays = (now - t.created.getTime()) / 864e5;
      const tier = ageDays <= PAST_WEEK_DAYS ? 'week' : 'recent';
      const eff = score + (tier === 'week' ? WEEK_BOOST : 0);
      cands.push({ id: p.id, year: p.year, p, t, score, eff, tier, hit, created: t.created });
    }
  }
  cands.sort((a, b) => b.eff - a.eff || b.score - a.score || b.created - a.created);

  const usedPosts = new Set();
  const takenSlots = new Set();
  const picks = {};
  for (const c of cands) {
    if (usedPosts.has(c.t.id) || takenSlots.has(c.id)) continue;
    usedPosts.add(c.t.id); takenSlots.add(c.id); picks[c.id] = c;
  }

  // Build one embed (or search fallback) per prediction, keyed by "YEAR-INDEX". The X API harvest already
  // carries fresh metrics/text, so no extra per-pick liveness call is needed (avoids ~57 round-trips).
  const embeds = {}; const search = {}; const chosen = {};
  for (const p of PREDICTIONS) {
    const c = picks[p.id];
    if (!c) { search[p.id] = p.search; continue; }
    const pick = c.t;
    let { likes: lk, rts, created, author } = pick;
    let text = cleanText(pick.text);
    const prevE = prevEmbeds[p.id];
    if ((!rts || rts === 0) && prevE && prevE.id === pick.id && prevE.rts) rts = prevE.rts;
    if (text.length > 160) text = text.slice(0, 157) + '\u2026';
    embeds[p.id] = { id: pick.id, kind: pick.kind, author: author || 'peterxing', recency: c.tier, date: fmtDate(created), maps: p.maps, text, likes: lk, rts: rts || 0 };
    chosen[p.id] = `${pick.kind}:@${author} [${c.tier} s${c.score}] ${c.hit.slice(0, 4).join('/')}`;
  }

  // ---- 4. Reality Signals grid: pick his most notable RECENT real item per theme --------------------
  // Surfaces @peterxing's own recent posts/reposts as "datapoints already on the board", one per theme,
  // refreshed daily. Items already shown under a prediction are skipped so the grid adds fresh variety;
  // each card prefers a past-week item, then keyword strength, then engagement (likes+rts), then recency.
  const usedReality = new Set(usedPosts);
  const realityAll = [];
  for (const th of REALITY_THEMES) {
    let best = null;
    for (const t of eligible) {
      if (usedReality.has(t.id)) continue;
      const { s, hit } = themeScore(t.text, th.kws);
      if (s < 1) continue;
      const ageDays = (now - t.created.getTime()) / 864e5;
      const week = ageDays <= PAST_WEEK_DAYS;
      const eng = (t.likes || 0) + (t.rts || 0);
      const rank = (week ? 1000 : 0) + s * 40 + Math.min(eng, 60) + (1 - ageDays / MAX_AGE_DAYS) * 10;
      if (!best || rank > best.rank) best = { t, s, hit, week, eng, rank };
    }
    if (!best) continue;
    usedReality.add(best.t.id);
    let rtext = cleanText(best.t.text); if (rtext.length > 150) rtext = rtext.slice(0, 147) + '\u2026';
    realityAll.push({ tag: th.tag, t: rtext, id: best.t.id, kind: best.t.kind, author: best.t.author || 'peterxing',
      recency: best.week ? 'week' : 'recent', date: fmtDate(best.t.created), likes: best.t.likes || 0, rts: best.t.rts || 0, _eng: best.eng });
  }
  // Keep the 6 strongest: past-week first, then most-engaged. Drop the internal sort key.
  realityAll.sort((a, b) => (b.recency === 'week') - (a.recency === 'week') || b._eng - a._eng);
  const reality = realityAll.slice(0, 6).map(({ _eng, ...r }) => r);

  const out = {
    updated: new Date().toISOString(),
    note: 'Per-PREDICTION @peterxing X signals matched daily by refresh-signals.js — every individual prediction (keyed "YEAR-INDEX"), not just every year, is mapped to its own distinct real @peterxing item. The Reality-Signals grid (reality[]) is likewise filled daily with his most notable recent real post/repost per theme. Primary source is the authenticated X API v2 (realtime): his POSTS and REPOSTS always, plus his LIKES and BOOKMARKS when a user-context token is configured. The script derives match terms from each prediction\'s own title (the year\'s curated keywords apply to that year\'s headline prediction) and assigns each prediction its single most relevant real item via greedy one-to-one matching: a past-week item is preferred, otherwise his most recent item on that topic (honestly dated, recency:"recent"), else a live from:peterxing search. Falls back to the auth-free syndication scrape if the API is unavailable.',
    source,
    embeds, search, reality,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

  const kindTally = {}; const tierTally = {};
  for (const y in embeds) { const e = embeds[y]; kindTally[e.kind] = (kindTally[e.kind] || 0) + 1; tierTally[e.recency] = (tierTally[e.recency] || 0) + 1; }
  const sampleBy = (k) => eligible.filter(t => t.kind === k).slice(0, 6).map(t => ({ id: t.id, author: t.author, date: fmtDate(t.created), text: cleanText(t.text).slice(0, 90) }));
  fs.writeFileSync(DBG, JSON.stringify({ updated: out.updated, source, apiCaps, counts, predictions: PREDICTIONS.length, matched: Object.keys(embeds).length, searches: Object.keys(search).length, embedKinds: kindTally, embedTiers: tierTally, reality: reality.map(r => `${r.tag}: ${r.kind}:@${r.author} [${r.recency}] ${r.date}`), chosen, sampleReposts: sampleBy('repost'), sampleLikes: sampleBy('like'), sampleBookmarks: sampleBy('bookmark') }, null, 2) + '\n');

  console.error(`[refresh] Wrote signals.json: ${Object.keys(embeds).length}/${PREDICTIONS.length} predictions embedded [${Object.entries(kindTally).map(([k, v]) => v + ' ' + k).join(', ')}] {${Object.entries(tierTally).map(([k, v]) => v + ' ' + k).join(', ')}}, ${Object.keys(search).length} searches, ${reality.length} reality cards.`);
  console.log(JSON.stringify({ embeds: chosen, search: Object.keys(search), reality: reality.map(r => r.tag) }));
})();
