// refresh-signals.js — match every REHOBOAM prediction to a live-verified news article, and write
// signals.json (loaded by index.html at runtime).
//
// X RETIREMENT 2026-08-13 — this header described a retrieval pipeline this file NO LONGER HAS:
// Wayback CDX discovery, X first-party tweet-result hydration at >=600 ms, X oEmbed cross-checks, an
// authored/quote/reply/repost corpus, and a Peter-first evidence priority. Every one of those clauses
// is refuted by the file itself (zero CDX and zero X API call sites remain) and by what it publishes
// (byPeterAuthorship {authored:0, reposted:0}; byEvidenceMedium {x:0, news:7}). It survived the
// migration because ONE honest sentence in the block — the corpus-of-record is "never served" —
// carried four false ones past a marker-scoped sweep. A retirement marker exempts a block; it does
// not make the block true.
//
// RETRIEVAL (single tier)
//   DISCOVERY: authoritative news publishers only. No profile feed, no archive, no X API.
//   VERIFICATION: every candidate article is fetched live at review AND at publish time; headline,
//   publisher, byline and date are extracted from the fetched page, an exact verbatim supporting quote
//   must still be present, and a SHA-256 of the extracted main text is re-checked at publish.
//   Aggregators, shorteners, press-release mills and content farms are rejected.
//   NOTHING IS SUBSTITUTED: a prediction with no qualifying source inside the window is recorded in
//   the uncited channel, by id, with the window that was searched — never given a weaker citation.
//   Automatic candidates never self-approve; prediction/article pairs remain explicit and reviewed.
//
// MATCHING (newest valid signal first)
//   The prediction set is loaded from predictions.json (revised DAILY from the latest news + his posts —
//   predictions are added / updated / removed there, not here). Every post is scored against every
//   prediction: phrase(3) + strong-word(2) + weak-word(1). After relevance, solidity, and facet guards,
//   candidates rank by specificity before recency. A signal can support multiple predictions only when
//   every reuse belongs to the same explicitly declared compatible evidence family.
//   Predictions with no reviewed direct mapping fail publication; search fallbacks are never emitted.
//
//   node refresh-signals.js                 # harvest + match + write signals.json
//   X_ARCHIVE_BACKFILL=1 X_ARCHIVE_HYDRATE_LIMIT=400 node refresh-signals.js
// Concurrency interlock: claim the tree before reading predictions/signals/approvals/floors.
if (require.main === module) require('./pipeline-lock').guard('refresh-signals');

const fs = require('fs');
const path = require('path');
const { CURRENCY_SOURCES, CURRENCY_MAPPINGS } = require('./currency-evidence');
const {
  FAMILY_DEFINITIONS,
  familyForPrediction,
  validateFamilyCoverage,
} = require('./evidence-families');
const {
  EXTERNAL_MAPPINGS,
  EXTERNAL_SOURCES,
} = require('./external-evidence');
// X RETIREMENT 2026-08-13 - live-verified news is the ONLY evidence medium. It is no longer a tier
// beneath an archive corpus, because there is no archive corpus: the archive path, the X API and the
// Peter floors were REMOVED, not zeroed. There is no floor for news to bypass and no external call
// in the retrieval chain but the article fetch itself. Eligibility is per prediction: a prediction is
// evidenced when a live-verified article inside the currency window supports it, and is recorded as
// an explicit uncited absence when none does.
const {
  NEWS_MAPPINGS,
  NEWS_SOURCES,
  normalizeUrl,
  verifyNewsSource,
} = require('./news-evidence');
// X RETIREMENT 2026-08-13 — the @peterxing archive corpus, its hydration chain and the X API were
// retired on the site owner's instruction ("remove all references to x posts and stop using the x
// api"). No X module is imported, required or called from this build any more. Verified news is now
// the ONLY evidence tier; a prediction with no qualifying in-window source renders UNCITED.

const DIR = __dirname;
const OUT = path.join(DIR, 'signals.json');
const DBG = path.join(DIR, 'signals-debug.json');
const PRED = path.join(DIR, 'predictions.json'); // daily-revised prediction set (source of truth)
const APPROVALS = path.join(DIR, 'evidence-approvals.json'); // reviewed prediction/post pairs
const FLOORS = path.join(DIR, 'evidence-floors.json'); // monotonic evidence-quality ratchet
// MIN_SCORE and the facet guards gate weak/spurious matches before recency is considered.
const PAST_WEEK_DAYS = Number(process.env.PAST_WEEK_DAYS || 7);
const MAX_AGE_DAYS   = Number(process.env.MAX_AGE_DAYS || 5000);
const SEMANTIC_MAX_AGE_DAYS = Number(process.env.SEMANTIC_MAX_AGE_DAYS) || 30;
const MIN_SCORE      = 2;
const SOURCE_CACHE_MAX_HOURS = Number(process.env.SOURCE_CACHE_MAX_HOURS) || 36;
// Evidence quality only ever ratchets in the safe direction. The baselines below are absolute
// minimums; evidence-floors.json records the best result any published run has actually achieved and
// raises the effective gate to that level, so a later regression fails closed instead of silently
// re-publishing weaker evidence. Environment overrides may tighten a gate but can never loosen one.
/* X RETIREMENT 2026-08-13 — BASE_MIN_STICKY_PETER_MAPPINGS (24), BASE_MIN_AUTHORED_PETER_MAPPINGS
   (10) and BASE_MAX_REVIEWED_REUSE (10) were the baseline @peterxing floors this ratchet raised.
   Nothing has referenced them since those floors left evidence-floors.json. Deleted rather than
   zeroed: a floor of 0 reads as a satisfied gate. */
function readEvidenceFloors() {
  /* FAILS CLOSED, and it did not used to. This returned {peterTotal:0, peterAuthored:0,
     maxReuse:Infinity} on any read error, which is not a neutral default: Math.max/Math.min then
     resolve every gate to the BASE_* baseline the ratchet exists to raise, silently, mid-build,
     while the run continues and publishes. Three bytes of UTF-8 BOM — the default of the "reviewed,
     explained manual edit" this file's own note asks for, on Windows — were enough. A registration
     is only load-bearing in the readers that FAIL when it is absent, and that is a property of each
     READ-SITE, not of the file: the sibling read at the ratchet writer never had a fallback, so the
     same corrupt file weakened this one and threw in that one. */
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(FLOORS, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`evidence-floors.json could not be read as JSON (${error.message}). This runs at MODULE `
      + 'SCOPE, so it is the first reader in any process that imports this file, and a bare SyntaxError here '
      + 'is reported as an instrument fault against whichever program did the importing.');
  }
  /* THE READ-SITE IS RETIRED THE SAME WAY THE KEYS WERE, AND IT STILL FAILS CLOSED.
     This used to demand peterTotal/peterAuthored/maxReuse and throw when they were not integers.
     Number.isInteger(undefined) is false, so ABSENCE took the same branch as CORRUPTION: after those
     keys were retired by reviewed manual edit, this threw at MODULE SCOPE with "must be an integer,
     found undefined" — pointing an operator at a corrupt file that was in fact exactly as intended.
     A registration is only load-bearing in the readers that FAIL when it is absent, and that is a
     property of each READ-SITE, not of the file; retiring the keys and the writer did not retire this.
     The check is INVERTED rather than deleted: reinstating an X floor is now the thing that throws,
     because that would put a gate back on evidence this site no longer has. */
  const reinstated = ['peterTotal', 'peterAuthored', 'maxReuse'].filter(key => key in raw);
  if (reinstated.length) {
    throw new Error(`evidence-floors.json reinstates retired X floors (${reinstated.join(", ")}). These `
      + 'measured @peterxing X evidence, which was retired on 2026-08-13 at the site owner\'s instruction. '
      + 'Refusing: a floor over evidence that no longer exists can only fail closed forever or pass vacuously.');
  }
  return { retired: true };
}

/* HOISTED TO MODULE SCOPE 2026-08-13. The uncited channel names this window in the text it writes for
   every prediction it cannot cite, and that runs long before the currency block where this used to be
   declared — a temporal-dead-zone ReferenceError that only appeared once the channel existed.

   IT NO LONGER DEFAULTS TO A LITERAL. The default was 60, hardcoded here, while evidence-floors.json
   registers the ceiling that actually governed publication. Two homes for one number is how they drift,
   and the registration is the term the thing under test cannot rewrite, so the registration wins. The
   environment may only TIGHTEN the window, never widen it: the same asymmetry evidence-floors.json
   states for every other gate ("an environment variable may make each one SAFER but never weaker").

   ROUNDING, STATED EXPLICITLY BECAUSE IT IS OFF-BY-HALF-A-DAY: the demotion test below is
   Math.round(ageDays) > CURRENCY_MAX_AGE_DAYS, so a 14-day ceiling actually demotes at 14.5 days. That
   is the implemented rule, unchanged by this edit; it is registered as such rather than described as a
   clean 14-day cut it has never been. */
const CURRENCY_MAX_AGE_DAYS = (() => {
  const registered = Number(JSON.parse(fs.readFileSync(FLOORS, 'utf8').replace(/^\uFEFF/, '')).currencyMaxAgeDays);
  if (!Number.isInteger(registered) || registered <= 0) {
    throw new Error('evidence-floors.json: currencyMaxAgeDays must be a positive integer. It is the '
      + 'registration of the window that governs publication; refusing to substitute a default for it.');
  }
  const override = Number(process.env.CURRENCY_MAX_AGE_DAYS);
  return Number.isFinite(override) && override > 0 ? Math.min(registered, override) : registered;
})();
const EVIDENCE_RATCHET = readEvidenceFloors();
// X RETIREMENT 2026-08-13 — MIN_STICKY_PETER_MAPPINGS, MIN_AUTHORED_PETER_MAPPINGS and
// MAX_REVIEWED_REUSE were derived from the retired X floors. Nothing computes them now.
const MAX_REVIEWED_REUSE = Number(process.env.MAX_REVIEWED_REUSE) || Infinity;
const PETER_VERIFICATION_MAX_AGE_DAYS = Number(process.env.PETER_VERIFICATION_MAX_AGE_DAYS) || 30;
const SKIP_API = process.env.X_SKIP_API === '1';
const KIND_RANK = { post: 0, repost: 1, like: 2, bookmark: 3 }; // de-dup priority: keep the richest kind
/* X RETIREMENT 2026-08-13 - SECRET_DIR/ACT/HISTORY addressed the private @peterxing corpus. Their
   only readers were the three crashing functions removed above, so this build no longer names, opens
   or depends on the secrets directory at all. */
