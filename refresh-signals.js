// refresh-signals.js — match @peterxing's newest relevant X activity to every REHOBOAM prediction,
// and write signals.json (loaded by index.html at runtime).
//
// HARVEST (X API v2 primary, live public RSS secondary)
//   PRIMARY: the authenticated X API v2 (x-client.js → harvestActivity()). Using @peterxing's app
//   credentials (pap-secrets/.env), it pulls his realtime timeline — POSTS + REPOSTS always, plus his
//   LIKES + BOOKMARKS when a user-context token is configured (see X-API-SETUP.md).
//   SECONDARY: a fresh read-only RSS snapshot of his public profile. Fresh API/RSS reads always run
//   before caches; caches older than SOURCE_CACHE_MAX_HOURS are rejected rather than called "latest".
//   The legacy X syndication feed is last-resort only because it can lag the real profile by months.
//
// SOURCES & ACCESS
//   posts     : original @peterxing tweets + quote-tweets.
//   reposts   : tweets @peterxing retweeted (native retweets — returned by the API; the syndication
//               fallback only sees them if a foreign-author entry appears, or via optional reposts.json).
//   likes     : tweets @peterxing liked — requires an OAuth1/OAuth2 user-context token (X-API-SETUP.md).
//   bookmarks : tweets @peterxing bookmarked — requires an OAuth2 user-context token (bookmark.read).
//
// MATCHING (newest valid signal first)
//   The prediction set is loaded from predictions.json (revised DAILY from the latest news + his posts —
//   predictions are added / updated / removed there, not here). Every post is scored against every
//   prediction: phrase(3) + strong-word(2) + weak-word(1). After relevance, solidity, and facet guards,
//   candidates rank by recency tier and timestamp before relevance tie-breakers. A signal can support a
//   small bounded number of related predictions (MAX_POST_REUSE) to improve coverage without repetition.
//   Predictions with no valid signal fall back to an honest live from:peterxing search.
//
//   node refresh-signals.js                 # harvest + match + write signals.json (+ optional reposts.json)
//   MAX_AGE_DAYS=365 SOURCE_CACHE_MAX_HOURS=36 MAX_POST_REUSE=3 node refresh-signals.js
const fs = require('fs');
const path = require('path');
const https = require('https');

