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
const SEMANTIC_MAX_AGE_DAYS = Number(process.env.SEMANTIC_MAX_AGE_DAYS) || 30;
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

// Controlled concept expansion catches defensible semantic relationships that literal title words miss
// (for example, "tape-out" -> semiconductors, "physicians" -> health, or "FSD" -> physical robotics).
// `solo` concepts are specific enough to qualify on their own; broad concepts require corroboration.
const MATCH_CONCEPTS = [
  { name: 'agi', weight: 2, solo: true, rx: /\b(?:agi|asi|superintelligen\w*|human level|human expert|top expert|arc agi)\b/ },
  { name: 'capability', weight: 2, solo: false, rx: /\b(?:reasoning|benchmark|intelligence|sota|outperform\w*|beats? experts?|human performance|physician written|fewer flaws)\b/ },
  { name: 'agents', weight: 2, solo: true, rx: /\b(?:agent|agents|agentic|autonomous|subagents?|copilot|tool use|long horizon|ai advisors?|delegate to ai)\b/ },
  { name: 'coding', weight: 2, solo: true, rx: /\b(?:code|coding|software|developer|programming|programmer|swe|algorithm|atcoder|codex|cursor)\b/ },
  { name: 'research', weight: 2, solo: true, rx: /\b(?:research|science|scientist|proof|theorem|conjecture|math|physics|discovery|r d)\b/ },
  { name: 'labor', weight: 2, solo: true, rx: /\b(?:job|jobs|employment|workforce|labor|labour|workers?|white collar|unemployment|knowledge work|freelance|human work)\b/ },
  { name: 'robotics', weight: 2, solo: true, rx: /\b(?:robot|robots|robotic|robotics|robotaxi|humanoid|optimus|neo|physical ai|self driving|fsd)\b/ },
  { name: 'production', weight: 1.5, solo: false, rx: /\b(?:manufactur\w*|factor(?:y|ies)|production|tape out|actuator|motor|assembly line)\b/ },
  { name: 'compute', weight: 2, solo: false, rx: /\b(?:compute|gpu|gpus|chip|chips|semiconductor|datacenter|data center|parameters?|tokens per second|tps|inference|2nm|h100)\b/ },
  { name: 'energy', weight: 2, solo: false, rx: /\b(?:energy|grid|solar|storage|battery|nuclear|fusion|electricity|gwh|gigawatt|terawatt)\b/ },
  { name: 'health', weight: 2, solo: true, rx: /\b(?:health|medical|medicine|physician|drug|disease|cancer|vaccine|biotech|longevity|gene|genome|embryo|crispr|patient)\b/ },
  { name: 'governance', weight: 1.5, solo: false, rx: /\b(?:policy|law|regulat\w*|government|treaty|permit|safety|evaluation|evals?|audit|verification|transparen\w*|pause|slowdown|slow|slowed|agreement|deal)\b/ },
  { name: 'geopolitics', weight: 1.5, solo: false, rx: /\b(?:china|chinese|united states|u s|america|international|national|eu|europe|bilateral)\b/ },
  { name: 'economy', weight: 1, solo: false, rx: /\b(?:revenue|valuation|market|gdp|econom\w*|income|trillion|billion|investment|stock|cost|price|sales|monetization)\b/ },
  { name: 'distribution', weight: 2, solo: true, rx: /\b(?:dividend|ubi|universal high income|wealth|public fund|equity stake|tax|rents?|redistribution)\b/ },
  { name: 'alignment', weight: 2, solo: true, rx: /\b(?:alignment|deception|sabotage|interpretability|honesty|obedience|misalignment|control problem)\b/ },
  { name: 'interpretability', weight: 2, solo: true, rx: /\b(?:mechanistic|interpretab\w*|internal representations?|latent activations?|reasoning trace|global workspace)\b/ },
  { name: 'persuasion', weight: 2, solo: true, rx: /\b(?:persuasion|manipulation|deepfake|truth seeking|targeted influence)\b/ },
  { name: 'rights', weight: 2, solo: true, rx: /\b(?:rights|legal right|welfare|legal status|moral agents?|consciousness|self awareness|sentien\w*)\b/ },
  { name: 'bci', weight: 2, solo: true, rx: /\b(?:neuralink|brain computer|bci|neural implant|brain implant|intracortical|ecog|stentrode|endovascular bci)\b/ },
  { name: 'connectomics', weight: 2, solo: true, rx: /\b(?:connectom\w*|whole brain emulation|functional emulation|brain preservation|mind upload\w*|digital immortal\w*)\b/ },
  { name: 'orbitalcompute', weight: 2, solo: true, rx: /\b(?:orbital compute|orbital data cent(?:er|re)|space data cent(?:er|re)|starcloud|project suncatcher)\b/ },
  { name: 'civilizationalenergy', weight: 2, solo: true, rx: /\b(?:kardashev|type i civilization|type ii civilization|dyson swarm|stellar energy)\b/ },
  { name: 'transcension', weight: 2, solo: true, rx: /\b(?:transcension hypothesis|computational densification|inner space)\b/ },
  { name: 'ruliad', weight: 2, solo: true, rx: /\b(?:ruliad|rulial|wolfram physics)\b/ },
  { name: 'augmentation', weight: 2, solo: true, rx: /\b(?:neural symbiosis|sensory restoration|human augmentation|bidirectional neural)\b/ },
  { name: 'institutions', weight: 1, solo: false, rx: /\b(?:corporations?|courts?|public services?|military|business|politics|election|government)\b/ },
  { name: 'education', weight: 2, solo: true, rx: /\b(?:education|students?|teach|teaching|learning|school|university|critical thinking)\b/ },
  { name: 'space', weight: 2, solo: false, rx: /\b(?:space|orbital|orbit|starlink|moon|lunar|mars|off world|spacex)\b/ },
  { name: 'scenario2040', weight: 2, solo: true, rx: /\b(?:ai 2040|plan a|ai 2027)\b/ },
  { name: 'openmodels', weight: 2, solo: true, rx: /\b(?:open source|open weight|local model|localllama|laptop runnable)\b/ },
  { name: 'privacy', weight: 2, solo: true, rx: /\b(?:privacy|private data|confidential|zero knowledge)\b/ },
  { name: 'biosecurity', weight: 2, solo: true, rx: /\b(?:biosecurity|biodefense|pathogen|pandemic|rapid vaccines?)\b/ },
  { name: 'infrastructure', weight: 1, solo: false, rx: /\b(?:infrastructure|datacenter|data center|factory|grid|capacity|supply chain|chip|energy)\b/ },
  { name: 'scale', weight: 1, solo: false, rx: /\b(?:scale|scaling|exponential|10x|100x|1000x|million|billion|trillion|vertical progress)\b/ },
  { name: 'ai', weight: 0.5, solo: false, rx: /\b(?:ai|ai5|al5|model|models|gpt|claude|fable|grok|llm|llms|openai|anthropic|deepmind|minimax|glm)\b/ },
];
const MATCH_CONCEPT_BY_NAME = new Map(MATCH_CONCEPTS.map(c => [c.name, c]));
function normalizeConceptText(text){
  return String(text || '').toLowerCase().replace(/&(?:amp|gt|lt|quot|apos);/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function detectConcepts(text){
  const norm = normalizeConceptText(text);
  const out = new Set();
  for (const c of MATCH_CONCEPTS) if (c.rx.test(norm)) out.add(c.name);
  if (out.has('research') && /\bburden of proof\b/.test(norm)
      && !/\b(?:research|science|scientist|theorem|conjecture|math|physics|discovery|r d)\b/.test(norm)) {
    out.delete('research');
  }
  if (out.has('education') && /\b(?:continual|machine|deep|reinforcement) learning\b/.test(norm)
      && !/\b(?:education|student|students|teach|teaching|school|university|critical thinking)\b/.test(norm)) {
    out.delete('education');
  }
  if (out.has('energy') && /\b(?:concentrate|political|institutional|government|corporate) power\b/.test(norm)
      && !/\b(?:energy|electricity|grid|solar|battery|storage|nuclear|fusion|gwh|gigawatt|terawatt)\b/.test(norm)) {
    out.delete('energy');
  }
  // Mathematical/representation "spaces" are not off-world activity.
  if (out.has('space') && /\b(?:latent|embedding|activation|coordinate|j|rulial) space\b/.test(norm)
      && !/\b(?:outer space|space power|space solar|spacex|starlink|orbital|orbit|moon|lunar|mars|off world)\b/.test(norm)) {
    out.delete('space');
  }
  return out;
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
  let horizonItems = [];
  try {
    const d = JSON.parse(fs.readFileSync(PRED, 'utf8').replace(/^\uFEFF/, ''));
    if (d && Array.isArray(d.years) && d.years.length) years = d.years;
    if (d && d.postSuperintelligence && Array.isArray(d.postSuperintelligence.items)) {
      horizonItems = d.postSuperintelligence.items;
    }
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
          phrases: ev.phrases.slice(), strong: [], sw: ev.sw.slice(), weak: [], concepts: detectConcepts(e.t) };
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
  for (let i = 0; i < horizonItems.length; i++) {
    const item = horizonItems[i];
    if (!item || !item.id || !item.t) continue;
    const m = item.match || {};
    const ev = deriveEventTerms(item.t);
    const phrases = Array.isArray(m.phrases) ? m.phrases : [];
    const strong = Array.isArray(m.strong) ? m.strong : [];
    const weak = Array.isArray(m.weak) ? m.weak : [];
    const conceptText = [item.t, m.headline, ...phrases, ...strong].filter(Boolean).join(' ');
    out.push({
      id: 'horizon-' + item.id,
      scope: 'horizon',
      year: 2041,
      evIndex: i,
      domain: item.d || '',
      maps: item.t,
      search: m.search || ev.search,
      phrases: [...new Set([...phrases, ...ev.phrases])],
      strong: strong.slice(),
      sw: ev.sw.slice(),
      weak: weak.slice(),
      concepts: detectConcepts(conceptText),
    });
  }
  if (out.length) return out;
  // Offline fallback: inline defaults, one matcher per year (id = YEAR-0).
  return DEFAULT_PREDICTIONS.map(p => ({ id: p.year + '-0', year: p.year, evIndex: 0, maps: p.maps, search: p.search, phrases: p.phrases, strong: p.strong, sw: [], weak: p.weak, concepts: detectConcepts(p.maps) }));
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
  let score = 0, solid = 0, specificSingles = 0, phraseHits = 0; const hit = []; const lexicalConcepts = new Set();
  const concept = w => w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w;
  for (const ph of (p.phrases || [])) if (norm.includes(' ' + ph + ' ') || norm.includes(' ' + ph)) {
    score += 3; solid++; phraseHits++; hit.push(ph);
  }
  for (const w of (p.strong || [])) if (norm.includes(' ' + w)) {
    score += 2; solid++; lexicalConcepts.add(concept(w)); hit.push(w);
  }
  for (const w of (p.sw || [])) if (norm.includes(' ' + w + ' ') || norm.includes(' ' + w + 's ') || (w.endsWith('s') && norm.includes(' ' + w.slice(0, -1) + ' '))) {
    score += 2;
    if (DOMAIN.has(w)) { solid++; lexicalConcepts.add(concept(w)); }
    else if (w.length >= 7 && !SOFT.has(w)) { specificSingles++; lexicalConcepts.add(concept(w)); }
    hit.push(w);
  }
  if (specificSingles >= 2) solid++;
  for (const w of (p.weak || []))   if (norm.includes(' ' + w + ' ')) { score += 1; hit.push(w); }
  const postConcepts = detectConcepts(text);
  const conceptHits = [...(p.concepts || [])].filter(name => postConcepts.has(name));
  const conceptScore = conceptHits.reduce((sum, name) => sum + (MATCH_CONCEPT_BY_NAME.get(name)?.weight || 0), 0);
  const soloConceptHit = conceptHits.some(name => MATCH_CONCEPT_BY_NAME.get(name)?.solo);
  const substantiveConceptHits = conceptHits.filter(name => (MATCH_CONCEPT_BY_NAME.get(name)?.weight || 0) >= 1.5).length;
  const semanticValid = soloConceptHit || (substantiveConceptHits >= 2 && conceptScore >= 2.5);
  return {
    score,
    solid,
    coverage: lexicalConcepts.size + phraseHits * 2 + conceptHits.length,
    hit,
    conceptHits,
    conceptScore,
    semanticValid,
  };
}

// Conservative facet checks keep broad keyword overlap from implying support for a more specific claim.
// A failed guard uses the live-search fallback instead, which is safer than a misleading real-item card.
const FACET_GUARDS = [
  {
    title: /\bpeer reviewed intracortical bci home use surpasses 3 800 hours\b/,
    all: [
      /\b(?:intracortical|neuralink|neural implant|brain implant|implant(?:ed|able) (?:brain computer|brain machine|bci|neural interface)|surgically implanted)\b/,
      /\b(?:home use|at home|independent use|speech|cursor|3 800 hours|3800 hours|prime|clinical trial|early feasibility)\b/,
      /\b(?:peer review|peer reviewed|published|publication|hours|safety|adverse events?|primary endpoints?|efficacy)\b/,
    ],
  },
  {
    title: /\bmanaged branch algorithms are broadly auditable while frontier weights remain controlled against misuse\b/,
    all: [
      /\b(?:audit|audits|auditing|auditable|transparen\w*|inspect\w*)\b/,
      /\b(?:weights?|model access|access control|controlled|closed|restricted|misuse|release control)\b/,
    ],
  },
  {
    title: /\borbital compute remains demonstrator scale through 2026\b/,
    all: [
      /\b(?:orbital|orbit|outer space|in space)\b/,
      /\b(?:compute|gpu|gpus|h100|ai workload|ai workloads|nanogpt|gemma)\b/,
      /\b(?:launched|launch|in orbit|ran|run|running|trained|inference|workload|workloads)\b/,
    ],
  },
  {
    title: /\bpeer review confirms a synapse resolution whole brain connectome for a vertebrate larva\b/,
    all: [
      /\b(?:connectome|connectomic|synapse resolution|synaptic wiring)\b/,
      /\b(?:vertebrate|zebrafish|fish larva|larval fish)\b/,
      /\b(?:peer review|peer reviewed|journal|published|publication|accepted)\b/,
    ],
  },
  {
    title: /\borbital compute platform sustains 1 mw\b/,
    all: [
      /\b(?:orbital compute|orbital data cent(?:er|re)|space data cent(?:er|re)|compute in orbit)\b/,
      /\b(?:1 mw|one megawatt|megawatt class|megawatt scale)\b/,
      /\b(?:radiator|radiators|cooling|heat rejection)\b/,
      /\b(?:named customer|external workload|commercial workload|90 days|ninety days|sustained)\b/,
    ],
  },
  {
    title: /\bimplantable neural interfaces could support high bandwidth bidirectional\b/,
    all: [
      /\b(?:neuralink|neural implant|brain implant|intracortical|ecog|stentrode|endovascular|implant(?:ed|able) (?:brain computer|brain machine|bci|neural interface)|invasive bci|surgically implanted)\b/,
      /\b(?:communication|control|decode|decoding|stimulation|sensory|bidirectional|bandwidth|prosthe\w*)\b/,
    ],
  },
  {
    title: /\bgenuinely non invasive neural interfaces could become a separate\b/,
    all: [
      /\b(?:scalp eeg|eeg|meg|fnirs|transcranial ultrasound|optical brain|external brain)\b/,
      /\b(?:brain|neural|bci|communication|decode|decoding|stimulation)\b/,
    ],
  },
  {
    title: /\bwhole brain emulation could enable digital minds\b/,
    all: [
      /\b(?:whole brain emulation|functional emulation|mind upload|mind uploading|connectome|brain preservation|digital immortal\w*)\b/,
      /\b(?:functional emulation|simulation|dynamic|biochemical|identity continuity|digital minds?|preservation)\b/,
    ],
  },
  {
    title: /\borbital data centres could expand into self growing solar powered compute networks\b/,
    all: [
      /\b(?:orbital|orbit|outer space|off world|space solar|dyson)\b/,
      /\b(?:compute|data cent(?:er|re)|solar|mining|manufactur\w*|self growing|self expand\w*|energy)\b/,
    ],
  },
  {
    title: /\bcivilizational energy use could climb by measurable orders of magnitude toward kardashev\b/,
    all: [
      /\b(?:kardashev|type i civilization|type ii civilization|civilizational energy)\b/,
      /\b(?:energy|power|watts?|orders of magnitude|capture|use|consumption)\b/,
    ],
  },
  {
    title: /\binward transcension branch could favor extreme stem compression\b/,
    text: /\b(?:transcension hypothesis|john smart|universal transcension)\b/,
  },
  {
    title: /\bruliad research could become forecast relevant\b/,
    all: [
      /\b(?:ruliad|rulial|wolfram physics)\b/,
      /\b(?:physics|formalism|prediction|predictions|testable|falsifiable|engineering|computational)\b/,
    ],
  },
  {
    title: /\b(?:genuine human level agi ships by end of 2026|my call.*human level agi)\b/,
    text: /\b(?:agi|human level|superintelligen\w*|artificial general intelligence|clear way to agi)\b/,
  },
  {
    title: /\b(?:humanoid robots move onto live factory lines|mass deployment of humanoid robots)\b/,
    all: [
      /\b(?:humanoid|robot|robots|robotic|robotics|optimus)\b/,
      /\b(?:factory|factories|production line|assembly line|deployment|deployments|deployed|mass deployment)\b/,
    ],
  },
  {
    title: /\b(?:computer workflows?|multi hour workflows?|long horizon workflows?)\b/,
    all: [
      /\b(?:agent|agents|agentic|ai|model|models)\b/,
      /\b(?:workflow|workflows|computer use|browser|desktop|long horizon|multi hour|hours long|task|tasks|benchmark)\b/,
    ],
  },
  {
    title: /\b(?:frontier r d resumes under total research transparency|cross border verification)\b/,
    all: [
      /\b(?:ai r d|ai research|frontier research|frontier lab|frontier labs|model research)\b/,
      /\b(?:transparency|transparent|verification|verify|audit|auditable|inspection|inspections)\b/,
      /\b(?:cross border|international|us and china|u s and china|bilateral|agreement|deal)\b/,
    ],
  },
  {
    title: /\b(?:top human expert capability|every cognitive field)\b/,
    all: [
      /\b(?:ai|model|models|gpt|claude|llm|llms|agi)\b/,
      /\b(?:top expert|human expert|human level|expert level|physician|scientist|researcher|benchmark|benchmarks|sota)\b/,
      /\b(?:every cognitive field|all cognitive fields|across (?:essentially )?(?:every|all|multiple|many) (?:cognitive )?(?:fields?|domains?|disciplines?)|cross domain|multi domain)\b/,
    ],
  },
  {
    title: /\b(?:major powers adopt compute caps|mutually assured compute destruction)\b/,
    all: [
      /\b(?:compute|gpu|gpus|chip|chips|datacenter|data center|training run|training runs)\b/,
      /\b(?:compute cap|compute caps|capped compute|training cap|training caps|mutually assured|destruction|destroy|shutdown|treaty limit)\b/,
    ],
  },
  {
    title: /\b(?:multilateral ai consortium|treaty framework gains support beyond the us and china)\b/,
    text: /\b(?:multilateral|consortium|coalition|multiple countries|allied countries|global treaty|international framework|eu|europe|g7|g20|united nations)\b/,
  },
  {
    title: /\b(?:robotics becomes the binding bottleneck|mines motors actuators fabs and factories)\b/,
    all: [
      /\b(?:robot|robots|robotic|robotics|humanoid|actuator|actuators|motor|motors|factory|factories|manufacturing|fab|fabs|semiconductor)\b/,
      /\b(?:production|scale|scaling|capacity|bottleneck|constraint|cost|investment|capital|tape out|deployment|dexter\w*)\b/,
    ],
  },
  {
    title: /\b(?:compute tracking|inference only verification)\b/,
    all: [
      /\b(?:compute|inference|gpu|gpus|chip|chips|datacenter|data center)\b/,
      /\b(?:tracking|track|verification|verify|audit|measurement|monitoring|reporting|declaration)\b/,
    ],
  },
  {
    title: /\b(?:ai agent copies|paid digital labor)\b/,
    all: [
      /\b(?:ai|agent|agents|agentic|digital|software|virtual workforce)\b/,
      /\b(?:work|labor|labour|worker|workers|revenue|paid|earn|income)\b/,
    ],
  },
  {
    title: /\b(?:continuously running ai agents form a virtual workforce|100 million copies)\b/,
    all: [
      /\b(?:ai agents?|ai workforce|ai workers?|agent copies|virtual workforce|virtual workers?)\b/,
      /\b(?:million|billion|trillion|copies|scale|scaling)\b|\b[1-9]\d{7,}\b/,
    ],
  },
  {
    title: /\b(?:omnibus ai transparency|compute tracking or frontier accountability law)\b/,
    all: [
      /\b(?:ai|frontier|model|models|compute|lab|labs)\b/,
      /\b(?:law|legislation|policy|regulation|regulator|transparency|accountability|tracking|audit|reporting|disclosure)\b/,
    ],
  },
  {
    title: /\b(?:white collar professions?|supervising and coordinating ai agents?)\b/,
    all: [
      /\b(?:white collar|knowledge work|professional|professionals|office work|remote labor|remote work|workforce)\b/,
      /\b(?:ai|agent|agents|agentic|automated|automation|supervis\w*|coordinat\w*)\b/,
    ],
  },
  {
    title: /\b(?:profession by profession training|expert interviews|deployment data)\b/,
    all: [
      /\b(?:training|train|fine tuning|post training|dataset|data|environments?|interviews?|expert feedback|deployment data)\b/,
      /\b(?:profession|professional|expert|domain|occupation|industry)\b/,
    ],
  },
  {
    title: /\b(?:datacenter construction commitments?|defense budget)\b/,
    all: [
      /\b(?:datacenter|data center|compute infrastructure|ai infrastructure|gpu|gpus)\b/,
      /\b(?:construction|buildout|build out|capex|capital expenditure|commitment|commitments|investment|budget|spending|financing|billion|trillion)\b/,
      /\b(?:defense|defence) budget\b|\b(?:annual|yearly|per year)\b.{0,80}\b(?:trillion|9\d{2}\s*billion)\b|\b(?:trillion|9\d{2}\s*billion)\b.{0,80}\b(?:annual|yearly|per year)\b/,
    ],
  },
  {
    title: /\b(?:datacenter power water and grid capacity|infrastructure and political constraints)\b/,
    all: [
      /\b(?:datacenter|data center|energy|electricity|water|grid|solar|battery|storage)\b/,
      /\b(?:capacity|constraint|constraints|bottleneck|bottlenecks|shortage|shortages|gigawatt|gwh|terawatt|scale)\b/,
    ],
  },
  {
    title: /\b(?:physical production energy and robotics|main bottlenecks to ai driven growth)\b/,
    all: [
      /\b(?:physical production|manufacturing|factory|factories|robot|robots|robotics|energy|electricity|grid|battery|storage|gwh|gigawatt|materials|supply chain)\b/,
      /\b(?:bottleneck|bottlenecks|constraint|constraints|capacity|shortage|shortages|scale|scaling|gwh|gigawatt|production)\b/,
    ],
  },
  {
    title: /\b(?:top expert or superintelligent ai follows automated coding|within roughly one year)\b/,
    all: [
      /\b(?:automated coding|coding automation|ai r d|ai research|research automation|recursive self improvement|takeoff)\b/,
      /\b(?:top expert|superintelligen\w*|agi|asi|one year|months|rapid|takeoff)\b/,
    ],
  },
  {
    title: /\b(?:fully automated ai r d|10x research speedup|research speedup)\b/,
    all: [
      /\b(?:ai|model|models|agent|agents|automated|automation)\b/,
      /\b(?:research|science|scientist|discovery|r d|experiment|theorem|conjecture|proof|successors?)\b/,
    ],
  },
  {
    title: /\b(?:full automation of ai r d remains incomplete|coding agents materially accelerate model research)\b/,
    all: [
      /\b(?:coding agent|coding agents|code agent|code agents|software agent|software agents|codex|swe)\b/,
      /\b(?:research|model|models|training|evaluation|eval|evals|benchmark|index)\b/,
    ],
  },
  {
    title: /\b(?:fully automated ai r d delivers roughly a 10x research speedup)\b/,
    all: [
      /\b(?:ai|model|models|gpt|claude|agent|agents|automated)\b/,
      /\b(?:proof|conjecture|theorem|research level|physics problem|scientific discovery|experiment|research benchmark)\b/,
      /\b(?:faster|speedup|accelerat\w*|parallel|hour|hours|day|days|10x|benchmark)\b/,
    ],
  },
  {
    domains: new Set(['governance', 'geopolitical']),
    title: /\b(?:managed branch|governance|government|regulation|regulator|treaty|law|policy|pause|safety|alignment|verification|transparency|negotiations?|reviews?|thresholds?|inspections?|declarations?|audits?|control|caps?|permits?|jurisdictions?|requirements?|rules?|handoff)\b/,
    text: /\b(?:governance|government|regulation|regulator|treaty|law|policy|pause|safety|alignment|verification|transparency|negotiations?|reviews?|thresholds?|inspections?|declarations?|audits?|control|caps?|permits?|jurisdictions?|requirements?|rules?|risk|evaluation|interpretability|deception|misalignment|expert|diplomacy|agreement|deal|talks)\b/,
  },
  {
    title: /\b(?:alignment|deception|sabotage|misalignment)\b/,
    text: /\b(?:alignment|safety|risk|evaluation|interpretability|mechanistic|deception|sabotage|misalignment|control)\b/,
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
    title: /\b(?:pause|pauses|paused|moratorium|halt|freeze)\b/,
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
      /\b(?:compute caps?|training caps?|production caps?|robot caps?|capped compute|capped training|auction|auctions|quota|quotas|compute permit|training permit|frontier permit|production permit|robot production permit)\b/,
    ],
  },
  {
    title: /\b(?:concentrates?|concentration|handful|control over frontier)\b/,
    text: /\b(?:concentrates?|concentration|oligopoly|monopoly|dominance|handful|few companies|few labs|centralized|centralised|power over|control over)\b/,
  },
  {
    title: /\b(?:ai|artificial intelligence)\b/,
    text: /\b(?:ai|ai5|al5|artificial intelligence|agi|asi|model|models|agent|agents|robot|robots|llm|llms|gpt|claude|gemini|deepseek|qwen|codex|nvidia|benchmark|fable|frontier|lab|labs|compute)\b/,
  },
  {
    title: /\b(?:coding|software|research|r d|scientific)\b/,
    text: /\b(?:code|coding|software|programming|programmer|developer|engineering|research|researcher|r d|algorithm|training|scientific|science|physics|experiment|discovery|design|manufacturing|tapeout|lab|labs|compute)\b/,
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
    text: /\b(?:dividend|ubi|uhi|universal basic income|universal high income|citizen payment|cash payment|basic income|income floor)\b/,
  },
  {
    title: /\b(?:doubling|double|doubles)\b/,
    text: /\b(?:doubling|double|doubles|exponential)\b/,
  },
  {
    title: /\b(?:thousand|thousands)\b/,
    text: /\b(?:thousand|thousands|mass|scale|scaling)\b|\b[1-9]\d{3,}\b/,
  },
  {
    title: /\b(?:million|millions)\b/,
    text: /\b(?:million|millions|billion|billions|mass|scale|scaling)\b|\b[1-9]\d{6,}\b/,
  },
  {
    title: /\b(?:billion|billions)\b/,
    text: /\b(?:billion|billions|trillion|trillions|mass|scale|scaling)\b/,
  },
  {
    title: /\b(?:compute reaches|terawatt|terawatts|h100 equivalents|h100)\b/,
    all: [
      /\b(?:compute|gpu|gpus|chip|chips|h100|data center|data centers|datacenter|datacenters)\b/,
      /\b(?:terawatt|terawatts|gigawatt|gigawatts|h100|gpu equivalents?|compute capacity|power capacity)\b/,
    ],
  },
  {
    title: /(?=.*\b(?:one third|one tenth|half|majority|85|95)\b)(?=.*\b(?:labor|labour|tasks?|work|cognitive|physical)\b)/,
    all: [
      /\b(?:labor|labour|tasks?|work|jobs?|workforce|cognitive|physical|robot|robots|robotic|robotics|dexter\w*)\b/,
      /\b(?:percent|percentage|half|third|tenth|majority|most|85|95|one in|two in|equivalent|human workers?|degrees? of freedom|dof|dexter\w*|human input|intervention free|million|billion|trillion)\b/,
    ],
  },
  {
    title: /\b(?:contributes at least|economic output|share of output)\b/,
    all: [
      /\b(?:economic|economy|gdp|output|production|productivity|revenue|worth)\b/,
      /\b(?:percent|percentage|share|fraction|half|majority|quarter|fifth|million|billion|trillion)\b/,
    ],
  },
  {
    title: /\b(?:seven figures|seven figure)\b/,
    text: /\b(?:seven figures|seven figure|million|millions|1m|1 million)\b/,
  },
  {
    title: /\b(?:interpretability|human understandable|translate internal|model reasoning)\b/,
    text: /\b(?:interpretability|interpretable|mechanistic|explain|explanation|translated|translation|human understandable|summary|summaries|reasoning trace|chain of thought|transparent|transparency|internal representation|latent activation|global workspace)\b/,
  },
  {
    title: /\b(?:disease|drug|medical|medicine|health|longevity|cancer|gene|genome|embryo|crispr)\b/,
    text: /\b(?:disease|drug|medical|medicine|health|physician|patient|longevity|cancer|gene|genome|embryo|crispr|biotech|vaccine)\b/,
  },
  {
    title: /\b(?:digital mind rights|ai welfare|moral agent|legal status|consciousness|self awareness|sentience)\b/,
    text: /\b(?:rights|legal right|welfare|moral agents?|legal status|consciousness|self awareness|sentien\w*|digital minds?)\b/,
  },
  {
    title: /\b(?:human uploading|brain computer|neural implant|augmentation)\b/,
    text: /\b(?:human uploading|brain computer|bci|neuralink|neural implant|brain implant|digital minds?)\b/,
  },
  {
    title: /\b(?:education|teaching|learning|school|university)\b/,
    text: /\b(?:education|students?|teach|teaching|learning|school|university|critical thinking)\b/,
  },
  {
    title: /\b(?:privacy|private data|personal data)\b/,
    text: /\b(?:privacy|private data|personal data|confidential|zero knowledge)\b/,
  },
  {
    title: /\b(?:treaty compliance can be verified without revealing|national security data)\b/,
    all: [
      /\b(?:verification|verified|verify|audit|compliance|inspection|proof)\b/,
      /\b(?:privacy|private|confidential|zero knowledge|national security|classified|without revealing)\b/,
    ],
  },
  {
    title: /\b(?:biosecurity|biodefense|pandemic|pathogen|rapid vaccine)\b/,
    text: /\b(?:biosecurity|biodefense|pandemic|pathogen|rapid vaccine|rapid vaccines)\b/,
  },
  {
    title: /\b(?:truth seeking ai advisors?|one size fits all feeds?|search interfaces?)\b/,
    all: [
      /\b(?:assistant|assistants|advisor|advisors|personal agent|personal agents|personal ai)\b/,
      /\b(?:truth|personal|personalized|personalised|feed|feeds|search|information|recommendation)\b/,
    ],
  },
  {
    title: /\b(?:ai advisors become load bearing|business politics courts|parts of the military)\b/,
    all: [
      /\b(?:assistant|assistants|advisor|advisors|copilot|copilots|personal ai)\b/,
      /\b(?:business|enterprise|workplace|m365|office|politics|government|court|courts|legal|military|defense|defence)\b/,
    ],
  },
  {
    title: /\b(?:military r d|strategic weapons?|autonomous strategic weapons?)\b/,
    text: /\b(?:military|weapon|weapons|defense|defence|warfare|strategic systems|nuclear)\b/,
  },
  {
    title: /\b(?:land energy raw materials|dominant scarcities|positional goods)\b/,
    all: [
      /\b(?:land|energy|electricity|grid|solar|raw materials|materials|minerals|resources|housing|property|positional goods)\b/,
      /\b(?:scarcity|scarce|constraint|constraints|bottleneck|bottlenecks|shortage|shortages|dominant)\b/,
    ],
  },
  {
    title: /\b(?:voting civic participation and ownership|main leverage)\b/,
    text: /\b(?:voting|vote|civic|citizen|participation|ownership|equity|political power|economic leverage)\b/,
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

const QUANTITY_TOKEN = '(\\d+(?:\\.\\d+)?[mbt]?|millions|billions|trillions|one|two|three|four|five|six|seven|eight|nine|ten)';
function scaledQuantity(token, unit){
  const wordValues = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const raw = String(token || '').toLowerCase();
  if (raw === 'millions') return 2e6;
  if (raw === 'billions') return 2e9;
  if (raw === 'trillions') return 2e12;
  const suffix = raw.match(/^(\d+(?:\.\d+)?)([mbt])$/);
  if (suffix) return Number(suffix[1]) * ({ m: 1e6, b: 1e9, t: 1e12 }[suffix[2]]);
  const n = wordValues[raw] || Number(raw);
  if (!Number.isFinite(n)) return 0;
  return n * ({ million: 1e6, billion: 1e9, trillion: 1e12 }[unit] || 1);
}
function isUpperBoundBefore(text){
  if (/\b(?:no|not) (?:less|fewer) than\s*$/.test(text)) return false;
  return /\b(?:below|under|just under|less than|fewer than|at most|up to|no more than|not more than|maximum of|nearly|almost|just shy of|shy of|short of|approach(?:es|ed|ing)?|nearing|close to|not yet at)(?: roughly| approximately| about)?\s*$/.test(text);
}
function isUpperBoundAfter(text){
  const withoutLowerBounds = text.replace(/\b(?:no|not) (?:less|fewer) than\b/g, ' at least ');
  return /\b(?:below|under|less than|fewer than|at most|or less|or fewer|maximum|upper bound|no more than)\b/.test(withoutLowerBounds);
}
function isAmbiguousAtThreshold(before){
  return /\b(?:about|around|approximately|roughly|circa)\s*$/.test(before);
}
function hasMonetaryContext(before, bridge, after){
  const money = '(?:currency|nonusd|usd|eur|gbp|jpy|cny|rmb|aud|cad|nzd|hkd|sgd|krw|chf|inr|dollars?|euros?|pounds?|yen|yuan|won|revenue|valuation|valued|worth|market(?: value| valuation)?|price|priced|cost|costs|sold|selling|sale)';
  return new RegExp(`\\b${money}\\b`).test(before)
    || new RegExp(`\\b${money}\\b`).test(bridge || '')
    || new RegExp(`\\b${money}\\b`).test(after);
}
function hasNegativeQuantityContext(before){
  if (/\b(?:no|not) (?:less|fewer) than(?: roughly| approximately| about)?\s*$/.test(before)) return false;
  return /\b(?:no|not|never|cannot|can not|could not|should not|does not|do not|did not|is not|are not|was not|were not|will not|would not|has not|have not|had not|without|fail(?:s|ed)?|unable to|incapable of|not capable of|lack(?:s|ed)?|insufficient)\b(?:\s+[a-z0-9]+)*\s*$/.test(before);
}
function hasNegativeQuantityAfter(after){
  return /^\s*(?:will|would|could|can|may|might|does|do|is|are|was|were)?\s*(?:not|never|n t)\b/.test(after)
    || /^\s*(?:will|would|does|do)\s+(?:not|never)\s+(?:exist|materialize|happen|be reached)\b/.test(after)
    || /^\s*(?:is|are|was|were|remains?|seems?)\s+(?:impossible|unattainable|unreachable|infeasible|not feasible)\b/.test(after);
}
function isTemporalQuantity(token, unit, before){
  if (unit || !/^\d{4}$/.test(token)) return false;
  const year = Number(token);
  return year >= 1900 && year <= 2100
    && (/\b(?:by|in|during|since|until|before|after|around|from|through)(?: the)?(?: calendar year| fiscal year| calendar| fiscal| year)?\s*$/.test(before)
      || /\b(?:calendar|fiscal) year\s*$/.test(before)
      || /\b(?:cy|fy)\s*$/.test(before));
}
function hasCompoundMeasurementAfter(after){
  return /^\s*(?:(?:completed|successful|failed|automated|processed|recorded|executed|finished|cumulative|daily|monthly|annual|total)\s+){0,3}(?:hours?|days?|weeks?|months?|years?|minutes?|seconds?|tokens?|operations?|cycles?|tasks?|task completions?|completions?|requests?|calls?|transactions?|runs?|episodes?|steps?|events?|equivalents?(?!\s+to\b))\b/.test(after);
}
function hasBoundQuantity(normText, nounPattern, minimum, rejectMonetary = false){
  const qFirst = new RegExp(`\\b${QUANTITY_TOKEN}\\s*(million|billion|trillion)?(?:\\s+of)?\\s+(?:${nounPattern})\\b`, 'g');
  const connector = '(?:now|currently|already|will|would|could|can|may|might|projected|expected|has|have|had|is|are|was|were|of|at|least|to|over|above|more|than|with|reach(?:es|ed)?|number(?:s|ed)?|total(?:s|ed)?|scale(?:s|d)?|grow(?:s|n)?|grew|stand(?:s)?|stood|exceed(?:s|ed)?|surpass(?:es|ed)?|start(?:s|ed)?)';
  const nFirst = new RegExp(`\\b(?:${nounPattern})\\b((?:\\s+${connector}){0,7})\\s+${QUANTITY_TOKEN}\\s*(million|billion|trillion)?\\b`, 'g');
  for (const clause of laborClauses(normText)) {
    for (const m of clause.matchAll(qFirst)) {
      const before = clause.slice(0, m.index);
      const after = clause.slice(m.index + m[0].length, m.index + m[0].length + 42);
      if (isUpperBoundBefore(before) || isUpperBoundAfter(after) || hasNegativeQuantityContext(before) || hasNegativeQuantityAfter(after)) continue;
      if (isTemporalQuantity(m[1], m[2], before) || hasCompoundMeasurementAfter(after)) continue;
      if (rejectMonetary && hasMonetaryContext(before.slice(-42), '', after.slice(0, 24))) continue;
      const quantity = scaledQuantity(m[1], m[2]);
      if (quantity === minimum && isAmbiguousAtThreshold(before)) continue;
      if (quantity >= minimum) return true;
    }
    for (const m of clause.matchAll(nFirst)) {
      const bridge = m[1] || '';
      const before = clause.slice(0, m.index);
      const after = clause.slice(m.index + m[0].length, m.index + m[0].length + 42);
      if (/\bequivalent\b/.test(bridge) || isUpperBoundBefore(bridge) || isUpperBoundAfter(after)
          || hasNegativeQuantityContext(before + bridge) || hasNegativeQuantityAfter(after)) continue;
      if (isTemporalQuantity(m[2], m[3], before + bridge) || hasCompoundMeasurementAfter(after)) continue;
      if (rejectMonetary && hasMonetaryContext(before.slice(-42), bridge, after)) continue;
      const quantity = scaledQuantity(m[2], m[3]);
      if (quantity === minimum && isAmbiguousAtThreshold(bridge)) continue;
      if (quantity >= minimum) return true;
    }
  }
  return false;
}
function laborClauses(normText){
  return normText.split(/\b(?:but|however|whereas|although|while)\b|[;!?]|(?:(?<!\d)\.|\.(?!\d))/).map(s => s.trim()).filter(Boolean);
}
const LABOR_ACTOR_SOURCE = '(?:ai(?!\\s+(?:users?|(?:assisted|enabled|augmented|supported|powered|equipped|using)(?:\\s+[a-z]+){0,4}\\s+(?:humans?|people|workers?|employees?|consultants?|contractors?|staff|users?|operators?|professionals?|developers?|analysts?|doctors?|lawyers?|teachers?)))(?: systems?| workers?)?(?: and robots?)?|robots?(?: and ai(?: systems?)?)?|models?|agents?|automation)';
const LABOR_ACTION_SOURCE = '(?:perform(?:s|ed)?|produc(?:e|es|ed)|provid(?:e|es|ed)|contribut(?:e|es|ed)|do|does|did|complet(?:e|es|ed)|automat(?:e|es|ed)|handl(?:e|es|ed)|account(?:s|ed)? for|make(?:s)? up)';
const LABOR_ACTOR = new RegExp(`\\b${LABOR_ACTOR_SOURCE}\\b`, 'g');
const LABOR_ACTION = new RegExp(`\\b${LABOR_ACTION_SOURCE}\\b`);
const LABOR_NEGATION = /\b(?:no|not|never|no longer|cannot|can not|could not|should not|does not|do not|did not|is not|are not|was not|were not|will not|would not|has not|have not|had not|fail(?:s|ed)?|unable|incapable|lack(?:s|ed)?|below|under|less than|at most|only)\b/;
const HUMAN_LABOR_ACTOR_SOURCE = '(?:humans?|people|workers?|employees?|consultants?|contractors?|staff|users?|operators?|professionals?|developers?|analysts?|doctors?|lawyers?|teachers?)';
const HUMAN_LABOR_ACTOR = new RegExp(`\\b${HUMAN_LABOR_ACTOR_SOURCE}\\b`);
function hasInterveningHumanSubject(text){
  return new RegExp(`\\b(?:and|but|while|whereas|although)\\s+(?:the\\s+)?${HUMAN_LABOR_ACTOR_SOURCE}(?:\\s+[a-z0-9]+){0,2}\\s*$`).test(text)
    || new RegExp(`\\b(?:enable|enables|enabled|allow|allows|allowed|help|helps|helped|assist|assists|assisted|empower|empowers|empowered)\\s+(?:the\\s+)?${HUMAN_LABOR_ACTOR_SOURCE}(?:\\s+to)?\\s*$`).test(text)
    || new RegExp(`\\b(?:used|operated|directed|controlled)\\s+by\\s+(?:the\\s+)?${HUMAN_LABOR_ACTOR_SOURCE}(?:\\s+to)?\\s*$`).test(text)
    || new RegExp(`\\b${HUMAN_LABOR_ACTOR_SOURCE}(?:\\s+(?!(?:and|then|but)\\b)[a-z0-9]+){0,2}\\s*$`).test(text);
}
function positiveActorActionBefore(prefix){
  const actions = [...prefix.matchAll(new RegExp(LABOR_ACTION.source, 'g'))];
  const action = actions[actions.length - 1];
  if (!action) return false;
  const actors = [...prefix.slice(0, action.index).matchAll(LABOR_ACTOR)];
  const actor = actors[actors.length - 1];
  if (!actor) return false;
  const leading = prefix.slice(0, actor.index);
  const between = prefix.slice(actor.index + actor[0].length, action.index);
  const relation = prefix.slice(Math.max(0, actor.index - 12));
  if (HUMAN_LABOR_ACTOR.test(leading) || hasInterveningHumanSubject(between) || LABOR_NEGATION.test(relation)) return false;
  return true;
}
function positiveActorShareBefore(prefix){
  const shares = [...prefix.matchAll(/\b(?:share|portion|fraction|percentage)\b/g)];
  const share = shares[shares.length - 1];
  if (!share) return false;
  const actors = [...prefix.slice(0, share.index).matchAll(LABOR_ACTOR)];
  const actor = actors[actors.length - 1];
  if (!actor || HUMAN_LABOR_ACTOR.test(prefix.slice(0, actor.index))) return false;
  if (hasInterveningHumanSubject(prefix.slice(actor.index + actor[0].length, share.index))) return false;
  return !LABOR_NEGATION.test(prefix.slice(Math.max(0, actor.index - 12)));
}
function hasBoundLaborPercent(normText, minimum, scope, exclusive = false){
  const passive = new RegExp(`^\\s*(?:of\\s+)?(?:the\\s+)?${scope.source}\\s+(?:is|are|was|were)\\s+(?:performed|produced|provided|done|completed|automated|handled)\\s+by\\s+${LABOR_ACTOR_SOURCE}\\b`);
  const scopeAfter = new RegExp(`^\\s*(?:of\\s+)?(?:the\\s+)?${scope.source}`);
  for (const clause of laborClauses(normText)) {
    for (const m of clause.matchAll(/\b(\d+(?:\.\d+)?) percent\b/g)) {
      const value = Number(m[1]);
      const prefix = clause.slice(Math.max(0, m.index - 130), m.index);
      const suffix = clause.slice(m.index + m[0].length, m.index + m[0].length + 130);
      if (isUpperBoundBefore(prefix) || isUpperBoundAfter(suffix)) continue;
      const lowerQualifier = /\b(?:more than|over|above|greater than)\s*$/.test(prefix);
      if (value < minimum || (exclusive && value === minimum && !lowerQualifier)) continue;
      const active = scopeAfter.test(suffix) && positiveActorActionBefore(prefix);
      const passiveMatch = passive.exec(suffix);
      const passiveOk = !!passiveMatch && !LABOR_NEGATION.test(passiveMatch[0]);
      const shareOk = scope.test(prefix.slice(-100)) && positiveActorShareBefore(prefix);
      if (active || passiveOk || shareOk) return true;
    }
  }
  return false;
}
function hasTwoJobsLeft(normText){
  for (const clause of laborClauses(normText)) {
    const claim = clause.match(/\b(?:exactly )?two jobs left\b/);
    if (!claim) continue;
    const prefix = clause.slice(0, claim.index);
    if (/\b(?:if|assuming|suppose|supposing|hypothetically)\b/.test(prefix)) continue;
    const actors = [...prefix.matchAll(LABOR_ACTOR)];
    const actor = actors[actors.length - 1];
    if (actor && !LABOR_NEGATION.test(prefix.slice(Math.max(0, actor.index - 12)))) return true;
  }
  return false;
}
function hasNearTotalEconomicLabor(normText){
  if (hasTwoJobsLeft(normText)) return true;
  for (const clause of laborClauses(normText)) {
    const scope = clause.match(/\b(?:nearly all|almost all|all) (?:economically valuable )?(?:jobs|work|labor|labour)\b/);
    if (scope && positiveActorActionBefore(clause.slice(0, scope.index))) return true;
    const optional = clause.match(/\bwork (?:will be |becomes? )?optional\b/);
    if (optional && positiveActorActionBefore(clause.slice(0, optional.index))) return true;
  }
  return false;
}
function hasExplicitPhysicalLimitation(normText){
  const actor = '(?:ai(?: systems?)?|robots?|automation)';
  const inability = '(?:cannot|could not|does not|do not|did not|fail(?:s|ed)? to|(?:is|are|was|were) not able to|(?:is|are|was|were) not capable of|(?:is|are|was|were) unable to|(?:is|are|was|were) incapable of|lack(?:s|ed)?(?: the)? (?:ability|capacity) to)';
  const physical = '(?:economically valuable )?(?:physical|real world|manual) (?:labor|labour|work|tasks?)';
  return new RegExp(`\\beverything\\b[\\s\\S]{0,100}\\b(?:except|excluding|apart from|other than|but(?: not)?|without)\\b[\\s\\S]{0,60}\\b(?:physical|real world|manual)\\b`).test(normText)
    || new RegExp(`\\b${actor}\\b[\\s\\S]{0,160}\\b${inability}\\b[^.!?;]{0,50}\\b(?:perform|do|handle|automate|complete)?\\s*(?:the\\s+)?${physical}\\b`).test(normText)
    || new RegExp(`\\b${physical}\\b[^.!?;]{0,70}\\b(?:remain(?:s|ed)? (?:human|manual|unautomated|out of reach)|(?:is|are|was|were) beyond (?:its|their|the) capabilities|(?:cannot|could not) be (?:performed|handled|automated|completed) by ${actor}|(?:is|are|was|were) not (?:performed|handled|automated|completed) by ${actor})\\b`).test(normText)
    || new RegExp(`\\b${actor}\\b[^.!?;]{0,70}\\b(?:has|have|had) (?:physical )?(?:capabilities?|ability|capacity) (?:below|short of|insufficient for)[^.!?;]{0,40}\\b${physical}\\b`).test(normText);
}
function hasNearTotalCognitivePhysicalTasks(normText){
  if (hasExplicitPhysicalLimitation(normText)) return false;
  for (const clause of laborClauses(normText)) {
    const scope = clause.match(/\b(?:nearly all|almost all|all) (?:cognitive and physical|physical and cognitive) (?:work|tasks)\b/);
    if (scope && positiveActorActionBefore(clause.slice(0, scope.index))) return true;
    const everything = clause.match(/\beverything\b/);
    const prefix = everything ? clause.slice(0, everything.index) : '';
    if (everything && /\brobots?\b/.test(prefix) && !/\b(?:digitally|digital only|software only)\b/.test(clause)
        && positiveActorActionBefore(clause.slice(0, everything.index))) return true;
  }
  return false;
}
function hasCognitiveLaborMajority(normText){
  if (hasTwoJobsLeft(normText)) return true;
  if (hasBoundLaborPercent(normText, 50, /\b(?:cognitive labor|cognitive labour|cognitive work|cognitive tasks)\b/, true)) return true;
  for (const clause of laborClauses(normText)) {
    const majority = clause.match(/\b(?:more than half|(?:a|the) majority|most) (?:of )?(?:all )?cognitive (?:labor|labour|work|tasks)\b/);
    if (majority && (positiveActorActionBefore(clause.slice(0, majority.index))
        || new RegExp(`^\\s*(?:is|are|was|were)\\s+(?:performed|produced|provided|done)\\s+by\\s+${LABOR_ACTOR_SOURCE}\\b`).test(clause.slice(majority.index + majority[0].length)))) return true;
    const comparison = clause.match(/\bmore cognitive (?:labor|labour|work) than humans?\b/);
    if (comparison && positiveActorActionBefore(clause.slice(0, comparison.index))) return true;
    const owned = clause.match(new RegExp(`\\b${LABOR_ACTOR_SOURCE}(?: s)?\\s+cognitive (?:labor|labour|work|tasks)\\s+(?:exceeds?|outnumbers?) (?:that of )?humans?\\b`));
    if (owned && !LABOR_NEGATION.test(owned[0])) return true;
  }
  return false;
}

function normalizeGuardText(text){
  return String(text || '').toLowerCase()
    .replace(/(^|[\r\n]|[.!?;]\s*)(\d{4})\s*[:\u2013\u2014-]\s*/g, '$1 calendar year $2 ')
    .replace(/\bcan[’']t\b/g, ' cannot ')
    .replace(/\bwon[’']t\b/g, ' will not ')
    .replace(/\b([a-z]+)n[’']t\b/g, '$1 not')
    .replace(/\b[\d,]+\b/g, m => {
      if (!m.includes(',')) return m;
      return /^\d{1,3}(?:,\d{3})+$/.test(m) ? m.replace(/,/g, '') : ' invalidnumber ';
    })
    .replace(/\b\d+(?:\.\d+){2,}\b/g, ' invalidnumber ')
    .replace(/<=|≤/g, ' at most ')
    .replace(/>=|≥/g, ' at least ')
    .replace(/<(?![=>])/g, ' less than ')
    .replace(/>(?![=])/g, ' more than ')
    .replace(/(\d)\.(\d)/g, '$1decimalpoint$2')
    .replace(/\b(?:usd|us)\s*\$/g, ' usd ')
    .replace(/\b([a-z]{2,3})\s*\$/g, ' nonusd $1 ')
    .replace(/\ba\s*\$/g, ' nonusd aud ')
    .replace(/\bc\s*\$/g, ' nonusd cad ')
    .replace(/\br\s*\$/g, ' nonusd brl ')
    .replace(/\bs\s*\$/g, ' nonusd sgd ')
    .replace(/\$/g, ' usd ')
    .replace(/€/g, ' eur ')
    .replace(/£/g, ' gbp ')
    .replace(/¥/g, ' jpy cny ')
    .replace(/₩/g, ' krw ')
    .replace(/₹/g, ' inr ')
    .replace(/\p{Sc}/gu, ' nonusd currency ')
    .replace(/%/g, ' percent ')
    .replace(/[^a-z0-9.;!?]+/g, ' ')
    .replace(/(\d)decimalpoint(\d)/g, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAgentRevenueAttribution(clause, amountIndex){
  const prefix = clause.slice(0, amountIndex);
  const verbs = [...prefix.matchAll(/\b(?:generat(?:e|es|ed|ing)|earn(?:s|ed|ing)?|produc(?:e|es|ed|ing)|bring(?:s|ing)? in)\b/g)];
  const verb = verbs[verbs.length - 1];
  if (!verb) return false;
  const beforeVerb = prefix.slice(0, verb.index);
  const agents = [...beforeVerb.matchAll(/\b(?:ai agents?|agent copies|copies of ai agents?|virtual workers?)\b/g)];
  const agent = agents[agents.length - 1];
  if (!agent) return false;
  const humans = [...beforeVerb.matchAll(new RegExp(`\\b${HUMAN_LABOR_ACTOR_SOURCE}\\b`, 'g'))];
  const human = humans[humans.length - 1];
  if (human && human.index > agent.index) return false;
  const competingActors = [...beforeVerb.matchAll(/\b(?:platform|company|business|firm|service|marketplace|network|customers?|clients?|owners?|organization|organisation)\b/g)];
  const competingActor = competingActors[competingActors.length - 1];
  if (competingActor && competingActor.index > agent.index) return false;
  if (competingActor && competingActor.index < agent.index) {
    const dependency = beforeVerb.slice(competingActor.index + competingActor[0].length, agent.index);
    if (/\b(?:with|for|employ(?:s|ed|ing)?|host(?:s|ed|ing)?|use(?:s|d|ing)?|manage(?:s|d|ing)?|serve(?:s|d|ing)?|support(?:s|ed|ing)?|run(?:s|ning)?)\b/.test(dependency)) return false;
  }
  return !LABOR_NEGATION.test(prefix.slice(agent.index, verb.index + verb[0].length));
}

function disattributesAgentRevenue(normText){
  return /\b(?:none|zero) of (?:that|the|this) (?:revenue|income|earnings) (?:comes?|came|is|was) (?:from|generated by|earned by) (?:the )?(?:ai )?agents?\b/.test(normText)
    || /\b(?:revenue|income|earnings) (?:does|do|did|is|was) not (?:come|comes|came|generated|earned) (?:from|by) (?:the )?(?:ai )?agents?\b/.test(normText)
    || /\bno (?:revenue|income|earnings) (?:is|was) (?:generated|earned|produced) by (?:the )?(?:ai )?agents?\b/.test(normText);
}

const SIMULATED_SCALE_CONTEXT = /\b(?:simulat\w*|computer generated|renders?|rendered|rendering|game engine|online game|computer game|mobile game|browser game|multiplayer game|video game|role playing game|rpg|gaming world|game server|game world|virtual world|virtual scene|virtual factory|metaverse|synthetic world|synthetic environment|synthetic dataset|digital twin|test environment|mock environment)\b/;
const NON_USD_CURRENCY = /\b(?:nonusd|aud|cad|nzd|hkd|sgd|twd|brl|mxn|jpy|cny|rmb|krw|eur|gbp|chf|inr|australian|canadian|new zealand|hong kong|singapore|taiwan|japanese|chinese|korean|euro|sterling|rupees?)\b/;
function hasBoundComputeScale(normText){
  for (const clause of laborClauses(normText)) {
    if (SIMULATED_SCALE_CONTEXT.test(clause)) continue;
    if (!/\b(?:ai compute|compute|gpu|gpus|h100|data center|data centers|datacenter|datacenters)\b/.test(clause)) continue;
    for (const multi of clause.matchAll(/\bmulti terawatt\b/g)) {
      const before = clause.slice(0, multi.index);
      const after = clause.slice(multi.index + multi[0].length, multi.index + multi[0].length + 42);
      if (!isUpperBoundBefore(before) && !isAmbiguousAtThreshold(before)
          && !hasNegativeQuantityContext(before) && !hasNegativeQuantityAfter(after)
          && !hasCompoundMeasurementAfter(after)) return true;
    }
    if (hasBoundQuantity(clause, '(?:terawatts?|tw)', 2)
        || hasBoundQuantity(clause, '(?:h100 equivalents?|gpu equivalents?|h100s?)', 1e9, true)) return true;
  }
  return false;
}

function passesFacetGuards(text, p){
  const normText = normalizeGuardText(text);
  const normTitle = String(p.maps || '').toLowerCase().replace(/%/g, ' percent ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\bmost production software is written end to end by ai\b/.test(normTitle)) {
    return laborClauses(normText).some(clause =>
      /\b(?:ai|model|models|agent|agents|coding agent|software agent|codex)\b/.test(clause)
      && /\b(?:code|coding|software|application|applications|production system|production systems)\b/.test(clause)
      && /\b(?:most|majority|end to end|fully|entirely|without human coding|writes? the code|written by ai|autonomous software development)\b/.test(clause)
      && /\b(?:production software|software industry|software ecosystem|industry wide|across companies|most companies|most codebases)\b/.test(clause));
  }
  if (/\bdatacenter power water and grid capacity become top tier infrastructure and political constraints\b/.test(normTitle)) {
    return /\b(?:datacenter|data center|compute campus|ai infrastructure)\b/.test(normText)
      && /\b(?:power|electricity|water|grid)\b/.test(normText)
      && /\b(?:capacity|constraint|bottleneck|shortage|moratorium|permit|politic\w*|opposition|interconnection)\b/.test(normText);
  }
  if (/\bmost white collar professions in leading economies revolve around supervising and coordinating ai agents\b/.test(normTitle)) {
    return /\b(?:white collar|knowledge work|professional|professionals|profession|professions|office work)\b/.test(normText)
      && /\b(?:ai agents?|agentic|artificial intelligence)\b/.test(normText)
      && /\b(?:supervis\w*|coordinat\w*|restructur\w*|reorganiz\w*|redesign\w*|most professions|majority of professions|work revolves around)\b/.test(normText);
  }
  if (/\bsuperintelligence emerges and recursive self improvement begins on my ungoverned 2028 2030 branch\b/.test(normTitle)) {
    return /\b(?:superintelligence|asi|intelligence explosion)\b/.test(normText)
      && /\b(?:recursive self improvement|self improving|improves? itself|intelligence explosion|automated successor|recursive takeoff)\b/.test(normText);
  }
  if (/\bmanaged branch frontier r d resumes under total research transparency and cross border verification\b/.test(normTitle)) {
    return /\b(?:resume|resumes|resumed|restart|restarts|restarted|reopen|reopens|reopened)\b/.test(normText)
      && /\b(?:ai r d|ai research|frontier research|model research)\b/.test(normText)
      && /\b(?:transparency|transparent|verification|verified|audit|inspection)\b/.test(normText)
      && /\b(?:cross border|international|us and china|u s and china|bilateral|agreement|deal)\b/.test(normText);
  }
  if (/\bphysical production energy and robotics not ideas become the main bottlenecks to ai driven growth\b/.test(normTitle)) {
    return /\b(?:manufacturing|physical production|factory|factories|robot|robots|robotics|energy|electricity|grid|materials|supply chain)\b/.test(normText)
      && /\b(?:bottleneck|bottlenecks|constraint|constraints|shortage|shortages|scarce|scarcities|binding|limits? growth|holds? back)\b/.test(normText);
  }
  if (/\bon the unpaused branch fully automated ai r d delivers roughly a 10x research speedup\b/.test(normTitle)) {
    return /\b(?:ai r d|ai research|research automation|automated research|ai scientist|ai scientists|autonomous research)\b/.test(normText)
      && /\b(?:10x|tenfold|research speedup|accelerat\w* research|faster research|months of research in|years of research in)\b/.test(normText);
  }
  if (/\bthe first drugs substantially designed by ai gain major regulator approval\b/.test(normTitle)) {
    return laborClauses(normText).some(clause =>
      /\b(?:drug|drugs|medicine|medicines|therapeutic|therapeutics|molecule|molecules|compound|compounds)\b/.test(clause)
      && (/\b(?:ai|artificial intelligence|machine learning)\b.{0,60}\b(?:design(?:ed|s)?|discover(?:ed|s)?|generat(?:ed|es)?|develop(?:ed|s)?)\b/.test(clause)
        || /\b(?:design(?:ed)?|discover(?:ed)?|generat(?:ed)?|develop(?:ed)?)\b.{0,60}\b(?:by|with|using)\s+(?:ai|artificial intelligence|machine learning)\b/.test(clause))
      && (/\b(?:fda|ema|mhra|tga|major regulator|regulatory authority)\b.{0,60}\b(?:approved|authorized|authorised|licensed)\b/.test(clause)
        || /\b(?:received|gained|won|secured|obtained)\b.{0,30}\b(?:fda|ema|mhra|tga|major regulator|regulatory)\b.{0,20}\b(?:approval|authorization|authorisation)\b/.test(clause)
        || /\b(?:received|gained|won|secured|obtained)\b.{0,30}\b(?:approval|authorization|authorisation)\b.{0,30}\b(?:from|by)\b.{0,12}\b(?:fda|ema|mhra|tga|major regulator|regulatory authority)\b/.test(clause)));
  }
  if (/\bai accelerates scientific progress by 10x to 1000x depending on the field\b/.test(normTitle)) {
    return laborClauses(normText).some(clause =>
      /\b(?:ai|artificial intelligence|machine learning|model|models|agent|agents)\b/.test(clause)
      && /\b(?:science|scientific|research|discovery|discoveries|experiment|experiments)\b/.test(clause)
      && /\b(?:accelerat\w*|speedup|faster|compress\w*)\b/.test(clause)
      && /\b(?:10x|100x|1000x|tenfold|hundredfold|thousandfold|orders? of magnitude|10 to 1000 times|between 10 and 1000 times)\b/.test(clause));
  }
  if (/\bcapital floods into mines motors actuators fabs and factories\b/.test(normTitle)) {
    return /\b(?:mine|mines|mining|motor|motors|actuator|actuators|fab|fabs|foundry|foundries|factory|factories|robotics)\b/.test(normText)
      && /\b(?:capital|investment|investments|investing|capex|financing|funding|funded|spending|dollars|billion|trillion)\b/.test(normText);
  }
  if (/\bai and robot labor contributes at least half of economic output in a leading economy\b/.test(normTitle)) {
    const hasBothActors = /\bai\b.{0,50}\brobots?\b|\brobots?\b.{0,50}\bai\b/.test(normText);
    const percent = hasBoundLaborPercent(normText, 50, /\b(?:economic output|gdp|gross domestic product)\b/);
    const half = laborClauses(normText).some(clause => {
      const share = clause.match(/\b(?:at least )?(?:half|a majority|the majority) of (?:economic output|gdp|gross domestic product)\b/);
      return !!share && positiveActorActionBefore(clause.slice(0, share.index));
    });
    return hasBothActors && (percent || half);
  }
  if (/\bai automates a majority of cognitive work in semiconductor r d and production engineering\b/.test(normTitle)) {
    return /\b(?:semiconductor|chip|chips|foundry|fab|fabs)\b/.test(normText)
      && /\b(?:ai|agent|agents|artificial intelligence|model|models)\b/.test(normText)
      && /\b(?:r d|research|design|engineering|verification|eda|process development|production engineering)\b/.test(normText)
      && /\b(?:automates?|automated|automation|majority|most of|ai designed|designed by ai|without human engineers?)\b/.test(normText);
  }
  if (/\bai welfare compensation and legal status enter mainstream law and corporate governance\b/.test(normTitle)) {
    return /\b(?:ai|model|models|digital minds?|artificial intelligence)\b/.test(normText)
      && /\b(?:rights|legal right|welfare|compensation|legal status|moral agents?|consciousness|self awareness|sentien\w*)\b/.test(normText)
      && /\b(?:law|legal|governance|policy|regulation|regulator|compensation|corporate)\b/.test(normText);
  }
  if (/\beducation and social institutions recenter on meaning community relationships and stewardship rather than employability\b/.test(normTitle)) {
    return /\b(?:education|school|schools|university|universities|social institutions?)\b/.test(normText)
      && /\b(?:meaning|community|relationships?|stewardship|post work|life after work|rather than employability|beyond employability)\b/.test(normText);
  }
  if (/\bai advisors become load bearing across business politics courts and parts of the military\b/.test(normTitle)) {
    return /\b(?:assistant|assistants|advisor|advisors|copilot|copilots|personal ai)\b/.test(normText)
      && /\b(?:load bearing|critical decisions?|decision authority|final authority|delegat\w*|relied on|institutional dependence|core operations?)\b/.test(normText)
      && /\b(?:politics|government|court|courts|legal system|military|defense|defence)\b/.test(normText);
  }
  if (/\bai driven research delivers major disease cures and abundant low cost clean energy\b/.test(normTitle)) {
    return /\b(?:ai|artificial intelligence|ai research|ai driven research)\b/.test(normText)
      && /\b(?:cure|cures|cured|eradicated|approved treatment|clinical breakthrough)\b/.test(normText)
      && /\b(?:low cost clean energy|cheap clean energy|abundant clean energy|commercial fusion|fusion power|energy cost fell|energy costs fell)\b/.test(normText);
  }
  if (/\bgenuinely non invasive neural interfaces could become a separate\b/.test(normTitle)) {
    if (/\b(?:wrist|forearm|peripheral).{0,36}\b(?:semg|emg|muscle|motor nerve)\b|\b(?:semg|emg).{0,36}\b(?:wrist|forearm|peripheral|muscle)\b/.test(normText)) return false;
    if (/\b(?:endovascular|stentrode|intravascular|inside a blood vessel)\b/.test(normText)
        && !/\b(?:scalp eeg|eeg|meg|fnirs|transcranial ultrasound|optical brain|external brain)\b/.test(normText)) return false;
  }
  if (/\bwhole brain emulation could enable digital minds\b/.test(normTitle)
      && /\b(?:chatbot|griefbot|deadbot|digital replica|avatar)\b/.test(normText)
      && !/\b(?:whole brain emulation|mind upload|connectome|brain preservation|functional emulation)\b/.test(normText)) return false;
  if (/\borbital compute remains demonstrator scale through 2026\b/.test(normTitle)
      && /\b(?:proposal|proposed|filing|filed|plans?|roadmap|target|announc\w*)\b/.test(normText)
      && !/\b(?:launched|in orbit|on orbit|operating in orbit|ran|running|trained|queried)\b/.test(normText)) return false;
  if (/\borbital compute platform sustains 1 mw\b/.test(normTitle)
      && !/\b(?:operating|operational|sustained|ran|running|continuous|continuously|for 90 days|for ninety days)\b/.test(normText)) return false;
  if (/\borbital data centres could expand into self growing solar powered compute networks\b/.test(normTitle)
      && /\b(?:storage|backup|edge inference)\b/.test(normText)
      && !/\b(?:gpu|compute workload|ai workload|solar power|space solar|mining|manufactur\w*)\b/.test(normText)) return false;
  if (/\borbital data centres could expand into self growing solar powered compute networks\b/.test(normTitle)
      && /\b(?:solar satellite|solar power satellite|solar constellation)\b/.test(normText)
      && !/\b(?:dyson|self grow\w*|self expand\w*|mining|manufactur\w*|orbital compute|space data cent(?:er|re))\b/.test(normText)) return false;
  if (/\bcivilizational energy use could climb by measurable orders of magnitude toward kardashev\b/.test(normTitle)
      && !/\b(?:orders of magnitude|increas\w*|grow\w*|rising|rose|capture\w*|consume\w*|use[sd]? \d|\d+(?:\.\d+)?\s*(?:terawatts?|petawatts?|exawatts?|watts?))\b/.test(normText)) return false;
  if (/\bruliad research could become forecast relevant\b/.test(normTitle)
      && /\b(?:enter the ruliad|travel to the ruliad|ruliad is a destination|ruliad is a simulation|proven asi roadmap)\b/.test(normText)
      && !/\b(?:not|isn t|is not|no evidence)\b/.test(normText)) return false;
  if (SIMULATED_SCALE_CONTEXT.test(normText)
      && /\b(?:factory lines|paid digital labor|global ai compute|economically valuable physical tasks|cognitive labor|economically valuable labor|cognitive and physical tasks|employment falls|global economy runs|virtual workforce)\b/.test(normTitle)) return false;
  if (/\bhumanoid robots move onto live factory lines in the thousands\b/.test(normTitle)) {
    return laborClauses(normText).some(clause => !SIMULATED_SCALE_CONTEXT.test(clause)
      && /\b(?:humanoid|robot|robots|robotic|robotics|optimus)\b/.test(clause)
      && /\b(?:factory|factories|production line|assembly line|deployment|deployments|deployed)\b/.test(clause)
      && (/\bmass deployment|deployments? in the thousands\b/.test(clause)
        || hasBoundQuantity(clause, '(?:humanoid )?(?:robots|optimus units)', 1000)));
  }
  if (/\bmillions of ai agent copies work continuously generating at least 10b per month in paid digital labor\b/.test(normTitle)) {
    if (disattributesAgentRevenue(normText)) return false;
    for (const clause of laborClauses(normText)) {
      if (SIMULATED_SCALE_CONTEXT.test(clause)) continue;
      const agentScale = hasBoundQuantity(clause, '(?:ai agents|agent copies|copies of ai agents|virtual workers)', 1e6, true);
      const paid = clause.match(/\b(?:(usd)\s+)?(\d+(?:\.\d+)?)(b| billion)(?:\s+(usd|dollars?))?\s+(?:per month|monthly)\b/);
      if (!agentScale || !paid || Number(paid[2]) < 10 || (!paid[1] && !paid[4])) continue;
      const beforePaid = clause.slice(0, paid.index);
      const afterPaid = clause.slice(paid.index + paid[0].length);
      if (NON_USD_CURRENCY.test(clause)) continue;
      if (isUpperBoundBefore(beforePaid) || isAmbiguousAtThreshold(beforePaid)
          || isUpperBoundAfter(afterPaid)
          || /\b(?:not|never|does not|do not|cannot|at most|less than|under|below)\b/.test(beforePaid.slice(-60))) continue;
      if (/\b(?:work continuously|continuous work|running continuously|virtual workforce)\b/.test(clause)
          && /\b(?:revenue|paid|income|digital labor|digital labour|generat\w*|earn\w*)\b/.test(clause)
          && hasAgentRevenueAttribution(clause, paid.index)) return true;
    }
    return false;
  }
  if (/\babsent a sustained slowdown ai fully automates frontier ai r d by 2030\b/.test(normTitle)) {
    return laborClauses(normText).some(clause =>
      /\b(?:ai|artificial intelligence|model|models|agent|agents)\b/.test(clause)
      && /\b(?:ai r d|ai research|model research|machine learning research|frontier research|successor models?|building smarter ai)\b/.test(clause)
      && /\b(?:fully automat\w*|full automation|automat\w* end to end|end to end automation|without human(?: researchers?| input| review)?|replace(?:s|d|ment)? (?:ai )?researchers?|recursive self improvement)\b/.test(clause));
  }
  if (/\bglobal ai compute reaches multi terawatt scale and billions of h100 equivalents\b/.test(normTitle)) {
    return hasBoundComputeScale(normText);
  }
  if (/\badvanced robots can perform roughly one third of economically valuable physical tasks\b/.test(normTitle)) {
    return !hasExplicitPhysicalLimitation(normText)
      && /\b(?:robot|robots|robotic|robotics|humanoid)\b/.test(normText)
      && /\b(?:one third|third of (?:economically valuable )?(?:physical )?(?:tasks|work)|3[0-9] percent of (?:economically valuable )?(?:physical )?(?:tasks|work)|roughly 3[0-9] percent of (?:economically valuable )?(?:physical )?(?:tasks|work))\b/.test(normText);
  }
  if (/\btax systems begin shifting materially from human income toward compute robot and automated capital rents\b/.test(normTitle)) {
    return laborClauses(normText).some(clause =>
      /\b(?:ai|artificial intelligence|compute|gpu|gpus|robot|robots|robotic|robotics|automation|automated capital)\b/.test(clause)
      && /\b(?:tax|taxes|taxation|levy|levies|rent|rents|dividend|dividends|income|revenue|fiscal|payroll)\b/.test(clause)
      && /\b(?:human income|labor tax|labour tax|payroll tax|wage tax|tax base|compute (?:tax|levy|rent)|gpu (?:tax|levy|rent)|robot (?:tax|levy|rent)|automation (?:tax|levy|rent)|automated capital|ai (?:tax|levy|rent|dividend)|shift|replace|instead|toward)\b/.test(clause));
  }
  if (/\berosion of labor tax revenue makes ai dividends sovereign ai stakes and compute rents mainstream policy\b/.test(normTitle)) {
    return /\b(?:dividend|ubi|uhi|universal basic income|universal high income|sovereign ai stake|public ai fund|compute rent|robot rent|automated capital rent)\b/.test(normText)
      && /\b(?:policy|government|law|legislation|tax|taxation|levy|proposal|debate|parliament|congress|senate|sovereign fund|public fund)\b/.test(normText);
  }
  if (/\ba recurring citizen s dividend funded by ai compute or robot rents launches\b/.test(normTitle)) {
    return /\b(?:dividend|ubi|uhi|universal basic income|universal high income|sovereign ai stake|public ai fund|compute rent|robot rent|automated capital rent)\b/.test(normText)
      && /\b(?:launch|launched|enact|enacted|implemented|began paying|begins paying|rolled out|signed into law|first payments?)\b/.test(normText);
  }
  if (/\buniversal high income or an ai dividend becomes a permanent institution in multiple major economies\b/.test(normTitle)) {
    return /\b(?:dividend|ubi|uhi|universal basic income|universal high income)\b/.test(normText)
      && /\b(?:permanent|permanently|entrenched|statutory|institution|institutionalized|institutionalised|guaranteed by law)\b/.test(normText)
      && /\b(?:multiple economies|multiple countries|several countries|major economies|g7|g20|international)\b/.test(normText);
  }
  if (/\bone quarter of cognitive labor\b/.test(normTitle)
      && !/\b(?:one quarter|quarter|25 percent|twenty five percent|at least 20 percent|at least 25 percent)\b/.test(normText)) return false;
  if (/\bone third of cognitive labor\b/.test(normTitle)) {
    if (!/\b(?:one third|third|33 percent|half|50 percent|majority|most)\b/.test(normText)
        || !/\b(?:cognitive|white collar|knowledge work|office work|remote labor|remote work|jobs|workforce)\b/.test(normText)
        || !/\b(?:robot|robots|robotic|physical labor|physical work|physical tasks)\b/.test(normText)) return false;
  }
  if (/\bmore cognitive labor than humans\b/.test(normTitle) && !hasCognitiveLaborMajority(normText)) return false;
  if (/\b85 percent or more\b/.test(normTitle)
      && !hasBoundLaborPercent(normText, 85, /\b(?:economically valuable )?(?:labor|labour|work|tasks|jobs)\b/)
      && !(/\b(?:robot|robots|robotic|robotics|physical labor|physical work|physical tasks)\b/.test(normText)
        && hasNearTotalEconomicLabor(normText))) return false;
  if (/\b95 percent of cognitive and physical tasks\b/.test(normTitle)) {
    const hasThreshold = hasBoundLaborPercent(normText, 95, /\b(?:cognitive|physical|labor|labour|work|tasks)\b/)
      || hasNearTotalCognitivePhysicalTasks(normText);
    return hasThreshold && /\b(?:robot|robots|robotic|physical)\b/.test(normText);
  }
  if (/\bemployment falls below half\b/.test(normTitle)
      && !/\b(?:working age|adults employed|employed adults|employment rate|labor force participation|labour force participation|below half employed|less than half employed|50 percent unemployment|majority unemployed)\b/.test(normText)) return false;
  if (/\b200 million frontier ai workers and 2 billion advanced robots\b/.test(normTitle)) {
    const operational = /\b(?:global economy|economy|economic|work|works|working|workforce|run|runs|running|deploy(?:s|ed|ment|ments)?|operat(?:e|es|ed|ing|ional)|active|in service|production|factory|factories|businesses?|households?|real world)\b/;
    const clauses = laborClauses(normText).filter(clause => operational.test(clause) && !SIMULATED_SCALE_CONTEXT.test(clause));
    const aiScale = clauses.some(clause => hasBoundQuantity(clause, '(?:ai workforce|(?:frontier )?ai workers?|ai agents?|agent copies|copies of ai agents?|virtual workforce|virtual workers?)', 2e8, true));
    const robotScale = clauses.some(clause => hasBoundQuantity(clause, '(?:advanced )?(?:robots|humanoids)', 2e9, true));
    return aiScale || robotScale;
  }
  if (/\bcontinuously running ai agents form a virtual workforce of at least 100 million copies\b/.test(normTitle)) {
    return laborClauses(normText).some(clause => !SIMULATED_SCALE_CONTEXT.test(clause)
      && /\b(?:work|works|working|workforce|run|runs|running|scale|scales|scaling|active|deployed|copies)\b/.test(clause)
      && hasBoundQuantity(clause, '(?:ai workforce|(?:frontier )?ai workers?|ai agents?|agent copies|copies of ai agents?|virtual workforce|virtual workers?)', 1e8, true));
  }
  if (/\b(?:space|off world|orbital|lunar|moon|mars)\b/.test(normTitle)
      && /\b(?:latent|embedding|activation|coordinate|j|rulial) space\b/.test(normText)
      && !/\b(?:outer space|space power|space solar|spacex|starlink|orbital|orbit|moon|lunar|mars|off world)\b/.test(normText)) {
    return false;
  }
  return FACET_GUARDS.every(g => {
    if ((g.domains && !g.domains.has(p.domain)) || !g.title.test(normTitle)) return true;
    return g.all ? g.all.every(rx => rx.test(normText)) : g.text.test(normText);
  });
}
function qualifyPost(text, p, ageDays = 0){
  const scored = scorePost(text, p);
  const lexicalValid = scored.score >= MIN_SCORE && scored.solid >= 1;
  const semanticValid = scored.semanticValid && (lexicalValid || ageDays <= SEMANTIC_MAX_AGE_DAYS);
  if (!lexicalValid && !semanticValid) return { ok: false, reason: 'relevance', scored, lexicalValid, semanticValid };
  const matchMethod = lexicalValid && semanticValid ? 'hybrid' : lexicalValid ? 'lexical' : 'semantic';
  if (!passesFacetGuards(text, p)) return { ok: false, reason: 'facet', scored, lexicalValid, semanticValid, matchMethod };
  return { ok: true, scored, lexicalValid, semanticValid, matchMethod };
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

async function main(){
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8').replace(/^\uFEFF/, '')); } catch(e){}
  const prevEmbeds = (prev && prev.embeds) || {};

  // Load the live (daily-revised) prediction set, expanded to ONE matcher per event.
  const PREDICTIONS = buildPredictions();
  const datedPredictionCount = PREDICTIONS.filter(p => p.scope !== 'horizon').length;
  const horizonPredictionCount = PREDICTIONS.length - datedPredictionCount;
  const predYears = new Set(PREDICTIONS.filter(p => p.scope !== 'horizon').map(p => p.year)).size;
  console.error(`[refresh] Matching against ${datedPredictionCount} dated predictions across ${predYears} years plus ${horizonPredictionCount} horizon items.`);

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

  // ---- 3. Guarded lexical + semantic scoring -> maximum-coverage assignment ------------------------
  // Literal hits and the controlled concept ontology both remain subordinate to claim-specific facet
  // guards. Semantic-only matches are limited to recent activity so broad historical backfilling cannot
  // inflate coverage. Allocation maximizes unique relevant posts first, then bounded reuse.
  const candidateLists = {};
  const guardRejections = {};
  for (const p of PREDICTIONS) {
    const cands = [];
    for (const t of eligible) {
      const ageDays = (now - t.created.getTime()) / 864e5;
      const qualified = qualifyPost(t.text, p, ageDays);
      const { scored, lexicalValid, semanticValid, matchMethod } = qualified;
      if (!qualified.ok && qualified.reason === 'relevance') continue;
      if (!qualified.ok) {
        if (!guardRejections[p.id]) guardRejections[p.id] = { count: 0, samples: [] };
        guardRejections[p.id].count++;
        if (guardRejections[p.id].samples.length < 10) {
          guardRejections[p.id].samples.push({
            id: t.id,
            author: t.author,
            date: fmtDate(t.created),
            method: matchMethod,
            concepts: scored.conceptHits,
            text: cleanText(t.text).slice(0, 160),
          });
        }
        continue;
      }
      const tier = ageDays <= PAST_WEEK_DAYS ? 'week' : 'recent';
      cands.push({
        id: p.id,
        year: p.year,
        p,
        t,
        score: scored.score,
        coverage: scored.coverage,
        conceptScore: scored.conceptScore,
        conceptHits: scored.conceptHits,
        recencyRank: recencyRank(t.created, now),
        tier,
        hit: scored.hit,
        matchMethod,
        created: t.created,
      });
    }
    cands.sort((a, b) =>
      b.recencyRank - a.recencyRank
      || b.created - a.created
      || b.conceptScore - a.conceptScore
      || b.score - a.score
      || b.coverage - a.coverage);
    candidateLists[p.id] = cands;
  }
  const candidateAudit = {};
  for (const p of PREDICTIONS) {
    candidateAudit[p.id] = candidateLists[p.id].slice(0, 3).map(c => ({
      id: c.t.id,
      author: c.t.author,
      date: fmtDate(c.t.created),
      tier: c.tier,
      method: c.matchMethod,
      score: c.score,
      conceptScore: c.conceptScore,
      concepts: c.conceptHits,
      text: cleanText(c.t.text).slice(0, 160),
    }));
  }

  // Phase 1: maximum-cardinality one-to-one matching. Augmenting paths prevent broad predictions from
  // consuming a post that is the only valid option for a more constrained prediction.
  const picks = {};
  const postOwner = new Map();
  const allocationOrder = PREDICTIONS.slice().sort((a, b) => {
    const ac = candidateLists[a.id][0] || {};
    const bc = candidateLists[b.id][0] || {};
    return candidateLists[a.id].length - candidateLists[b.id].length
      || (bc.coverage || 0) - (ac.coverage || 0)
      || (bc.conceptScore || 0) - (ac.conceptScore || 0)
      || (bc.score || 0) - (ac.score || 0)
      || a.year - b.year
      || a.evIndex - b.evIndex;
  });
  function assignUnique(predId, seenPosts, seenPreds){
    if (seenPreds.has(predId)) return false;
    seenPreds.add(predId);
    for (const cand of candidateLists[predId]) {
      if (seenPosts.has(cand.t.id)) continue;
      seenPosts.add(cand.t.id);
      const owner = postOwner.get(cand.t.id);
      if (!owner || assignUnique(owner, seenPosts, seenPreds)) {
        postOwner.set(cand.t.id, predId);
        picks[predId] = cand;
        return true;
      }
    }
    return false;
  }
  for (const p of allocationOrder) {
    assignUnique(p.id, new Set(), new Set());
  }
  const maximumUniqueMatches = Object.keys(picks).length;

  // Phase 2: augment the same graph with up to MAX_POST_REUSE slots per post. This preserves the
  // maximum unique-post coverage while filling every additional defensible prediction it can.
  const postOwners = new Map();
  for (const [predId, cand] of Object.entries(picks)) {
    if (!postOwners.has(cand.t.id)) postOwners.set(cand.t.id, new Set());
    postOwners.get(cand.t.id).add(predId);
  }
  function setAssignment(predId, cand){
    const old = picks[predId];
    if (old) postOwners.get(old.t.id)?.delete(predId);
    picks[predId] = cand;
    if (!postOwners.has(cand.t.id)) postOwners.set(cand.t.id, new Set());
    postOwners.get(cand.t.id).add(predId);
  }
  function assignWithCapacity(predId, seenPosts, seenPreds){
    if (seenPreds.has(predId)) return false;
    seenPreds.add(predId);
    for (const cand of candidateLists[predId]) {
      if (seenPosts.has(cand.t.id)) continue;
      seenPosts.add(cand.t.id);
      const owners = postOwners.get(cand.t.id) || new Set();
      if (owners.size < MAX_POST_REUSE) {
        setAssignment(predId, cand);
        return true;
      }
      for (const owner of [...owners]) {
        if (assignWithCapacity(owner, seenPosts, seenPreds)) {
          setAssignment(predId, cand);
          return true;
        }
      }
    }
    return false;
  }
  for (const p of allocationOrder) {
    if (!picks[p.id]) assignWithCapacity(p.id, new Set(), new Set());
  }
  const postUses = new Map([...postOwners.entries()].filter(([, owners]) => owners.size).map(([id, owners]) => [id, owners.size]));
  const usedPosts = new Set(postUses.keys());

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
    embeds[p.id] = {
      id: pick.id,
      kind: pick.kind,
      author: author || 'peterxing',
      recency: c.tier,
      matchMethod: c.matchMethod,
      date: fmtDate(created),
      maps: p.maps,
      text,
      likes: lk,
      rts: rts || 0,
    };
    chosen[p.id] = `${pick.kind}:@${author} [${c.tier} ${c.matchMethod} r${c.recencyRank} s${c.score} cs${c.conceptScore} c${c.coverage}] ${(c.conceptHits.length ? c.conceptHits : c.hit).slice(0, 4).join('/')}`;
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
  const candidatePosts = new Set();
  const pastWeekCandidatePosts = new Set();
  for (const cands of Object.values(candidateLists)) for (const c of cands) {
    candidatePosts.add(c.t.id);
    if (c.tier === 'week') pastWeekCandidatePosts.add(c.t.id);
  }
  const usedPastWeekPosts = new Set(Object.values(picks).filter(c => c.tier === 'week').map(c => c.t.id));
  const matchMethodTally = { lexical: 0, semantic: 0, hybrid: 0 };
  for (const c of Object.values(picks)) matchMethodTally[c.matchMethod]++;
  const matchablePredictions = PREDICTIONS.filter(p => candidateLists[p.id].length).length;
  const unmatchedWithCandidates = PREDICTIONS.filter(p => candidateLists[p.id].length && !picks[p.id]).map(p => p.id);
  const unusedRelevantPosts = [...candidatePosts].filter(id => !usedPosts.has(id));
  const previousMatchedIds = new Set(Object.keys(prevEmbeds));
  const currentMatchedIds = new Set(Object.keys(embeds));
  const coverageChange = {
    previousMatched: previousMatchedIds.size,
    currentMatched: currentMatchedIds.size,
    gained: [...currentMatchedIds].filter(id => !previousMatchedIds.has(id)),
    lost: [...previousMatchedIds].filter(id => !currentMatchedIds.has(id)),
  };
  const eligibleById = new Map(eligible.map(t => [t.id, t]));
  const unusedRelevantPostSamples = unusedRelevantPosts.slice(0, 20).map(id => {
    const t = eligibleById.get(id);
    return t ? { id, author: t.author, date: fmtDate(t.created), text: cleanText(t.text).slice(0, 160) } : { id };
  });
  const out = {
    updated: new Date().toISOString(),
    note: `Per-prediction @peterxing signals are refreshed hourly from the authenticated X API first, then a live read-only public RSS profile. Caches older than ${SOURCE_CACHE_MAX_HOURS} hours and stale legacy syndication snapshots are rejected rather than labeled current. Controlled semantic concepts supplement literal matching, but claim-specific facet guards remain mandatory and semantic-only matches are limited to ${SEMANTIC_MAX_AGE_DAYS} days. Assignment maximizes unique relevant posts before bounded reuse of at most ${MAX_POST_REUSE}; unsupported predictions receive an honest live from:peterxing search. The Reality Signals grid follows the same fresh source.`,
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
    datedPredictions: datedPredictionCount,
    horizonItems: horizonPredictionCount,
    matched: Object.keys(embeds).length,
    freshMatches: sourceFresh ? Object.keys(embeds).length : 0,
    searches: Object.keys(search).length,
    maxPostReuse: MAX_POST_REUSE,
    semanticMaxAgeDays: SEMANTIC_MAX_AGE_DAYS,
    matchablePredictions,
    unmatchedWithCandidates,
    maximumUniqueMatches,
    uniqueMatchedPosts: usedPosts.size,
    candidateRelevantPosts: candidatePosts.size,
    unusedRelevantPosts: unusedRelevantPosts.length,
    unusedRelevantPostSamples,
    pastWeekRelevantPosts: pastWeekCandidatePosts.size,
    uniquePastWeekPostsUsed: usedPastWeekPosts.size,
    reusedPosts,
    matchMethods: matchMethodTally,
    coverageChange,
    guardRejections,
    candidateAudit,
    embedKinds: kindTally,
    embedTiers: tierTally,
    reality: reality.map(r => r.kind === 'search' ? `${r.tag}: live search` : `${r.tag}: ${r.kind}:@${r.author} [${r.recency}] ${r.date}`),
    chosen,
    sampleReposts: sampleBy('repost'),
    sampleLikes: sampleBy('like'),
    sampleBookmarks: sampleBy('bookmark'),
  }, null, 2) + '\n');

  console.error(`[refresh] Wrote signals.json from ${source}: ${Object.keys(embeds).length}/${PREDICTIONS.length} predictions embedded using ${usedPosts.size} unique posts (maximum unique ${maximumUniqueMatches}, reuse cap ${MAX_POST_REUSE}) [${Object.entries(matchMethodTally).map(([k, v]) => v + ' ' + k).join(', ')}] [${Object.entries(kindTally).map(([k, v]) => v + ' ' + k).join(', ')}] {${Object.entries(tierTally).map(([k, v]) => v + ' ' + k).join(', ')}}, ${Object.keys(search).length} searches, ${reality.length} reality cards.`);
  console.log(JSON.stringify({ embeds: chosen, search: Object.keys(search), reality: reality.map(r => r.tag) }));
}
if (require.main === module) {
  main().catch(err => {
    console.error('[refresh] Fatal:', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  });
}
module.exports = { detectConcepts, deriveEventTerms, hasBoundQuantity, normalizeGuardText, passesFacetGuards, qualifyPost, scorePost };