const API_RECENT_POSTS = Math.max(100, Number(process.env.X_RECENT_POSTS) || 300);
const ARCHIVE_BACKFILL = process.env.X_ARCHIVE_BACKFILL === '1';
const ARCHIVE_FORCE_DISCOVERY = process.env.X_ARCHIVE_DISCOVERY_FORCE === '1';
const ARCHIVE_HYDRATE_LIMIT = Math.max(
  Number(process.env.X_ARCHIVE_HYDRATE_LIMIT) || (ARCHIVE_BACKFILL ? 400 : 32)
);

// Prediction table fallback. The LIVE matching set is loaded from predictions.json (revised daily);
// this inline copy is only used if that sidecar is missing/unparsable. Each post is scored against
// every prediction by weighted term hits:
//   phrases (normalized, punctuation→space) = 3pts · strong words (prefix match) = 2pts · weak words = 1pt
// `search` remains diagnostic matcher metadata only; it is never emitted as public prediction evidence.
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
// EVENT (not per year), so every individual prediction can be matched to its own evidence source.
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
// bind a post to a prediction — the candidate is rejected.)
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
  { name: 'research', weight: 2, solo: true, rx: /\b(?:research|science|scientist|proof|theorem|conjecture|math|physics|discovery|r d|r amp d)\b/ },
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
  { name: 'orbitalcompute', weight: 2, solo: true, rx: /\b(?:orbital compute|orbital data cent(?:er|re)|space data cent(?:er|re)|data cent(?:er|re)s? in space|space based data cent(?:er|re)|ai sat(?:ellite)?|starcloud|project suncatcher)\b/ },
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

// X RETIREMENT 2026-08-13 - "Reality Signals" is a NEWS FIELD LOG, not a @peterxing feed. Each card
// on the site's Reality-Signals grid is filled from the articles live-verified during this run: the
// most notable observation on that theme inside the currency window, carrying its publisher, date and
// age (see the reality[] build at the observedArticles loop). A theme with no qualifying source in
// window renders as an explicit absence rather than a stale item.
// Keywords are matched whole-word (multi-word phrases matched as substrings).
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
        const id = y.year + '-' + i;
        const slot = { id, year: y.year, evIndex: i, domain: e.d || '', maps: e.t,
          search: (i === hi && m.search) ? m.search : ev.search,
          phrases: ev.phrases.slice(), strong: [], sw: ev.sw.slice(), weak: [], concepts: detectConcepts(e.t),
          evidenceFamily: familyForPrediction(id) };
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
    const id = 'horizon-' + item.id;
    out.push({
      id,
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
      evidenceFamily: familyForPrediction(id),
    });
  }
  if (out.length) return out;
  // Offline fallback: inline defaults, one matcher per year (id = YEAR-0).
  return DEFAULT_PREDICTIONS.map(p => ({ id: p.year + '-0', year: p.year, evIndex: 0, maps: p.maps, search: p.search, phrases: p.phrases, strong: p.strong, sw: [], weak: p.weak, concepts: detectConcepts(p.maps) }));
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
/* X RETIREMENT 2026-08-13 - mapCachedItems, readPrivateHistory and readPrivateHistoryMetadata read
   the harvested @peterxing status corpus out of the private secrets directory. The corpus, its
   hydration chain and the X API are retired, so their helpers (loadCorpus, corpusToMatcherItems)
   were deleted - but these three callers and two of their exports survived, leaving functions that
   throw ReferenceError on first call and a secrets path still named in the build. Removed outright:
   there is no X corpus to read, and no reader should be one require() away from a crash. */
function ageHours(when){
  const d = new Date(when);
  return isNaN(d.getTime()) ? Infinity : Math.max(0, (Date.now() - d.getTime()) / 36e5);
}
function loadEvidenceApprovals(){
  /* X RETIREMENT 2026-08-13 — evidence-approvals.json held 30 reviewed @peterxing X approvals, each
     with an x.com publicUrl, and it was on the PUBLISH allow-list, so retiring X while leaving it in
     place would have kept shipping 30 x.com links on the public surface. The file is deleted and this
     reader returns an empty store rather than being removed, because several call sites legitimately
     ask "is there a reviewed approval for this prediction?" and the correct answer everywhere is now
     no. It is NOT a silent fallback: the file's absence is the intended state, not a read failure. */
  return {};
}
/* X RETIREMENT 2026-08-13 - REWRITTEN, NOT PATCHED. The previous body emitted, on every run:
     primarySource : 'first-party-status'
     message       : '...status IDs are archive-discovered, hydrated through X first-party status JSON,
                      and independently cross-checked through X oEmbed.'
     actionRequired: 'Check X API credentials, plan access, and network connectivity.'
   None of that is true any more. It is worse than a stale constant, because signals.sourceStatus is
   PUBLISHED and the UI renders it: the page would have described an X hydration chain that no longer
   exists and asked the reader to check credentials for an API this pipeline no longer calls. Every one
   of the eight X reason/action pairs is retired with it - they diagnosed X API failures, and an X API
   failure is no longer a degradation of anything, because nothing depends on it. */