const DIR = __dirname;
const RAW = path.join(DIR, 'timeline-raw.json');
const OUT = path.join(DIR, 'signals.json');
const DBG = path.join(DIR, 'signals-debug.json');
const PRED = path.join(DIR, 'predictions.json'); // daily-revised prediction set (source of truth)
const RECENT_DAYS = Number(process.env.RECENT_DAYS || 7); // kept for back-compat (unused directly)
// MIN_SCORE and the facet guards gate weak/spurious matches before recency is considered.
const PAST_WEEK_DAYS = Number(process.env.PAST_WEEK_DAYS || 7);
const MAX_AGE_DAYS   = Number(process.env.MAX_AGE_DAYS || 800);
const MIN_SCORE      = 2;
const SOURCE_CACHE_MAX_HOURS = Number(process.env.SOURCE_CACHE_MAX_HOURS) || 36;
const SYNDICATION_MAX_ITEM_AGE_DAYS = Number(process.env.SYNDICATION_MAX_ITEM_AGE_DAYS) || 30;
const MAX_POST_REUSE = Math.max(1, Number(process.env.MAX_POST_REUSE) || 3);
const SKIP_LIVE = process.env.X_SKIP_LIVE === '1';
const SKIP_API = process.env.X_SKIP_API === '1';
const SYND_URL = 'https://syndication.twitter.com/srv/timeline-profile/screen-name/peterxing?showReplies=false&lang=en&dnt=true';
const RSS_URL = 'https://nitter.net/peterxing/rss';
const KIND_RANK = { post: 0, repost: 1, like: 2, bookmark: 3 }; // de-dup priority: keep the richest kind
const SECRET_DIR = 'C:\\Users\\peterxing\\pap-secrets';
const ACT = path.join(SECRET_DIR, 'x-activity.json'); // non-served raw activity dump
const RSS_CACHE = path.join(SECRET_DIR, 'x-public-rss-cache.json'); // non-served parsed public RSS cache

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
  + 'standard standards process processes feature features version versions content channel channels '
  + 'research researches researched researching science scientific progress progresses progressed progressing '
  + 'control controls controlled controlling expert experts expertise value valuable values valued work works '
  + 'working form forms power powers post posts half short').split(/\s+/));
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
  const hw = topicVariants(headline);
  if (!hw.size) return 0;
  let best = 0, bestScore = -1;
  events.forEach((e, i) => {
    const ew = topicVariants(e && e.t);
    let s = 0; for (const w of ew) if (hw.has(w)) s++;
    if (s > bestScore) { bestScore = s; best = i; }
  });
  return best;
}
function topicVariants(text){
  const out = new Set();
  for (const w of String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/)) {
    if (!w || w === 'ai' || STOP.has(w)) continue;
    out.add(w);
    if (w.length > 4 && w.endsWith('s')) out.add(w.slice(0, -1));
    else if (w.length > 3) out.add(w + 's');
  }
  return out;
}
function termMatchesTopic(term, topic){
  const words = String(term || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
  return words.some(w => topic.has(w) || (w.length > 4 && w.endsWith('s') && topic.has(w.slice(0, -1))));
}

// "Reality Signals" themes: each card on the site's Reality-Signals grid is filled daily with @peterxing's
// most notable RECENT real item on that theme (his actual post/repost text + link), so the grid evolves
// with his timeline. Keywords are matched whole-word (multi-word phrases matched as substrings).
const REALITY_THEMES = [
  { tag: 'LABOUR',     kws: ['jobs', 'unemployment', 'layoff', 'layoffs', 'hiring', 'workforce', 'labor', 'labour', 'employment', 'white collar', 'wages', 'salary', 'ubi', 'recent graduate'] },
  { tag: 'CODE',       kws: ['code', 'coding', 'software', 'developer', 'developers', 'engineer', 'engineering', 'programming', 'programmer', 'agent', 'agents', 'agentic', 'vibe coding', 'devin', 'copilot'] },
  { tag: 'ROBOTS',     kws: ['robot', 'robots', 'humanoid', 'optimus', 'figure', 'automation', 'android', 'teleoperation', 'physical ai', 'unitree'] },
  { tag: 'CAPABILITY', kws: ['agi', 'asi', 'benchmark', 'reasoning', 'gpt', 'claude', 'gemini', 'grok', 'model', 'models', 'intelligence', 'superintelligence', 'llm', 'llms', 'frontier', 'o3', 'deepseek'] },
  { tag: 'MARKETS',    kws: ['market', 'markets', 'market cap', 'valuation', 'ipo', 'fund', 'funding', 'invest', 'investment', 'economy', 'stock', 'revenue', 'raise', 'nvidia', 'openai'] },
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
        const slot = { id: y.year + '-' + i, year: y.year, evIndex: i, domain: e.d || '', maps: e.t,
          search: (i === hi && m.search) ? m.search : ev.search,
          phrases: ev.phrases.slice(), strong: [], sw: ev.sw.slice(), weak: [] };
        if (i === hi && hasCur) { // headline event keeps the curated high-quality terms
           const topic = topicVariants(`${m.headline || ''} ${e.t}`);
           slot.phrases = [...new Set([...cur.phrases.filter(t => termMatchesTopic(t, topic)), ...slot.phrases])];
           slot.strong = cur.strong.filter(t => termMatchesTopic(t, topic));
           slot.weak = cur.weak.filter(t => termMatchesTopic(t, topic));
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
function get(url, redirects = 0){
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Accept': 'application/rss+xml,application/xml,text/xml,text/html,application/xhtml+xml,application/json',
      'Accept-Language': 'en-US,en;q=0.9'
    } }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirects < 3) {
        const next = new URL(r.headers.location, url).toString();
        r.resume();
        res(get(next, redirects + 1));
        return;
      }
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

function xmlText(s){
  return String(s || '')
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>|<\/div>|<\/blockquote>|<\/li>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
function rssField(block, tag){
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? xmlText(m[1]) : '';
}
function parseRss(raw){
  const blocks = String(raw || '').match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];
  const items = [];
  for (const block of blocks) {
    const rawTitle = rssField(block, 'title');
    const creator = rssField(block, 'dc:creator').replace(/^@/, '') || 'peterxing';
    const link = rssField(block, 'link');
    const guid = rssField(block, 'guid');
    const idMatch = `${guid} ${link}`.match(/\b(\d{15,})\b/);
    const created = new Date(rssField(block, 'pubDate'));
    if (!idMatch || isNaN(created.getTime()) || !rawTitle) continue;
    const isRepost = /^RT by @peterxing:\s*/i.test(rawTitle) || creator.toLowerCase() !== 'peterxing';
    const title = rawTitle.replace(/^RT by @peterxing:\s*/i, '').trim();
    const description = rssField(block, 'description');
    const text = (description && !description.startsWith(title) ? `${title} ${description}` : (description || title)).slice(0, 8000);
    items.push({ id: idMatch[1], created, text, likes: 0, rts: 0, author: creator, kind: isRepost ? 'repost' : 'post' });
  }
  const byId = new Map();
  for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => b.created - a.created);
}
async function harvestRss(){
  try {
    const r = await get(RSS_URL);
    if (!r || r.status !== 200 || !r.body || r.body.length < 500) return null;
    const items = parseRss(r.body);
    return items.length ? items : null;
  } catch(e){ return null; }
}
function mapCachedItems(items){
  return (Array.isArray(items) ? items : [])
    .map(it => ({ id: String(it.id || ''), created: new Date(it.created), text: it.text || '', likes: it.likes || 0,
      rts: it.rts || 0, author: it.author || 'peterxing', kind: it.kind || 'post' }))
    .filter(it => /^\d{15,}$/.test(it.id) && !isNaN(it.created.getTime()));
}
function ageHours(when){
  const d = new Date(when);
  return isNaN(d.getTime()) ? Infinity : Math.max(0, (Date.now() - d.getTime()) / 36e5);
}
function recencyRank(created, now){
  const days = Math.max(0, (now - created.getTime()) / 864e5);
  if (days <= 1) return 4;
  if (days <= PAST_WEEK_DAYS) return 3;
  if (days <= 30) return 2;
  if (days <= 180) return 1;
  return 0;
}

// Score a post's text against one prediction. Returns score + `solid` (count of high-specificity hits):
// a hit is solid if it's a phrase, a curated strong term, or a single word that is topical (DOMAIN) or
// long enough to be specific (>=7 chars and not in SOFT). A match with solid===0 (only generic single
// words) is rejected so a lone common word can't bind a post to an unrelated prediction.
function scorePost(text, p){
  const norm = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  let score = 0, solid = 0, specificSingles = 0, phraseHits = 0; const hit = []; const concepts = new Set();
  const concept = w => w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w;
  for (const ph of (p.phrases || [])) if (norm.includes(' ' + ph + ' ') || norm.includes(' ' + ph)) {
    score += 3; solid++; phraseHits++; hit.push(ph);
  }
  for (const w of (p.strong || [])) if (norm.includes(' ' + w)) {
    score += 2; solid++; concepts.add(concept(w)); hit.push(w);
  }
  for (const w of (p.sw || [])) if (norm.includes(' ' + w + ' ') || norm.includes(' ' + w + 's ') || (w.endsWith('s') && norm.includes(' ' + w.slice(0, -1) + ' '))) {
    score += 2;
    if (DOMAIN.has(w)) { solid++; concepts.add(concept(w)); }
    else if (w.length >= 7 && !SOFT.has(w)) { specificSingles++; concepts.add(concept(w)); }
    hit.push(w);
  }
  if (specificSingles >= 2) solid++;
  for (const w of (p.weak || []))   if (norm.includes(' ' + w + ' ')) { score += 1; hit.push(w); }
  return { score, solid, coverage: concepts.size + phraseHits * 2, hit };
}