function sourceStatusFor(source, attempts){
  const retired = attempts.filter(attempt => attempt.status === 'retired').map(attempt => attempt.source);
  return {
    mode: source === 'news-verified' ? 'news-verified' : 'unavailable',
    primarySource: 'live-verified-news',
    activeSource: source,
    reason: 'x-evidence-retired-2026-08-13',
    message: 'Predictions are evidenced only by authoritative news and research published inside the '
      + `${CURRENCY_MAX_AGE_DAYS}-day currency window. Every citation is fetched live at review and again `
      + 'at publish, its verbatim quote re-checked in the fetched text, and a SHA-256 of that text '
      + 'compared against the reviewed hash. A prediction with no qualifying source in the window is '
      + 'recorded as uncited rather than left blank.',
    actionRequired: null,
    retiredSources: retired,
    httpStatus: null,
    windowDays: CURRENCY_MAX_AGE_DAYS,
    verificationPaceMs: null,
  };
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
// A failed guard rejects the direct candidate; incomplete direct coverage fails publication.
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
      /\b(?:top expert|human expert|human level|expert level|expert|physician|scientist|researcher|benchmark|benchmarks|sota)\b/,
      /\b(?:every cognitive field|all cognitive fields|across (?:essentially )?(?:every|all|multiple|many) (?:cognitive )?(?:fields?|domains?|disciplines?)|cross domain|multi domain|(?:for )?(?:every|all) subjects?)\b/,
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
/* VACUITY GUARD, AT MODULE LOAD. `[].every(...)` is true, so an empty FACET_GUARDS turns the facet
   relevance gate into a pass-through that still reports posts as facet-qualified, and a guard whose
   `all` list is empty does the same one level down. Both are one careless edit away and neither
   would fail any existing gate, so the whole table is validated here.

   WHY AT LOAD RATHER THAN AT THE POINT OF USE. Both assertions originally lived inside
   passesFacetGuards(). Mutation showed they were NOT ARMED there for `refresh-signals.js`: emptying
   FACET_GUARDS, and emptying a guard's `all` list, both ran the daily pipeline to completion with
   byte-identical output, because the daily news-only path never scores a post. Module scope runs on
   every require and every direct invocation, so this placement is armed for every entry point.

   CORRECTION, RECORDED SO THE WRONG REASON IS NOT REUSED. "Unreachable" was measured from ONE entry
   point and is false for the file: verify-signal-matcher.js calls qualifyPost() directly. Measured
   counterfactual — the old point-of-use placement, with FACET_GUARDS emptied, run through
   verify-signal-matcher.js: exit 76, "FACET_GUARDS is empty" thrown. So that placement WAS armed,
   for that entry point, and unarmed only for the daily writer. Reachability measured from a single
   caller is not reachability, and a mutant that survives one entry point has not survived the
   program. The placement here is still right — load scope dominates every call site — but the
   justification is "armed for all entry points", not "the call site is dead". */
if (!Array.isArray(FACET_GUARDS) || !FACET_GUARDS.length) {
  throw new Error('FACET_GUARDS is empty: the facet gate would approve every post');
}
for (const g of FACET_GUARDS) {
  if ('all' in g && (!Array.isArray(g.all) || !g.all.length)) {
    throw new Error(`FACET_GUARD "${g.title}" has an empty \`all\` list: it would approve every post`);
  }
}

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
    .replace(/&amp;/g, ' and ')
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
  if (/\binterpretability tools translate internal model reasoning into reliable human understandable summaries\b/.test(normTitle)) {
    return /\b(?:internal model reasoning|reasoning trace|chain of thought|internal representation|latent activation|model internals?)\b/.test(normText)
      && /\b(?:translate|translated|translation|summary|summaries|human understandable|plain language|explanation)\b/.test(normText)
      && /\b(?:reliable|faithful|validated|validation|causal|accuracy|accurate|robust|reproducible)\b/.test(normText);
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
      && hasBoundQuantity(clause, '(?:humanoid )?(?:robots|optimus units)', 1000));
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
      && /\b(?:ai r d|ai r amp d|ai r and d|ai research|model research|machine learning research|frontier research|successor models?|building smarter ai)\b/.test(clause)
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
  /* VACUITY GUARD lives at module load, immediately below the FACET_GUARDS constant, not here.
     Both this table's non-emptiness and each guard's `all` list are validated there, because
     mutation showed the point-of-use placement was not armed for the daily pipeline. Do not move
     the assertions back into this function without re-proving by mutation that every entry point
     executes it — refresh-signals.js does not, verify-signal-matcher.js does. */
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
function qualifyFamilyPost(text, p){
  const family = FAMILY_DEFINITIONS[p.evidenceFamily];
  if (!family || !family.match) return { ok: false, reason: 'family-match-not-declared' };
  const concepts = detectConcepts(text);
  const all = family.all || [];
  const any = family.any || [];
  if (all.some(concept => !concepts.has(concept))) return { ok: false, reason: 'family-required-concept' };
  if (any.length && !any.some(concept => concepts.has(concept))) return { ok: false, reason: 'family-corroboration' };
  if (family.text && !family.text.test(normalizeConceptText(text))) return { ok: false, reason: 'family-core-facet' };
  if (!passesFacetGuards(text, p)) return { ok: false, reason: 'facet' };
  const conceptHits = [...concepts].filter(concept => all.includes(concept) || any.includes(concept));
  return {
    ok: true,
    matchMethod: 'family',
    scored: {
      score: 0,
      coverage: conceptHits.length,
      conceptScore: conceptHits.reduce((sum, concept) =>
        sum + (MATCH_CONCEPT_BY_NAME.get(concept)?.weight || 1), 0),
      conceptHits,
      hit: [],
    },
  };
}

/* ---- 1. X ingest files are retired and their presence is now a HARD FAILURE ----
   ingestList() hydrated reviewed X activity IDs through the first-party X path. That path is gone,
   so the function referenced an undefined hydrateActivity: it survived only because reposts.json
   does not exist and its existence guard returned [] first. An invariant that rests on a file being
   absent is not an invariant. Restoring any X ingest file must now FAIL the build loudly instead of
   silently re-admitting X data or dying on an undefined symbol. */
function assertNoXIngestFiles(){
  const retired = ['reposts.json', 'posts.json', 'x-archive.json', 'archive.json', 'timeline.json'];
  const present = retired.filter(name => fs.existsSync(path.join(DIR, name)));
  if (present.length) {
    console.error(`[refresh] FATAL: retired X ingest file(s) present: ${present.join(', ')}. `
      + 'X evidence was retired on the site owner\'s instruction; remove these files or restore the '
      + 'X pipeline deliberately. Refusing to build.');
    process.exit(1);
  }
}

async function main(){
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8').replace(/^\uFEFF/, '')); } catch(e){}
  const prevEmbeds = (prev && prev.embeds) || {};
  const prevSearches = (prev && prev.search) || {};
  let historicalTimeline = [];

  // Load the live (daily-revised) prediction set, expanded to ONE matcher per event.
  const PREDICTIONS = buildPredictions();
  const evidenceApprovals = loadEvidenceApprovals();
  const predictionIds = new Set(PREDICTIONS.map(prediction => prediction.id));
  const predictionById = new Map(PREDICTIONS.map(prediction => [prediction.id, prediction]));
  const unknownApprovalIds = Object.keys(evidenceApprovals).filter(id => !predictionIds.has(id));
  if (unknownApprovalIds.length) {
    throw new Error(`evidence approvals reference unknown predictions: ${unknownApprovalIds.join(', ')}`);
  }
  /* X RETIREMENT 2026-08-13 - INVERTED, on the verify-news-evidence.js L70-73 template. This block
     validated the SHAPE of a reviewed X approval: 15-digit post and activity ids, authored/reposted
     relationships, and a publicUrl that had to equal the x.com/<author>/status/<postId> shape - the
     last place in the builder that CONSTRUCTED an x.com url. loadEvidenceApprovals() now returns {}
     permanently, so every one of those predicates was unreachable: dead code that still built an X
     url, which is exactly the render-layer class GC seq-93 caught in app.js.

     Deleting it silently would leave nothing to notice a reinstated approvals store, so the check is
     inverted instead: the store must be EMPTY, and any entry at all is a hard failure naming what
     reappeared. A gate that gets stronger as the migration completes, rather than one that quietly
     stops meaning anything. */
  const reinstatedApprovals = Object.keys(evidenceApprovals);
  if (reinstatedApprovals.length) {
    throw new Error(
      `reviewed X evidence approvals were reinstated after retirement (`
      + `${reinstatedApprovals.length}: ${reinstatedApprovals.slice(0, 5).join(', ')}`
      + `${reinstatedApprovals.length > 5 ? ', ...' : ''})`
    );
  }
  const externalIds = Object.keys(EXTERNAL_MAPPINGS);
  const unknownExternalIds = externalIds.filter(id => !predictionIds.has(id));
  const mixedOverlap = Object.keys(evidenceApprovals).filter(id => EXTERNAL_MAPPINGS[id]);
  if (unknownExternalIds.length || mixedOverlap.length) {
    throw new Error(
      `mixed evidence ledger mismatch (unknown external: ${unknownExternalIds.join(', ') || 'none'}; `
      + `overlap: ${mixedOverlap.join(', ') || 'none'})`
    );
  }
  const familyCoverage = validateFamilyCoverage(PREDICTIONS.map(prediction => prediction.id));
  if (familyCoverage.missing.length || familyCoverage.extra.length
      || PREDICTIONS.some(prediction => !FAMILY_DEFINITIONS[prediction.evidenceFamily])) {
    throw new Error(
      `evidence-family contract is incomplete (missing: ${familyCoverage.missing.join(', ') || 'none'}; `
      + `extra: ${familyCoverage.extra.join(', ') || 'none'})`
    );
  }
  const datedPredictionCount = PREDICTIONS.filter(p => p.scope !== 'horizon').length;
  const horizonPredictionCount = PREDICTIONS.length - datedPredictionCount;
  const predYears = new Set(PREDICTIONS.filter(p => p.scope !== 'horizon').map(p => p.year)).size;
  console.error(`[refresh] Matching against ${datedPredictionCount} dated predictions across ${predYears} years plus ${horizonPredictionCount} horizon items.`);

  // X RETIREMENT 2026-08-13 — this block previously called the X API and the archive corpus. Both are
  // retired. Nothing here reaches the network, and the timeline is empty BY CONSTRUCTION rather than by
  // failure, so no downstream X path can ever be reached with data.
  const timeline = [];
  let source = 'news-verified'; let sourceWhen = new Date();
  const staleSourcesRejected = [];
  const verifiedActivityIdsThisRun = new Set();
  const sourceAttempts = [{
    source: 'x-api',
    status: 'retired',
    count: 0,
    reason: 'x-evidence-retired-2026-08-13',
    detail: 'The X API and the @peterxing archive corpus were retired at the site owner\'s instruction. '
      + 'Predictions are now evidenced only by live-verified news published inside the currency window.',
  }, {
    source: 'archive-verified',
    status: 'retired',
    count: 0,
    reason: 'x-evidence-retired-2026-08-13',
  }];
  const apiCaps = { xApi: null, archive: null, retired: 'x-evidence-retired-2026-08-13' };
  const archive = {
    payload: {
      count: 0, verifiedCount: 0, kinds: {},
      oldestItemAt: null, newestItemAt: null,
      discovery: { count: 0 },
      verification: { updated: sourceWhen.toISOString() },
    },
    matcherItems: [], sourceAttempts: [], verifiedActivityIds: [],
  };

  assertNoXIngestFiles();
  const optionalReposts = [];

  // X RETIREMENT 2026-08-13 - this merged the verified archive corpus by its original source ID.
  // `timeline` is empty BY CONSTRUCTION (see the retirement note above it), so this loop is a no-op
  // retained only to keep the downstream shape unchanged. Nothing is read and nothing reaches the map.
  const byId = new Map();
  for (const it of [...timeline, ...optionalReposts]) {
    if (!it || isNaN(it.created.getTime())) continue;
    const ex = byId.get(it.id);
    const hasRicherRepostProvenance = it.kind === 'repost'
      && it.activityId && it.activityId !== it.id
      && (!ex?.activityId || ex.activityId === ex.id);
    if (!ex || KIND_RANK[it.kind] < KIND_RANK[ex.kind] || hasRicherRepostProvenance) {
      byId.set(it.id, it);
    }
  }
  const all = [...byId.values()].sort((a, b) => b.created - a.created);
  const now = Date.now();
  const eligible = all.filter(t => (now - t.created.getTime()) <= MAX_AGE_DAYS * 864e5);
  const pastWeek = all.filter(t => (now - t.created.getTime()) <= PAST_WEEK_DAYS * 864e5);

  const counts = {
    entries: timeline.length,
    history: historicalTimeline.length,
    posts: 0,
    reposts: 0,
    authored: 0,
    quotes: 0,
    replies: 0,
    likes: 0,
    bookmarks: 0,
    uniques: all.length,
    eligible: eligible.length,
    pastWeek: pastWeek.length,
  };
  for (const t of timeline) {
    const key = t.kind + 's';
    if (counts[key] != null) counts[key]++;
    const corpusKey = t.corpusKind === 'quote' ? 'quotes'
      : t.corpusKind === 'reply' ? 'replies'
        : t.corpusKind === 'authored' ? 'authored'
          : null;
    if (corpusKey) counts[corpusKey]++;
  }
  counts.reposts += optionalReposts.length;
  const newest = all.length ? fmtDate(all[0].created) : '(none)';
  const oldest = all.length ? fmtDate(all[all.length - 1].created) : '(none)';
  console.error(`[refresh] archive-verified=${counts.entries}; authored/quote/reply=${counts.authored}/${counts.quotes}/${counts.replies}; reposts=${counts.reposts}; unique status corpus=${counts.uniques}; span ${oldest} -> ${newest}; eligible(<=${MAX_AGE_DAYS}d) ${counts.eligible}; past-week ${counts.pastWeek}.`);

  // Source freshness and evidence age are distinct. Historical evidence is allowed only after a fresh source check.
  if (!pastWeek.length) console.error('[refresh] No activity in the past week — expected: the @peterxing timeline was '
    + 'retired on 2026-08-13 and is empty by construction. Evidence comes from live-verified news.');

  // ---- 3. Guarded lexical + semantic scoring -> maximum-coverage assignment ------------------------
  // Literal hits and the controlled concept ontology both remain subordinate to claim-specific facet
  // guards. Semantic-only matches are limited to recent activity so broad historical backfilling cannot
  // inflate coverage. Allocation maximizes unique relevant posts first, then declared-family reuse.
  const eligibleById = new Map(eligible.map(item => [String(item.id), item]));
  const eligibleByActivityId = new Map(
    timeline
      .filter(item => (now - item.created.getTime()) <= MAX_AGE_DAYS * 864e5)
      .map(item => [String(item.activityId), item])
  );
  const candidateLists = {};
  const rawCandidateLists = {};
  const unapprovedCandidateCounts = {};
  const guardRejections = {};
  for (const p of PREDICTIONS) {
    const cands = [];
    const approval = evidenceApprovals[p.id];
    for (const t of eligible) {
      const ageDays = (now - t.created.getTime()) / 864e5;
      const reviewedText = approval && String(t.id) === String(approval.postId) && approval.publicText
        ? approval.publicText
        : t.text;
      const direct = qualifyPost(reviewedText, p, ageDays);
      const family = direct.ok ? null : qualifyFamilyPost(reviewedText, p);
      const qualified = direct.ok ? direct : family;
      const assignmentMode = direct.ok ? 'direct' : 'family-reuse-candidate';
      const { scored, matchMethod } = qualified;
      if (!qualified.ok && direct.reason === 'relevance') continue;
      if (!qualified.ok) {
        if (!guardRejections[p.id]) guardRejections[p.id] = { count: 0, samples: [] };
        guardRejections[p.id].count++;
        if (guardRejections[p.id].samples.length < 10) {
          guardRejections[p.id].samples.push({
            id: t.id,
            author: t.author,
            date: fmtDate(t.created),
            method: direct.matchMethod || null,
            concepts: direct.scored && direct.scored.conceptHits || [],
          });
        }
        continue;
      }
      const tier = ageDays <= PAST_WEEK_DAYS ? 'week' : ageDays <= 180 ? 'recent' : 'historical';
      const authorshipRank = t.kind === 'post' ? 2 : 1;
      cands.push({
        id: p.id,
        year: p.year,
        p,
        t,
        reviewedText,
        score: scored.score,
        coverage: scored.coverage,
        conceptScore: scored.conceptScore,
        conceptHits: scored.conceptHits,
        recencyRank: recencyRank(t.created, now),
        authorshipRank,
        corpusKind: t.corpusKind || (t.kind === 'repost' ? 'repost' : 'authored'),
        tier,
        hit: scored.hit,
        matchMethod,
        assignmentMode,
        evidenceFamily: p.evidenceFamily,
        facetBasis: direct.ok ? 'prediction-facets' : 'declared-family',
        created: t.created,
      });
    }
    cands.sort((a, b) =>
      (b.assignmentMode === 'direct') - (a.assignmentMode === 'direct')
      || b.authorshipRank - a.authorshipRank
      || b.coverage - a.coverage
      || b.conceptScore - a.conceptScore
      || b.score - a.score
      || b.recencyRank - a.recencyRank
      || b.created - a.created);
    rawCandidateLists[p.id] = cands;
    const approvedActivity = approval ? eligibleByActivityId.get(String(approval.activityId)) : null;
    const approvedPost = approvedActivity && String(approvedActivity.id) === String(approval.postId)
      ? approvedActivity
      : null;
    const reviewedText = approval?.publicText || approvedPost?.text || '';
    const reviewedQualification = approvedPost ? qualifyPost(reviewedText, p, 0) : null;
    candidateLists[p.id] = approvedPost ? [{
      id: p.id,
      year: p.year,
      p,
      t: approvedPost,
      reviewedText,
      score: reviewedQualification?.scored?.score || 0,
      coverage: reviewedQualification?.scored?.coverage || 0,
      conceptScore: reviewedQualification?.scored?.conceptScore || 0,
      conceptHits: reviewedQualification?.scored?.conceptHits || [],
      recencyRank: recencyRank(approvedPost.created, now),
      authorshipRank: approvedPost.kind === 'post' ? 2 : 1,
      corpusKind: approvedPost.corpusKind || (approvedPost.kind === 'repost' ? 'repost' : 'authored'),
      tier: ((now - approvedPost.created.getTime()) / 864e5) <= PAST_WEEK_DAYS ? 'week'
        : ((now - approvedPost.created.getTime()) / 864e5) <= 180 ? 'recent' : 'historical',
      hit: reviewedQualification?.scored?.hit || [],
      matchMethod: 'reviewed-sticky',
      assignmentMode: 'direct',
      evidenceFamily: p.evidenceFamily,
      facetBasis: 'reviewed-prediction-bound',
      created: approvedPost.created,
    }] : [];
    unapprovedCandidateCounts[p.id] = Math.max(0, cands.length - candidateLists[p.id].length);
  }
  const candidateAudit = {};
  for (const p of PREDICTIONS) {
    candidateAudit[p.id] = rawCandidateLists[p.id].slice(0, 3).map(c => ({
      id: c.t.id,
      author: c.t.author,
      activityId: c.t.activityId,
      corpusKind: c.corpusKind,
      authorship: c.authorshipRank === 2 ? 'authored' : 'reposted',
      date: fmtDate(c.t.created),
      tier: c.tier,
      method: c.matchMethod,
      assignmentMode: c.assignmentMode,
      evidenceFamily: c.evidenceFamily,
      facetBasis: c.facetBasis,
      score: c.score,
      conceptScore: c.conceptScore,
      concepts: c.conceptHits,
      approved: candidateLists[p.id].some(candidate => candidate.t.id === c.t.id),
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

  // Phase 2: reuse only inside an explicitly declared compatible evidence family. This preserves
  // maximum unique-post coverage without an arbitrary quota or cross-topic reuse.
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
      const prediction = predictionById.get(predId);
      const definition = FAMILY_DEFINITIONS[prediction.evidenceFamily];
      const sameFamily = owners.size > 0 && [...owners].every(ownerId =>
        predictionById.get(ownerId).evidenceFamily === prediction.evidenceFamily);
      if (!owners.size || (definition.reuse && sameFamily)) {
        setAssignment(predId, cand);
        return true;
      }
    }
    return false;
  }
  for (const p of allocationOrder) {
    if (!picks[p.id]) assignWithCapacity(p.id, new Set(), new Set());
  }
  const postUses = new Map([...postOwners.entries()].filter(([, owners]) => owners.size).map(([id, owners]) => [id, owners.size]));
  const usedPosts = new Set(postUses.keys());
  const externalUsesBySource = {};
  for (const mapping of Object.values(EXTERNAL_MAPPINGS)) {
    externalUsesBySource[mapping.source] = (externalUsesBySource[mapping.source] || 0) + 1;
  }

  // X RETIREMENT 2026-08-13 - verified news is the SOLE evidence medium, NOT a tier consulted after
  // some other pipeline has run. `picks` and EXTERNAL_MAPPINGS are both empty post-retirement, so
  // every prediction is news-eligible and the filter below is a structural guard rather than a
  // fallback condition. There is no upstream pipeline to wait for and no API state to depend on.
  // Every mapping is live-fetched and quote-checked here and again in the publish preflight; any
  // failure blocks the mapping rather than degrading it.
  const newsEligibleIds = new Set(PREDICTIONS
    .filter(p => !picks[p.id] && !EXTERNAL_MAPPINGS[p.id])
    .map(p => p.id));
  const newsVerified = new Map();
  const newsIntegrityErrors = [];
  const knownPredictionIds = new Set(PREDICTIONS.map(p => p.id));
  for (const [predictionId, mapping] of Object.entries(NEWS_MAPPINGS)) {
    if (!knownPredictionIds.has(predictionId)) {
      newsIntegrityErrors.push(`news mapping references unknown prediction ${predictionId}`);
    } else if (!newsEligibleIds.has(predictionId)) {
      newsIntegrityErrors.push(`news mapping ${predictionId} would displace reviewed X evidence`);
    }
  }
  for (const predictionId of newsEligibleIds) {
    const mapping = NEWS_MAPPINGS[predictionId];
    const article = mapping && NEWS_SOURCES[mapping.source];
    if (!mapping || !article) continue;
    const check = await verifyNewsSource(mapping.source, article);
    if (check.problems.length) {
      newsIntegrityErrors.push(...check.problems);
      continue;
    }
    newsVerified.set(predictionId, { mapping, article });
  }
  /* X RETIREMENT 2026-08-13 / A17 - a SOURCE is an article, not a ledger row. Two reviewed rows may
     quote different sentences of the same piece; that is legitimate reuse and it is declared through
     a shared reuseFamily. It is NOT two sources. Reuse was previously tallied by ledger key, so one
     Nature article serving two predictions reported as two sources each used once - a metric that
     outlived the substrate it was built for. Identity is now the RESOLVED url (post-redirect,
     post-canonical), so it cannot be split by naming a row twice, and the tally is computed from the
     VERIFIED set rather than the declared one. */
  const newsSourceKey = url => {
    try { return normalizeUrl(String(url || '')).replace(/\/+$/, '').toLowerCase(); }
    catch { return String(url || '').toLowerCase(); }
  };
  const newsUsesByArticle = {};
  for (const { article } of newsVerified.values()) {
    const key = newsSourceKey(article.resolvedUrl);
    newsUsesByArticle[key] = (newsUsesByArticle[key] || 0) + 1;
  }

  // Build exactly one reviewed direct embed per prediction.
  const embeds = {}; const searches = {}; const chosen = {}; const uncited = {};
  /* X RETIREMENT 2026-08-13 - refusals raised by the retired-medium branches inside the loop below.
     mappingIntegrityErrors does not exist yet at that point, so they are collected here and merged. */
  const retiredMediumRefusals = [];
  for (const p of PREDICTIONS) {
    const c = picks[p.id];
    if (!c) {
      const mapping = EXTERNAL_MAPPINGS[p.id];
      const external = mapping && EXTERNAL_SOURCES[mapping.source];
      if (!mapping || !external) {
        const news = newsVerified.get(p.id);
        if (news) {
          const { mapping: newsMapping, article } = news;
          let newsText = cleanText(article.quote);
          if (newsText.length > 220) newsText = newsText.slice(0, 217) + '\u2026';
          const articleKey = newsSourceKey(article.resolvedUrl);
          const newsReuse = newsUsesByArticle[articleKey] || 1;
          embeds[p.id] = {
            id: `news:${newsMapping.source}`,
            /* The identity every reuse count, ceiling and uniqueness check must group on. The ledger
               key stays as the row's own name so two quotes from one article remain separable. */
            sourceKey: articleKey,
            kind: 'news',
            activityKind: 'news',
            authorship: 'news',
            evidenceOwner: 'news',
            evidenceMedium: 'news',
            publisher: article.publisher,
            publisherHost: article.publisherHost,
            byline: article.author || null,
            headline: article.headline,
            quote: article.quote,
            articleDate: article.publishedAt,
            url: article.resolvedUrl,
            provenance: {
              evidenceOwner: 'news',
              activityKind: 'news',
              publisher: article.publisher,
              publisherHost: article.publisherHost,
              byline: article.author || null,
              publishedAt: article.publishedAt,
              /* WHERE that date came from. 'publishedAt' names two different facts in this tree, so
                 the value travels with its provenance rather than being compared blind. */
              publishedAtSource: article.publishedAtSource,
              retrievedAt: article.retrievedAt,
              sourceQuality: article.sourceQuality,
              verifiedThrough: 'live-fetch+quote-match',
              sourceChain: ['live-fetch', 'metadata-extract', 'quote-match'],
              lastVerifiedAt: newsMapping.lastVerifiedAt,
              textSha256: article.textSha256,
            },
            recency: 'news',
            matchMethod: 'reviewed-news',
            matchBasis: newsMapping.evidenceType,
            assignmentMode: newsReuse > 1 ? 'news-reuse' : 'unique',
            evidenceFamily: p.evidenceFamily,
            reuseFamily: newsMapping.reuseFamily,
            evidenceType: newsMapping.evidenceType,
            mappingRationale: newsMapping.rationale,
            sourceQuality: article.sourceQuality,
            reuseCount: newsReuse,
            matchedConcepts: [...p.concepts],
            matchedFacets: [newsMapping.evidenceType],
            reviewed: true,
            reviewedAt: newsMapping.reviewedAt,
            lastVerifiedAt: newsMapping.lastVerifiedAt,
            date: fmtDate(new Date(article.publishedAt)),
            maps: p.maps,
            text: newsText,
          };
          chosen[p.id] = `news:${article.publisherHost} [${newsMapping.evidenceType}/${embeds[p.id].assignmentMode} source=${newsMapping.source} reuse=${newsReuse}]`;
          continue;
        }
        chosen[p.id] = `uncited [no authoritative source published in the last ${CURRENCY_MAX_AGE_DAYS} days matched this prediction]`;
        /* AN ABSENT PANEL AND A SUPPRESSED PANEL LOOK IDENTICAL, AND ONLY ONE OF THEM IS HONEST.
           This is the whole point of the migration: a prediction with no qualifying in-window source
           is never given a borrowed, stale or merely adjacent citation. It is recorded here, by id,
           with the window that was searched, so the page can state the absence as a RESULT. */
        uncited[p.id] = {
          id: p.id,
          reason: "no-qualifying-source-in-window",
          windowDays: CURRENCY_MAX_AGE_DAYS,
          searchedAt: new Date().toISOString(),
          statement: `No authoritative source published in the last ${CURRENCY_MAX_AGE_DAYS} days was found for this prediction. `
            + `Nothing older, adjacent or unreviewed has been substituted.`,
        };
        continue;
      }
      /* X RETIREMENT 2026-08-13 - REFUSED AT THE PRODUCER, NOT ONLY AT THE GATE. This branch BUILT an
         X-medium embed: authorship 'external', an x.com url, verifiedThrough 'first-party-status+oembed'
         and sourceChain ['tweet-result', 'x-oembed']. It was unreachable only because EXTERNAL_MAPPINGS
         and EXTERNAL_SOURCES are empty, and its output was rejected far downstream by the evidenceOwner
         gate. Both are properties of neighbours. Repopulate either constant and the builder runs again.
         The construction is deleted so a reinstated X mapping fails HERE, as a reinstatement, before any
         retired provenance is assembled. */
      retiredMediumRefusals.push(`${p.id}: reviewed external X evidence was retired on 2026-08-13; `
        + `EXTERNAL_MAPPINGS/EXTERNAL_SOURCES must stay empty and no X embed may be rebuilt`);
      continue;
    }
    /* X RETIREMENT 2026-08-13 - REFUSED AT THE PRODUCER. This branch BUILT a @peterxing embed carrying
       verifiedThrough 'archive-verified' and sourceChain ['wayback-cdx', 'tweet-result', 'x-oembed'],
       assembled from evidence-approvals.json. It is unreachable today only because the approvals reader
       returns {} and the X candidate pipeline yields no picks - by empty inputs, not by design. Building
       retired provenance and relying on a gate 200 lines downstream to reject it is the same shape as
       every other defect found this week: the property is carried by a neighbour, not by this code. */
    retiredMediumRefusals.push(`${p.id}: reviewed @peterxing X evidence was retired on 2026-08-13; `
      + `no archive-verified activity embed may be rebuilt`);
  }

  /* ---- 4. REALITY SIGNALS - REBUILT ON THE NEWS LAYER, 2026-08-13 ---------------------------------
     This grid used to surface @peterxing's own recent posts per theme, and when a theme had no fresh
     post it emitted a CARD WHOSE ONLY CONTENT WAS A LINK to an X search: kind:'search', rendered by
     app.js as "Search latest @peterxing posts". Those cards asserted nothing and measured nothing -
     they were an invitation to go and look on X - and with X retired they would have been dead links
     dressed as observations.

     The grid is now a FIELD LOG of what this pipeline actually verified: each card is one live-fetched,
     quote-checked article, tagged to the theme it matched, carrying its publisher, its publication date
     and its real URL. A theme with no qualifying in-window article emits an explicit NO-OBSERVATION
     card rather than a search prompt, for the same reason the uncited channel exists: an empty theme and
     a suppressed theme must not look alike. Nothing here is fabricated - every field is copied from an
     article that was fetched, hashed and quote-verified this run. */
  const themeMatch = (text, kws) => {
    const hay = String(text || '').toLowerCase();
    return kws.reduce((score, kw) => score + (hay.includes(String(kw).toLowerCase()) ? 1 : 0), 0);
  };
  const observedArticles = [...newsVerified.values()].map(({ mapping, article }) => ({ mapping, article }));
  const claimedArticles = new Set();
  const reality = [];
  for (const th of REALITY_THEMES) {
    let best = null;
    for (const entry of observedArticles) {
      const { article } = entry;
      if (claimedArticles.has(article.resolvedUrl)) continue;
      const score = themeMatch(`${article.headline} ${article.quote}`, th.kws);
      if (score < 1) continue;
      const publishedMs = Date.parse(article.publishedAt);
      if (!Number.isFinite(publishedMs)) continue;
      const ageDays = (now - publishedMs) / 864e5;
      if (Math.round(ageDays) > CURRENCY_MAX_AGE_DAYS) continue;
      const rank = score * 100 - ageDays;
      if (!best || rank > best.rank) best = { entry, score, ageDays, publishedMs, rank };
    }
    if (!best) {
      reality.push({
        tag: th.tag,
        t: `No authoritative source published in the last ${CURRENCY_MAX_AGE_DAYS} days matched this theme. `
          + 'Nothing older or unverified has been substituted.',
        kind: 'none',
        recency: 'none',
      });
      continue;
    }
    claimedArticles.add(best.entry.article.resolvedUrl);
    const { article } = best.entry;
    let rtext = cleanText(article.quote);
    if (rtext.length > 150) rtext = rtext.slice(0, 147) + '\u2026';
    const ageDays = best.ageDays;
    reality.push({
      tag: th.tag,
      t: rtext,
      kind: 'news',
      headline: article.headline,
      publisher: article.publisher,
      publisherHost: article.publisherHost,
      url: article.resolvedUrl,
      author: article.author || null,
      recency: ageDays <= PAST_WEEK_DAYS ? 'week' : 'recent',
      ageDays: Math.round(ageDays),
      date: fmtDate(new Date(best.publishedMs)),
      publishedAt: article.publishedAt,
      publishedAtSource: article.publishedAtSource || null,
    });
  }
  /* Freshest first, and observations always above the explicit no-observation cards.
     ORDER ON THE EXACT INSTANT, NOT ON `ageDays`. ageDays is Math.round()ed, so two articles a day
     apart collapse to the same integer as the clock moves; the comparator then returns 0 and the
     order falls through to insertion order, which carries no editorial meaning. That reshuffled
     Nature against MIT Technology Review between two builds 85 minutes apart with no data change.
     NO TAG TIE-BREAK: the no-observation cards all have a null instant, so an alphabetical
     tie-break would reorder them out of the site's theme sequence -- a presentation change nobody
     asked for. Array.prototype.sort is stable per ES2019, and insertion order here is a static
     theme list, so ties keep their existing published order and a rebuild is still reproducible. */
  const publishedInstant = r => {
    const ms = r.publishedAt ? Date.parse(r.publishedAt) : NaN;
    return Number.isFinite(ms) ? ms : -Infinity;
  };
  reality.sort((x, y) => (y.kind === 'news') - (x.kind === 'news')
    || (publishedInstant(x) === publishedInstant(y) ? 0 : publishedInstant(y) - publishedInstant(x)));

  const sourceAgeHours = ageHours(sourceWhen);
  const newestItemAt = all.length ? all[0].created.toISOString() : null;
  const newestItemAgeHours = all.length ? Math.max(0, (Date.now() - all[0].created.getTime()) / 36e5) : null;
  const sourceFresh = source !== 'unavailable' && sourceAgeHours <= SOURCE_CACHE_MAX_HOURS;
  const directUsesByPost = new Map();
  for (const [predictionId, embed] of Object.entries(embeds)) {
    /* Group on the source's identity, never the row's name - see A17 note above. */
    const sourceId = String(embed.sourceKey || embed.id);
    if (!directUsesByPost.has(sourceId)) directUsesByPost.set(sourceId, []);
    directUsesByPost.get(sourceId).push({ predictionId, embed });
  }
  const directUseCounts = [...directUsesByPost.values()].map(uses => uses.length);
  const reusedPosts = directUseCounts.filter(count => count > 1).length;
  const maxPostReuseObserved = Math.max(0, ...directUseCounts);
  const reuseDistribution = {};
  for (const count of directUseCounts) reuseDistribution[count] = (reuseDistribution[count] || 0) + 1;
  const candidatePosts = new Set();
  const pastWeekCandidatePosts = new Set();
  for (const cands of Object.values(candidateLists)) for (const c of cands) {
    candidatePosts.add(c.t.id);
    if (c.tier === 'week') pastWeekCandidatePosts.add(c.t.id);
  }
  const usedPastWeekPosts = new Set(Object.values(picks).filter(c => c.tier === 'week').map(c => c.t.id));
  const matchMethodTally = {};
  for (const embed of Object.values(embeds)) {
    matchMethodTally[embed.matchMethod] = (matchMethodTally[embed.matchMethod] || 0) + 1;
  }
  const matchablePredictions = PREDICTIONS.filter(p => candidateLists[p.id].length).length;
  const unmatchedWithCandidates = PREDICTIONS.filter(p => candidateLists[p.id].length && !picks[p.id]).map(p => p.id);
  const unusedRelevantPosts = [...candidatePosts].filter(id => !usedPosts.has(id));
  const previousCoveredIds = new Set([...Object.keys(prevEmbeds), ...Object.keys(prevSearches)]);
  const currentCoveredIds = new Set(Object.keys(embeds));
  const previousDirectIds = new Set(Object.keys(prevEmbeds));
  const currentDirectIds = new Set(Object.keys(embeds));
  const coverageChange = {
    previousMatched: previousCoveredIds.size,
    currentMatched: currentCoveredIds.size,
    gained: [...currentCoveredIds].filter(id => !previousCoveredIds.has(id)),
    lost: [...previousCoveredIds].filter(id => !currentCoveredIds.has(id)),
    directGained: [...currentDirectIds].filter(id => !previousDirectIds.has(id)),
    directLost: [...previousDirectIds].filter(id => !currentDirectIds.has(id)),
  };
  const unusedRelevantPostSamples = unusedRelevantPosts.slice(0, 20).map(id => {
    const t = eligibleById.get(id);
    return t ? { id, author: t.author, date: fmtDate(t.created), concepts: [...detectConcepts(t.text)] } : { id };
  });
  const reuseAudit = [];
  const invalidReuse = [];
  for (const [postId, uses] of directUsesByPost.entries()) {
    const predictionIds = uses.map(use => use.predictionId).sort();
    const owners = [...new Set(uses.map(use => use.embed.evidenceOwner))];
    const peterFamilies = [...new Set(uses.map(use => use.embed.evidenceFamily))];
    const externalFamilies = [...new Set(uses.map(use => use.embed.reuseFamily).filter(Boolean))];
    const family = owners[0] === 'peterxing'
      ? peterFamilies.length === 1 ? peterFamilies[0] : null
      : externalFamilies.length === 1 ? externalFamilies[0] : null;
    const audit = {
      postId,
      reuseCount: predictionIds.length,
      predictionIds,
      evidenceOwner: owners.length === 1 ? owners[0] : null,
      reuseFamily: family,
      mode: predictionIds.length === 1 ? 'unique'
        : owners[0] === 'external' ? 'external-reuse'
          : owners[0] === 'news' ? 'news-reuse' : 'family-reuse',
      reviewed: uses.length > 0 && uses.every(use => use.embed.reviewed === true),
      mappingRationales: Object.fromEntries(uses.map(use => [
        use.predictionId,
        use.embed.mappingRationale,
      ])),
    };
    reuseAudit.push(audit);
    if (predictionIds.length > 1) {
      if (owners.length !== 1 || !family) {
        invalidReuse.push(audit);
      } else if (owners[0] === 'peterxing'
          && (!FAMILY_DEFINITIONS[family] || !FAMILY_DEFINITIONS[family].reuse)) {
        invalidReuse.push(audit);
      } else if (owners[0] === 'external'
          && uses.some(use => use.embed.reuseFamily !== family
            || use.embed.assignmentMode !== 'external-reuse')) {
        invalidReuse.push(audit);
      } else if (owners[0] === 'news'
          && uses.some(use => use.embed.reuseFamily !== family
            || use.embed.assignmentMode !== 'news-reuse')) {
        invalidReuse.push(audit);
      }
    }
  }
  reuseAudit.sort((a, b) => b.reuseCount - a.reuseCount || a.postId.localeCompare(b.postId));

  const mappingIntegrityErrors = [];
  if (!sourceFresh) mappingIntegrityErrors.push('fresh verified activity source unavailable');
  /* The two X provenance BUILDERS were replaced by refusals inside the matching loop, which runs
     long before this channel exists. Their refusals are carried here so a reinstated X mapping fails
     as a NAMED retirement breach rather than only as a generic "unaccounted prediction". */
  if (retiredMediumRefusals.length) mappingIntegrityErrors.push(...retiredMediumRefusals);
  if (invalidReuse.length) {
    mappingIntegrityErrors.push(`invalid reviewed reuse: ${invalidReuse.map(item => item.postId).join(', ')}`);
  }
  const expectedIds = PREDICTIONS.map(prediction => prediction.id);
  /* X RETIREMENT 2026-08-13 - THIS CHECK IS SUPERSEDED, AND LEAVING IT BESIDE ITS REPLACEMENT WAS MY
     THIRD REPEAT OF ONE MISTAKE. I added the accounted-for gate below without retiring this one, so the
     old rule kept firing first and the new one was never reached - the same read-site lesson that broke
     the import twice already. A prediction with no embed is no longer automatically a defect: it is a
     defect only if it is ALSO not recorded as uncited. Totality is preserved in full by the gate below,
     which still requires EVERY prediction to be accounted for; what changes is that "accounted for" now
     has two honest outcomes instead of one. */
  const missingCoverage = [];
  const extraCoverage = [...currentCoveredIds].filter(id => !predictionIds.has(id));
  if (missingCoverage.length) mappingIntegrityErrors.push(`missing direct coverage: ${missingCoverage.join(', ')}`);
  if (Object.keys(searches).length) mappingIntegrityErrors.push('prediction search fallbacks must be empty');
  if (extraCoverage.length) mappingIntegrityErrors.push(`coverage references unknown predictions: ${extraCoverage.join(', ')}`);
  for (const prediction of PREDICTIONS) {
    const embed = embeds[prediction.id];
    if (!embed) continue;
    const isNews = embed.evidenceOwner === 'news';
    if (!isNews && !/^\d{15,}$/.test(String(embed.id || ''))) {
      mappingIntegrityErrors.push(`${prediction.id}: invalid post ID`);
    }
    if (!isNews && !/^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d{15,}$/.test(String(embed.url || ''))) {
      mappingIntegrityErrors.push(`${prediction.id}: invalid direct X URL`);
    }
    if (isNews && !/^news:[a-z0-9][a-z0-9-]*$/.test(String(embed.id || ''))) {
      mappingIntegrityErrors.push(`${prediction.id}: invalid news evidence key`);
    }
    if (isNews && !/^https:\/\/[^\s/]+\.[^\s/]+\/\S*$/.test(String(embed.url || ''))) {
      mappingIntegrityErrors.push(`${prediction.id}: invalid resolved article URL`);
    }
    const provenance = embed.provenance || {};
    /* X RETIREMENT 2026-08-13 — these two branches VALIDATED X provenance: sticky approval backing,
       harvested-corpus membership, archive re-verification, and a sourceChain containing
       'tweet-result'. A gate that REQUIRES an X-verified record is the X contract restated in
       provenance vocabulary, so both are inverted. External evidence was an authoritative X status
       from another account, so it is X-medium and retires with the rest. Named rather than deleted so
       a reinstated embed fails as a REINSTATEMENT, not as a generic "invalid evidence owner". */
    if (embed.evidenceOwner === 'peterxing' || embed.evidenceOwner === 'external') {
      mappingIntegrityErrors.push(`${prediction.id}: '${embed.evidenceOwner}' X evidence was retired `
        + 'on 2026-08-13 and must not be published');
    } else if (embed.evidenceOwner === 'news') {
      const mapping = NEWS_MAPPINGS[prediction.id];
      const article = mapping && NEWS_SOURCES[mapping.source];
      if (!mapping || !article || !newsVerified.has(prediction.id)
          || embed.id !== `news:${mapping.source}`
          || embed.reviewed !== true || embed.reviewedAt !== mapping.reviewedAt
          || embed.url !== article.resolvedUrl) {
        mappingIntegrityErrors.push(`${prediction.id}: mapping lacks a matching live-verified news ledger entry`);
      }
      if (embed.kind !== 'news' || embed.activityKind !== 'news'
          || provenance.evidenceOwner !== 'news'
          || provenance.activityKind !== 'news'
          || provenance.publisher !== article?.publisher
          || provenance.publisherHost !== article?.publisherHost
          || provenance.sourceQuality !== article?.sourceQuality
          || !provenance.publishedAt
          || !provenance.retrievedAt
          || !provenance.textSha256
          || provenance.verifiedThrough !== 'live-fetch+quote-match'
          || !Array.isArray(provenance.sourceChain)
          || !provenance.sourceChain.includes('quote-match')
          || !embed.headline || !embed.quote || !embed.publisher
          || !['direct', 'scenario', 'leading-indicator'].includes(embed.evidenceType)
          || !embed.mappingRationale) {
        mappingIntegrityErrors.push(`${prediction.id}: incomplete news evidence provenance`);
      }
    } else {
      mappingIntegrityErrors.push(`${prediction.id}: invalid evidence owner`);
    }
    if (embed.evidenceFamily !== prediction.evidenceFamily) {
      mappingIntegrityErrors.push(`${prediction.id}: evidence-family mismatch`);
    }
  }
  const historyOldestAt = all.length ? all[all.length - 1].created.toISOString() : null;
  if (newsIntegrityErrors.length) {
    mappingIntegrityErrors.push(...newsIntegrityErrors);
  }
  const peterMappingCount = Object.values(embeds)
    .filter(embed => embed.evidenceOwner === 'peterxing').length;
  const peterAuthoredCount = Object.values(embeds)
    .filter(embed => embed.evidenceOwner === 'peterxing' && embed.authorship === 'authored').length;
  // X RETIREMENT 2026-08-13 — the sticky-Peter, Peter-authored and reuse-ceiling gates all measured X
  // evidence. Their floors were retired by reviewed manual edit in evidence-floors.json, and a gate
  // compared against a retired floor either throws or passes vacuously. Both readings are wrong, so
  // the gates are removed with the evidence they gated. The currency registrations in that file are
  // untouched and still fail closed.
  /* COVERAGE IS STILL TOTAL, OVER A LARGER OUTCOME SET. This used to require that every prediction
     carry evidence. With X retired, most predictions have no qualifying in-window source and never
     will — some subjects here have no fortnightly news cycle at all. Requiring evidence for all 103
     would fail every build forever; DROPPING the requirement would let a prediction vanish silently,
     which is the failure this file exists to prevent. So the requirement is restated, not relaxed:
     every prediction must be ACCOUNTED FOR — either cited, or explicitly recorded as uncited with
     the window that was searched. A silent gap is still a build failure. */
  const accountedIds = new Set([...currentCoveredIds, ...Object.keys(uncited)]);
  const unaccounted = PREDICTIONS.filter(p => !accountedIds.has(p.id)).map(p => p.id);
  if (unaccounted.length) {
    mappingIntegrityErrors.push(`predictions neither cited nor recorded as uncited: ${unaccounted.join(", ")}`);
  }
  const coverageComplete = mappingIntegrityErrors.length === 0
    && accountedIds.size === PREDICTIONS.length;
  const ownerTally = {};
  const sourceQualityTally = {};
  const evidenceTypeTally = {};
  const mediumTally = { x: 0, news: 0 };
  const peterAuthorshipTally = { authored: 0, reposted: 0 };
  for (const embed of Object.values(embeds)) {
    ownerTally[embed.evidenceOwner] = (ownerTally[embed.evidenceOwner] || 0) + 1;
    sourceQualityTally[embed.sourceQuality] = (sourceQualityTally[embed.sourceQuality] || 0) + 1;
    evidenceTypeTally[embed.evidenceType] = (evidenceTypeTally[embed.evidenceType] || 0) + 1;
    mediumTally[embed.evidenceOwner === 'news' ? 'news' : 'x']++;
    if (embed.evidenceOwner === 'peterxing' && peterAuthorshipTally[embed.authorship] != null) {
      peterAuthorshipTally[embed.authorship]++;
    }
  }
  // X RETIREMENT 2026-08-13 — the gate here asserted that news could never substitute for the Peter
  // floors. Those floors measured @peterxing X activity and were retired by reviewed manual edit, so
  // the rule now has no referent. It is removed rather than left comparing against a retired constant.
  const sourceStatus = sourceStatusFor(source, sourceAttempts);
  /*
   * THE CURRENCY LAYER — additive, and separate from cited evidence.
   *
   * X evidence was retired 2026-08-13. This layer was designed when each prediction carried a reviewed X status as its
   * ORIGIN evidence and currency was a second, subordinate item. There is no origin tier now:
   * a prediction is either CITED by a live-verified article inside the currency window or it is
   * recorded as UNCITED. The currency layer survives as an additive "where things currently
   * stand" reference and still never converts an uncited prediction into a cited one.
   * Coverage is deliberately sparse — a
   * prediction with no genuinely relevant current reference simply gets none, which is a
   * truthful gap rather than a defect to be papered over.
   *
   * The histogram below is COMPUTED from the emitted references, never declared, so it
   * cannot drift away from what is actually published.
   */
  const currency = {};
  const currencyFreshness = { '<=14d': 0, '15-30d': 0, '31-90d': 0, '91-365d': 0, '>1yr': 0 };
  let currencyLinks = 0;
  const currencyNow = Date.now();
  /* AGE-OUT IS A DEMOTION, NOT A FAULT.
   *
   * A currency reference exists to show where the world CURRENTLY stands, so one that has
   * aged past the ceiling has stopped doing its job. That is not evidence of anything wrong
   * with the article — it is still genuine and still says what it said — so it must never be
   * treated like quote drift or a fabricated source, which signal that a citation may no
   * longer support its claim and rightly fail closed.
   *
   * The demotion is applied HERE, at the point of emission, so it is effective rather than
   * advisory: an expired reference simply never reaches signals.json, and the prediction
   * falls back to its reviewed origin evidence standing alone.
   * Dropping it is safe by construction — a currency entry is refused below unless its
   * reviewed origin evidence exists, and currency can never satisfy a coverage gate —
   * so a demotion cannot reduce coverage or breach a gate. The freshness histogram and the
   * link/source counts are computed from what is actually emitted, so they follow automatically.
   */
  const currencyDemoted = [];
  for (const [predictionId, entries] of Object.entries(CURRENCY_MAPPINGS)) {
    // Additive only: refuse to emit a currency reference for a prediction that somehow
    // lacks its reviewed origin evidence, rather than letting it stand alone.
    if (!embeds[predictionId]) continue;
    const rendered = [];
    const demotedHere = [];
    for (const entry of entries) {
      const src = CURRENCY_SOURCES[entry.source];
      if (!src) continue;
      const ageDays = Math.round((currencyNow - new Date(src.publishedAt).getTime()) / 864e5);
      if (ageDays > CURRENCY_MAX_AGE_DAYS) {
        demotedHere.push({ source:entry.source, host:src.publisherHost, ageDays });
        continue;
      }
      /* Day precision, not instant precision: a same-day link cannot be DEMONSTRATED to be later
         than its origin, and an undemonstrable ordering must not be published as a refresh. */
      const originEmbed = embeds[predictionId];
      const originAt = originEmbed.articleDate
        || (originEmbed.provenance && originEmbed.provenance.publishedAt)
        || null;
      const originDay = originAt ? String(originAt).slice(0, 10) : null;
      const entryDay = String(src.publishedAt).slice(0, 10);
      if (originDay && entryDay <= originDay) {
        demotedHere.push({
          source: entry.source, host: src.publisherHost, ageDays,
          reason: 'not-newer-than-origin', originDay, entryDay,
        });
        continue;
      }
      const bucket = ageDays <= 14 ? '<=14d'
        : ageDays <= 30 ? '15-30d'
          : ageDays <= 90 ? '31-90d'
            : ageDays <= 365 ? '91-365d' : '>1yr';
      currencyFreshness[bucket]++;
      currencyLinks++;
      rendered.push({
        key: entry.source,
        url: src.resolvedUrl,
        // og:site_name is sometimes a marketing string; keep the captured value intact and
        // give the UI a short form rather than inventing a cleaner publisher name here.
        publisher: src.publisher,
        publisherShort: String(src.publisher || '').split(' | ')[0].trim(),
        publisherHost: src.publisherHost,
        headline: src.headline,
        author: src.author || '',
        publishedAt: src.publishedAt,
        ageDays,
        freshness: bucket,
        sourceQuality: src.sourceQuality,
        quote: src.quote,
        rationale: entry.rationale,
        provenance: entry.provenance || null,
        reviewedAt: entry.reviewedAt,
        evidenceType: 'currency',
      });
    }
    if (rendered.length) currency[predictionId] = rendered;
    /* A demotion that leaves the prediction with another live reference is routine maintenance.
       One that leaves it with NONE is a coverage regression: the prediction reverts to its origin
       evidence alone and wants a replacement. Same mechanism, different consequence, so reported
       as different things rather than as one undifferentiated list. */
    for (const d of demotedHere) {
      currencyDemoted.push({
        predictionId,
        ...d,
        emptied: rendered.length === 0,
      });
    }
  }
  if (currencyDemoted.length) {
    const emptied = currencyDemoted.filter(d => d.emptied);
    const aged = currencyDemoted.filter(d => d.reason !== 'not-newer-than-origin').length;
    const stale = currencyDemoted.length - aged;
    console.error(`[refresh] currency: ${currencyDemoted.length} reference(s) demoted (publication proceeds; `
      + `the reviewed origin evidence is untouched) — ${aged} past the ${CURRENCY_MAX_AGE_DAYS}-day ceiling, `
      + `${stale} not newer than the origin evidence they would refresh:`);
    currencyDemoted.forEach(d => console.error(
      `[refresh]   ${d.emptied ? 'EMPTIED  ' : 'reduced  '}${d.predictionId}: ${d.source} (${d.host}, ${d.ageDays}d)`
      + (d.reason === 'not-newer-than-origin'
        ? ` — published ${d.entryDay}, origin evidence ${d.originDay}; a currency link must be strictly later to refresh anything`
        : '')
      + (d.emptied ? ' — prediction now has NO current reference; harvest a replacement' : ' — prediction retains another live reference'),
    ));
    if (emptied.length) {
      console.error(`[refresh] currency: ${emptied.length} prediction(s) lost their last current reference — ${[...new Set(emptied.map(d => d.predictionId))].join(', ')}`);
    }
  }
  /* The note must stay literally true about the CURRENT ladder, not a retired one. With the X corpus
     retired there is no preference order left to describe: there is one tier, and the honest thing to
     state alongside it is what happens to the predictions it does NOT cover. */
  const uncitedCount = Object.keys(uncited).length;
  const note = mediumTally.x > 0
    ? `Direct evidence is mixed while the X corpus is retired: ${mediumTally.x} archive-verified X statuses and ${mediumTally.news} live-verified news articles.`
    : `${mediumTally.news} prediction${mediumTally.news === 1 ? ' carries' : 's carry'} one reviewed item of direct evidence: an authoritative news article fetched and quote-checked at publication, labeled direct, scenario or leading-indicator, and recorded with what it does not establish. ${uncitedCount} prediction${uncitedCount === 1 ? ' has' : 's have'} no qualifying source published inside the ${CURRENCY_MAX_AGE_DAYS}-day window and are recorded as uncited rather than evidenced by something weaker. Reuse is restricted to reviewed compatible concept families; a source cited by more than one prediction is counted once.`;
  /* X RETIREMENT 2026-08-13 - newestItemAt meant "the newest harvested @peterxing status". With the
     corpus retired it published as null: a live-freshness field that silently stopped measuring anything
     while still being rendered as freshness. It now means what the site can actually attest - the
     publication date of the most recent source it CITES - computed from the emitted embeds, so it cannot
     drift from what is on the page. Null is reserved for the honest case of citing nothing at all. */
  const citedNewestAt = (() => {
    const dates = Object.values(embeds)
      .map(embed => Date.parse(embed.articleDate || embed.provenance?.publishedAt || ''))
      .filter(value => Number.isFinite(value));
    return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
  })();
  const out = {
    updated: new Date().toISOString(),
    note,
    source,
    sourceStatus,
    sourceAttempts,
    sourceFetchedAt: sourceWhen ? sourceWhen.toISOString() : null,
    sourceFresh,
    newestItemAt: citedNewestAt,
    /* THE UNCITED CHANNEL. Three of the site owner’s own headline subjects - Dyson/Kardashev, mind
       uploading, and the ruliad - have ZERO matches across ~90 days of all 58 harvested feeds. That is a
       property of the world, not of the matcher: they are speculative frameworks with no fortnightly news
       cycle. Suppressing them would make a subject we never covered look identical to a subject we
       searched for and could not source, so the absence is PUBLISHED together with the window searched.
       A blank panel and a suppressed panel look the same; only one of them is honest. */
    uncited: {
      windowDays: CURRENCY_MAX_AGE_DAYS,
      count: Object.keys(uncited).length,
      items: uncited,
    },
    coverage: {
      cited: Object.keys(embeds).length,
      searches: Object.keys(searches).length,
      total: PREDICTIONS.length,
      complete: coverageComplete,
      uniqueSources: directUsesByPost.size,
      maxReuse: maxPostReuseObserved,
      reuseDistribution,
      byEvidenceOwner: ownerTally,
      byEvidenceMedium: mediumTally,
      byPeterAuthorship: peterAuthorshipTally,
      bySourceQuality: sourceQualityTally,
      byEvidenceType: evidenceTypeTally,
      // Additive layer, reported separately so it can never be mistaken for direct coverage.
      currency: {
        predictions: Object.keys(currency).length,
        links: currencyLinks,
        sources: new Set(Object.values(currency).flat().map(c => c.key)).size,
        withoutCurrency: PREDICTIONS.length - Object.keys(currency).length,
        demoted: currencyDemoted.length,
        demotedEmptied: currencyDemoted.filter(d => d.emptied).length,
        maxAgeDays: CURRENCY_MAX_AGE_DAYS,
        freshness: currencyFreshness,
      },
    },
    embeds,
    currency,
    search: {},
    reality,
  };

  const kindTally = {}; const tierTally = {};
  for (const y in embeds) { const e = embeds[y]; kindTally[e.kind] = (kindTally[e.kind] || 0) + 1; tierTally[e.recency] = (tierTally[e.recency] || 0) + 1; }
  const debugPayload = {
    updated: out.updated,
    source,
    sourceStatus,
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
    coveredPredictions: currentCoveredIds.size,
    searchFallbacks: Object.keys(searches).length,
    coverageComplete,
    directCoverageComplete: coverageComplete
      && (Object.keys(embeds).length + Object.keys(uncited).length) === PREDICTIONS.length,
    reviewedApprovals: Object.keys(evidenceApprovals).length,
    reviewedExternalMappings: Object.keys(EXTERNAL_MAPPINGS).length,
    evidenceOwners: ownerTally,
    peterAuthorship: peterAuthorshipTally,
    sourceQuality: sourceQualityTally,
    evidenceTypes: evidenceTypeTally,
    unapprovedCandidateCounts,
    missingDirect: missingCoverage,
    missingCoverage,
    mappingIntegrityErrors,
    maxPostReuseObserved,
    reuseDistribution,
    reuseAudit,
    semanticMaxAgeDays: SEMANTIC_MAX_AGE_DAYS,
    matchablePredictions,
    unmatchedWithCandidates,
    maximumUniqueMatches,
    uniqueMatchedPosts: usedPosts.size,
    directUniquePosts: directUsesByPost.size,
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
    reality: reality.map(r => r.kind === 'none'
      ? `${r.tag}: no qualifying source in window`
      : `${r.tag}: ${r.publisherHost} [${r.recency}] ${r.date} (${r.ageDays}d)`),
    chosen,
    proposedMappings: Object.fromEntries(Object.entries(embeds).map(([predictionId, signal]) => [
      predictionId,
      {
        postId: signal.id,
        author: signal.author,
        kind: signal.kind,
        date: signal.date,
        evidenceFamily: signal.evidenceFamily,
        evidenceOwner: signal.evidenceOwner,
        evidenceType: signal.evidenceType,
        sourceQuality: signal.sourceQuality,
        mappingRationale: signal.mappingRationale,
        reuseFamily: signal.reuseFamily || signal.evidenceFamily,
        matchMethod: signal.matchMethod,
        assignmentMode: signal.assignmentMode,
        matchedConcepts: signal.matchedConcepts,
        text: signal.text,
      },
    ])),
    proposedSearches: {},
  };
  fs.writeFileSync(DBG, JSON.stringify(debugPayload, null, 2) + '\n');

  console.error(`[refresh] Prepared direct coverage ${currentCoveredIds.size}/${PREDICTIONS.length}, using ${directUsesByPost.size} unique sources (max reviewed reuse ${maxPostReuseObserved}) [${Object.entries(ownerTally).map(([k, v]) => v + ' ' + k).join(', ')}] [${Object.entries(matchMethodTally).map(([k, v]) => v + ' ' + k).join(', ')}].`);
  if (!coverageComplete) {
    throw new Error(`direct coverage incomplete (${currentCoveredIds.size}/${PREDICTIONS.length}): ${mappingIntegrityErrors.join('; ')}`);
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.error(`[refresh] Wrote complete direct-only signals.json (${currentCoveredIds.size}/${PREDICTIONS.length}).`);
  /* X RETIREMENT 2026-08-13 — the automatic ratchet WRITER is retired, not the ratchet.
     This writer only ever advanced peterTotal/peterAuthored/maxReuse, which were floors on X
     evidence and were removed from evidence-floors.json by reviewed manual edit when X was
     retired. With nothing left that it owns, an automatic writer could only ever throw or
     overwrite a reviewed registration, so it is removed rather than given new keys to own.
     THE RATCHET MECHANISM IS UNTOUCHED AND STILL GUARDS THE CURRENCY FLOORS: evidence-floors.json
     remains the registration of record, the verifiers still read it and still fail closed, and it
     is now changed ONLY by a reviewed manual edit — which is strictly stronger than a build that
     can rewrite its own gate. Nothing here may be relaxed to make a run pass. */
  console.log(JSON.stringify({
    cited: Object.keys(embeds).length,
    searches: Object.keys(searches).length,
    total: PREDICTIONS.length,
    uniqueSources: directUsesByPost.size,
    maximumUniqueMatches,
    maxReuse: maxPostReuseObserved,
    byEvidenceOwner: ownerTally,
    byPeterAuthorship: peterAuthorshipTally,
    sourceQuality: sourceQualityTally,
    reality: reality.map(r => r.tag),
  }));
}
if (require.main === module) {
  main().catch(err => {
    console.error('[refresh] Fatal:', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  });
}
module.exports = {
  buildPredictions,
  detectConcepts,
  deriveEventTerms,
  hasBoundQuantity,
  normalizeGuardText,
  passesFacetGuards,
  qualifyFamilyPost,
  qualifyPost,
  scorePost,
};