// Conservative facet checks keep broad keyword overlap from implying support for a more specific claim.
// A failed guard uses the live-search fallback instead, which is safer than a misleading real-item card.
const FACET_GUARDS = [
  {
    domains: new Set(['governance', 'geopolitical']),
    title: /\b(?:managed branch|governance|government|regulation|regulator|treaty|law|policy|pause|safety|alignment|verification|transparency|negotiations?|reviews?|thresholds?|inspections?|declarations?|audits?|control|caps?|permits?|jurisdictions?|requirements?|rules?|handoff)\b/,
    text: /\b(?:governance|government|regulation|regulator|treaty|law|policy|pause|safety|alignment|verification|transparency|negotiations?|reviews?|thresholds?|inspections?|declarations?|audits?|control|caps?|permits?|jurisdictions?|requirements?|rules?|risk|evaluation|interpretability|deception|misalignment|expert|diplomacy|agreement)\b/,
  },
  {
    title: /\b(?:alignment|deception|sabotage|misalignment)\b/,
    text: /\b(?:alignment|safety|risk|evaluation|interpretability|deception|sabotage|misalignment|control)\b/,
  },
  {
    title: /\b(?:safety bottleneck|internal deployment)\b/,
    all: [
      /\b(?:ai|model|models|frontier|lab|labs|compute|training|deployment)\b/,
      /\b(?:safety|risk|evaluation|evals|internal deployment|control|security)\b/,
    ],
  },
  {
    title: /\b(?:release review|review becomes standard|cyber bio|autonomy thresholds?)\b/,
    all: [
      /\b(?:ai|model|models|frontier|agi|lab|labs)\b/,
      /\b(?:review|evaluation|evals?|thresholds?|safety|risk|regulation|policy|standard|cyber|biosecurity|autonomy)\b/,
    ],
  },
  {
    title: /\b(?:negotiations?|negotiate|bilateral|deal|treaty|accord)\b/,
    all: [
      /\b(?:us|u s|united states|china|chinese|international|bilateral)\b/,
      /\b(?:negotiations?|negotiate|deal|treaty|agreement|accord|diplomacy|talks|inspections?|declarations?)\b/,
    ],
  },
  {
    title: /\b(?:managed branch|pause|pauses|paused|moratorium|halt|freeze)\b/,
    all: [
      /\b(?:ai|model|models|frontier|training|compute|capability|capabilities|agi|asi)\b/,
      /\b(?:pause|pauses|paused|moratorium|halt|freeze|suspend|slow|slowed|limits?|training cap|compute cap|cap training|cap compute)\b/,
    ],
  },
  {
    title: /\b(?:factory lines?|live factory|production lines?)\b/,
    text: /\b(?:factory|factories|manufacturing|production line|assembly line|deployed|deployment|deployments)\b/,
  },
  {
    title: /\b(?:caps or auctions permits|caps permits|auctions permits|compute permits|robot production permits)\b/,
    all: [
      /\b(?:compute|ai|model|training|robot|robots|robotics|production)\b/,
      /\b(?:cap|caps|capped|auction|auctions|quota|quotas|limit|limits|regulation|regulated|allocation)\b/,
    ],
  },
  {
    title: /\b(?:concentrates?|concentration|handful|control over frontier)\b/,
    text: /\b(?:concentrates?|concentration|oligopoly|monopoly|dominance|handful|few companies|few labs|centralized|centralised|power over|control over)\b/,
  },
  {
    title: /\b(?:ai|artificial intelligence)\b/,
    text: /\b(?:ai|artificial intelligence|agi|asi|model|models|agent|agents|robot|robots|llm|llms|gpt|claude|gemini|deepseek|qwen|codex|nvidia|benchmark|fable|frontier|lab|labs|compute)\b/,
  },
  {
    title: /\b(?:coding|software|research|r d|scientific)\b/,
    text: /\b(?:code|coding|software|programming|programmer|developer|engineering|research|researcher|r d|algorithm|training|scientific|science|experiment|discovery|design|manufacturing|tapeout|lab|labs|compute)\b/,
  },
  {
    title: /\b(?:paid|revenue|income|tax|taxes|gdp|output|dollar|dollars)\b/,
    text: /\b(?:paid|revenue|income|tax|taxes|gdp|output|dollar|dollars|profit|sales|wage|salary|funding|investment|rent|rents|earn|earns|earnings)\b/,
  },
  {
    title: /\b(?:economic|economically|economy|workforce|employment|jobs)\b/,
    text: /\b(?:economic|economically|economy|workforce|employment|jobs|work|labor|labour|revenue|market|income|gdp|output|price|profit|sales|wage|salary|funding|investment|forecast|forecasts|shipment|shipments|units)\b/,
  },
  {
    title: /\b(?:valuation|valuations|market cap)\b/,
    text: /\b(?:valuation|valuations|valued|worth|market cap|stock|shares)\b/,
  },
  {
    title: /\b(?:tax|taxes|taxation|rents?|levies|levy)\b/,
    text: /\b(?:tax|taxes|taxation|rents?|levies|levy)\b/,
  },
  {
    title: /\b(?:citizen s dividend|citizen dividend|recurring dividend|ai dividend)\b/,
    text: /\b(?:dividend|ubi|universal basic income|citizen payment|cash payment|basic income|income floor)\b/,
  },
  {
    title: /\b(?:doubling|double|doubles)\b/,
    text: /\b(?:doubling|double|doubles|exponential)\b/,
  },
  {
    title: /\b(?:thousand|thousands|million|millions|billion|billions)\b/,
    text: /\b(?:thousand|thousands|million|millions|billion|billions|mass|scale|scaling)\b/,
  },
  {
    title: /\b(?:compute reaches|terawatt|terawatts|h100 equivalents|h100)\b/,
    all: [
      /\b(?:compute|gpu|gpus|chip|chips|h100|data center|data centers|datacenter|datacenters)\b/,
      /\b(?:terawatt|terawatts|gigawatt|gigawatts|billion|billions|equivalent|equivalents|capacity)\b/,
    ],
  },
  {
    title: /(?=.*\b(?:one third|one tenth|half|majority|85|95)\b)(?=.*\b(?:labor|labour|tasks?|work|cognitive|physical)\b)/,
    all: [
      /\b(?:labor|labour|tasks?|work|jobs?|workforce|cognitive|physical)\b/,
      /\b(?:percent|percentage|half|third|tenth|majority|most|85|95|one in|two in)\b/,
    ],
  },
  {
    title: /\b(?:contributes at least|economic output|share of output)\b/,
    all: [
      /\b(?:economic|economy|gdp|output|production|productivity)\b/,
      /\b(?:percent|percentage|share|fraction|20|quarter|fifth)\b/,
    ],
  },
  {
    title: /\b(?:seven figures|seven figure)\b/,
    text: /\b(?:seven figures|seven figure|million|millions|1m|1 million)\b/,
  },
  {
    title: /\b(?:interpretability|human understandable|translate internal|model reasoning)\b/,
    text: /\b(?:interpretability|interpretable|explain|explanation|translated|translation|human understandable|summary|summaries|reasoning trace|chain of thought|transparent|transparency)\b/,
  },
  {
    title: /\b(?:space|off world|orbital|lunar|moon|mars)\b/,
    text: /\b(?:space|off world|orbital|orbit|lunar|moon|mars|rocket|starship|spacex)\b/,
  },
  {
    title: /\bessentially all\b/,
    all: [
      /\b(?:automate|automates|automated|automation|perform|performs|do)\b/,
      /\b(?:labor|labour|work|jobs|tasks|economically)\b/,
      /\b(?:all|everything|every|essentially|nearly|almost|95|99)\b/,
    ],
  },
];
function passesFacetGuards(text, p){
  const normText = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const normTitle = String(p.maps || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return FACET_GUARDS.every(g => {
    if ((g.domains && !g.domains.has(p.domain)) || !g.title.test(normTitle)) return true;
    return g.all ? g.all.every(rx => rx.test(normText)) : g.text.test(normText);
  });
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

  // Source order: authenticated X API -> live public RSS -> live legacy syndication / fresh caches.
  // A cache beyond SOURCE_CACHE_MAX_HOURS is never accepted as "latest".
  let timeline = null; let apiCaps = null; let source = 'live-search'; let sourceWhen = null;
  const sourceAttempts = [];
  const staleSourcesRejected = [];
  if (SKIP_LIVE || SKIP_API) {
    sourceAttempts.push({ source: SKIP_LIVE ? 'live-sources' : 'x-api', status: 'skipped-by-env', count: 0 });
  } else {
    try {
      const xc = require('./x-client.js');
      const act = await xc.harvestActivity({ maxPosts: 300 });
      if (act && act.items && act.items.length) {
        timeline = mapCachedItems(act.items);
        apiCaps = act.caps;
        source = 'x-api';
        sourceWhen = new Date();
        // Non-served debug dump (kept OUT of pap-deploy so the raw feed — incl. private bookmarks — is never served).
        try { fs.writeFileSync(ACT, JSON.stringify({ id: act.id, caps: act.caps, when: sourceWhen.toISOString(), items: act.items.slice(0, 300) }, null, 2)); } catch(e){}
        sourceAttempts.push({ source: 'x-api', status: 'live', count: timeline.length });
        console.error(`[refresh] X API harvest: ${timeline.length} items (posts ${act.caps.posts}, reposts ${act.caps.reposts}, likes ${act.caps.likes}, bookmarks ${act.caps.bookmarks}).`);
      } else {
        sourceAttempts.push({ source: 'x-api', status: 'unavailable', count: 0 });
        console.error('[refresh] X API harvest returned nothing — trying the live public RSS profile.');
      }
    } catch(e){
      sourceAttempts.push({ source: 'x-api', status: 'error', detail: e.message });
      console.error('[refresh] X API harvest error (' + e.message + ') — trying the live public RSS profile.');
    }
  }

  if (!timeline && !SKIP_LIVE) {
    const rss = await harvestRss();
    if (rss && rss.length) {
      timeline = rss;
      source = 'public-rss';
      sourceWhen = new Date();
      sourceAttempts.push({ source: 'public-rss', status: 'live', count: rss.length });
      try {
        fs.writeFileSync(RSS_CACHE, JSON.stringify({
          when: sourceWhen.toISOString(),
          items: rss.map(it => ({ ...it, created: it.created.toISOString() })),
        }, null, 2));
      } catch(e){}
      console.error(`[refresh] Live public RSS harvest: ${rss.length} items; newest ${fmtDate(rss[0].created)}.`);
    } else {
      sourceAttempts.push({ source: 'public-rss', status: 'unavailable', count: 0 });
      console.error('[refresh] Live public RSS unavailable — checking other live/fresh sources.');
    }
  }

  // The legacy syndication endpoint is fetched before caches, but accepted only when it contains a
  // genuinely recent item; it is known to return a months-old profile slice even on a successful fetch.
  let syndicationCandidate = null;
  if (!timeline && !SKIP_LIVE) {
    let raw = await harvestLive();
    if (raw) {
      const parsed = parseTimeline(raw) || [];
      if (parsed.length) {
        parsed.sort((a, b) => b.created - a.created);
        const newestAgeDays = Math.max(0, (Date.now() - parsed[0].created.getTime()) / 864e5);
        if (newestAgeDays <= SYNDICATION_MAX_ITEM_AGE_DAYS) {
          syndicationCandidate = { source: 'syndication', when: new Date(), newest: parsed[0].created, items: parsed };
          sourceAttempts.push({ source: 'syndication', status: 'live', count: parsed.length, newestAgeDays: Number(newestAgeDays.toFixed(1)) });
        } else {
          staleSourcesRejected.push({ source: 'syndication', reason: 'newest-item-too-old', newestAgeDays: Number(newestAgeDays.toFixed(1)) });
          sourceAttempts.push({ source: 'syndication', status: 'stale-feed', count: parsed.length, newestAgeDays: Number(newestAgeDays.toFixed(1)) });
        }
        try { fs.writeFileSync(RAW, raw); } catch(e){}
      }
    } else {
      sourceAttempts.push({ source: 'syndication', status: 'unavailable', count: 0 });
    }
  }

  // Fresh caches are eligible only inside the explicit age window. Choose the freshest accepted cache;
  // a stale cache is diagnostic evidence, not a source for public "latest" cards.
  if (!timeline) {
    const cacheCandidates = [];
    try {
      const cached = JSON.parse(fs.readFileSync(ACT, 'utf8').replace(/^\uFEFF/, ''));
      const mapped = mapCachedItems(cached && cached.items);
      const hours = ageHours(cached && cached.when);
      if (mapped.length) {
        if (hours <= SOURCE_CACHE_MAX_HOURS) {
          cacheCandidates.push({ source: 'x-api-cache', when: new Date(cached.when),
            newest: new Date(Math.max(...mapped.map(it => it.created.getTime()))), items: mapped, caps: cached.caps || null });
          sourceAttempts.push({ source: 'x-api-cache', status: 'fresh-cache', count: mapped.length, ageHours: Number(hours.toFixed(1)) });
        } else {
          staleSourcesRejected.push({ source: 'x-api-cache', reason: 'harvest-too-old', ageHours: Number.isFinite(hours) ? Number(hours.toFixed(1)) : null });
          sourceAttempts.push({ source: 'x-api-cache', status: 'rejected-stale-cache', count: mapped.length, ageHours: Number.isFinite(hours) ? Number(hours.toFixed(1)) : null });
        }
      }
    } catch(e){}
    try {
      const cached = JSON.parse(fs.readFileSync(RSS_CACHE, 'utf8').replace(/^\uFEFF/, ''));
      const mapped = mapCachedItems(cached && cached.items);
      const hours = ageHours(cached && cached.when);
      if (mapped.length) {
        if (hours <= SOURCE_CACHE_MAX_HOURS) {
          cacheCandidates.push({ source: 'public-rss-cache', when: new Date(cached.when),
            newest: new Date(Math.max(...mapped.map(it => it.created.getTime()))), items: mapped });
          sourceAttempts.push({ source: 'public-rss-cache', status: 'fresh-cache', count: mapped.length, ageHours: Number(hours.toFixed(1)) });
        } else {
          staleSourcesRejected.push({ source: 'public-rss-cache', reason: 'harvest-too-old', ageHours: Number.isFinite(hours) ? Number(hours.toFixed(1)) : null });
          sourceAttempts.push({ source: 'public-rss-cache', status: 'rejected-stale-cache', count: mapped.length, ageHours: Number.isFinite(hours) ? Number(hours.toFixed(1)) : null });
        }
      }
    } catch(e){}
    if (syndicationCandidate) cacheCandidates.push(syndicationCandidate);
    cacheCandidates.sort((a, b) => b.newest - a.newest || b.when - a.when);
    const chosenSource = cacheCandidates[0];
    if (chosenSource) {
      timeline = chosenSource.items;
      source = chosenSource.source;
      sourceWhen = chosenSource.when;
      apiCaps = chosenSource.caps || null;
      console.error(`[refresh] Using ${source}: ${timeline.length} items; source age ${ageHours(sourceWhen).toFixed(1)}h.`);
    }
  }

  if (!timeline) {
    timeline = [];
    source = 'live-search';
    sourceWhen = new Date();
    sourceAttempts.push({ source: 'live-search', status: 'fallback', count: 0 });
    console.error('[refresh] No fresh verified activity source is available — stale embeds are rejected; publishing live-search fallbacks.');
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

  // An unavailable fresh source is an explicit search-only state; stale cards are never carried forward.
  if (!pastWeek.length) console.error('[refresh] No posts/reposts in the past week — using the most recent topical post per prediction (honestly dated), else a live search.');

  // ---- 3. Per-post relevance scoring -> newest-valid per-PREDICTION assignment --------------------
  // Relevance, solidity, and facet guards are hard gates. Among valid candidates, recency tier and exact
  // timestamp rank before relevance tie-breakers. A post may support a bounded number of related events.
  const candidateLists = {};
  for (const p of PREDICTIONS) {
    const cands = [];
    for (const t of eligible) {
      const { score, solid, coverage, hit } = scorePost(t.text, p);
      if (score < MIN_SCORE || solid < 1 || !passesFacetGuards(t.text, p)) continue;
      const ageDays = (now - t.created.getTime()) / 864e5;
      const tier = ageDays <= PAST_WEEK_DAYS ? 'week' : 'recent';
      cands.push({ id: p.id, year: p.year, p, t, score, coverage, recencyRank: recencyRank(t.created, now), tier, hit, created: t.created });
    }
    cands.sort((a, b) => b.recencyRank - a.recencyRank || b.created - a.created || b.score - a.score || b.coverage - a.coverage);
    candidateLists[p.id] = cands;
  }

  const postUses = new Map();
  const usedPosts = new Set();
  const picks = {};
  // Assign the most constrained predictions first so bounded reuse does not crowd out niche topics.
  const allocationOrder = PREDICTIONS.slice().sort((a, b) =>
    candidateLists[a.id].length - candidateLists[b.id].length || a.year - b.year || a.evIndex - b.evIndex);
  for (const p of allocationOrder) {
    const pick = candidateLists[p.id].find(c => (postUses.get(c.t.id) || 0) < MAX_POST_REUSE);
    if (!pick) continue;
    picks[p.id] = pick;
    postUses.set(pick.t.id, (postUses.get(pick.t.id) || 0) + 1);
    usedPosts.add(pick.t.id);
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
    chosen[p.id] = `${pick.kind}:@${author} [${c.tier} r${c.recencyRank} s${c.score} c${c.coverage}] ${c.hit.slice(0, 4).join('/')}`;
  }

  // ---- 4. Reality Signals grid: pick his most notable RECENT real item per theme --------------------
  // Surfaces @peterxing's own recent posts/reposts as "datapoints already on the board", one per theme,
  // refreshed hourly. Unused prediction items get a variety bonus, but used items remain eligible so a
  // small live feed can still produce a complete Reality Signals grid without stale data.
  const usedReality = new Set();
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
      const rank = (week ? 1000 : 0) + (!usedPosts.has(t.id) ? 200 : 0) + s * 40 + Math.min(eng, 60) + (1 - ageDays / MAX_AGE_DAYS) * 10;
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
  let reality = realityAll.slice(0, 6).map(({ _eng, ...r }) => r);
  if (reality.length < 6) {
    const present = new Set(reality.map(r => r.tag));
    for (const th of REALITY_THEMES) {
      if (reality.length >= 6) break;
      if (present.has(th.tag)) continue;
      reality.push({
        tag: th.tag,
        t: `Open the latest @peterxing posts about ${th.tag.toLowerCase()} when no fresh relevant item is available.`,
        kind: 'search',
        search: th.kws.slice(0, 3).join(' '),
      });
    }
  }

  const sourceAgeHours = ageHours(sourceWhen);
  const newestItemAt = all.length ? all[0].created.toISOString() : null;
  const newestItemAgeHours = all.length ? Math.max(0, (Date.now() - all[0].created.getTime()) / 36e5) : null;
  const sourceFresh = source !== 'live-search' && sourceAgeHours <= SOURCE_CACHE_MAX_HOURS;
  const reusedPosts = [...postUses.values()].filter(v => v > 1).length;
  const out = {
    updated: new Date().toISOString(),
    note: `Per-prediction @peterxing signals are refreshed hourly from the authenticated X API first, then a live read-only public RSS profile. Caches older than ${SOURCE_CACHE_MAX_HOURS} hours and stale legacy syndication snapshots are rejected rather than labeled current. Each prediction is matched to the newest item that first passes relevance, solidity, and facet guards; timestamp outranks topical score only after those gates. A signal may support at most ${MAX_POST_REUSE} closely related predictions; otherwise the prediction receives an honest live from:peterxing search. The Reality Signals grid follows the same fresh source.`,
    source,
    sourceFetchedAt: sourceWhen ? sourceWhen.toISOString() : null,
    sourceFresh,
    newestItemAt,
    embeds, search, reality,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

  const kindTally = {}; const tierTally = {};
  for (const y in embeds) { const e = embeds[y]; kindTally[e.kind] = (kindTally[e.kind] || 0) + 1; tierTally[e.recency] = (tierTally[e.recency] || 0) + 1; }
  const sampleBy = (k) => eligible.filter(t => t.kind === k).slice(0, 6).map(t => ({ id: t.id, author: t.author, date: fmtDate(t.created), text: cleanText(t.text).slice(0, 90) }));
  fs.writeFileSync(DBG, JSON.stringify({
    updated: out.updated,
    source,
    sourceFresh,
    sourceFetchedAt: out.sourceFetchedAt,
    sourceAgeHours: Number.isFinite(sourceAgeHours) ? Number(sourceAgeHours.toFixed(2)) : null,
    newestItemAt,
    newestItemAgeHours: newestItemAgeHours == null ? null : Number(newestItemAgeHours.toFixed(2)),
    sourceCacheMaxHours: SOURCE_CACHE_MAX_HOURS,
    sourceAttempts,
    staleSourcesRejected,
    apiCaps,
    counts,
    predictions: PREDICTIONS.length,
    matched: Object.keys(embeds).length,
    freshMatches: sourceFresh ? Object.keys(embeds).length : 0,
    searches: Object.keys(search).length,
    maxPostReuse: MAX_POST_REUSE,
    uniqueMatchedPosts: usedPosts.size,
    reusedPosts,
    embedKinds: kindTally,
    embedTiers: tierTally,
    reality: reality.map(r => r.kind === 'search' ? `${r.tag}: live search` : `${r.tag}: ${r.kind}:@${r.author} [${r.recency}] ${r.date}`),
    chosen,
    sampleReposts: sampleBy('repost'),
    sampleLikes: sampleBy('like'),
    sampleBookmarks: sampleBy('bookmark'),
  }, null, 2) + '\n');

  console.error(`[refresh] Wrote signals.json from ${source}: ${Object.keys(embeds).length}/${PREDICTIONS.length} predictions embedded using ${usedPosts.size} unique posts (reuse cap ${MAX_POST_REUSE}) [${Object.entries(kindTally).map(([k, v]) => v + ' ' + k).join(', ')}] {${Object.entries(tierTally).map(([k, v]) => v + ' ' + k).join(', ')}}, ${Object.keys(search).length} searches, ${reality.length} reality cards.`);
  console.log(JSON.stringify({ embeds: chosen, search: Object.keys(search), reality: reality.map(r => r.tag) }));
})();
