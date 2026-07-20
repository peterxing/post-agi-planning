// validate-predictions.js — schema + forecast-coherence checks before predictions.json goes live.
// The hourly workflow calls this after any edit. Exits 0 if valid, 1 with a list of problems.
//   node validate-predictions.js [path]
const fs = require('fs');
const path = require('path');
const { validateFamilyCoverage } = require('./evidence-families');
const FILE = process.argv[2] || path.join(__dirname, 'predictions.json');
const DOMAINS = ['individual', 'social', 'technology', 'economic', 'geopolitical', 'governance'];
const EPISTEMIC_LABELS = new Set(['conditional', 'speculative']);
const SIMULATOR_ANCHORS = new Map([
  ['agi', 2026],
  ['ungoverned', 2028],
  ['managed', 2029],
  ['default', 2030],
  ['handoff', 2040],
]);

const problems = [];
const eventRows = [];
let d;
try { d = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, '')); }
catch (e) { console.log('FAIL: not valid JSON — ' + e.message); process.exit(1); }

if (!d || !Array.isArray(d.years) || !d.years.length) { console.log('FAIL: missing non-empty "years" array'); process.exit(1); }
if (!d.updated || isNaN(Date.parse(d.updated))) problems.push('"updated" missing or not an ISO date');
if (typeof d.basis !== 'string' || !d.basis.trim()) problems.push('"basis" missing or empty');

const seen = new Set();
const seenSimulatorAnchors = new Map();
let events = 0;
for (const y of d.years) {
  const tag = 'year ' + (y && y.year);
  if (!y || typeof y.year !== 'number') { problems.push(tag + ': year is not a number'); continue; }
  if (y.year < 2026 || y.year > 2040) problems.push(tag + ': dated timeline must stay within 2026–2040');
  if (seen.has(y.year)) problems.push(tag + ': duplicate year'); seen.add(y.year);
  if (typeof y.summary !== 'string' || !y.summary.trim()) problems.push(tag + ': summary missing/empty');
  if (!Array.isArray(y.events) || !y.events.length) { problems.push(tag + ': events missing/empty'); continue; }
  for (let i = 0; i < y.events.length; i++) {
    const e = y.events[i];
    events++;
    if (!e || typeof e.t !== 'string' || !e.t.trim()) problems.push(tag + ': an event has no title (t)');
    if (!e || !DOMAINS.includes(e.d)) problems.push(tag + ': event "' + (e && e.t) + '" has invalid domain d=' + (e && e.d));
    if (e && e.prob != null && (typeof e.prob !== 'number' || e.prob < 0 || e.prob > 100)) problems.push(tag + ': event "' + e.t + '" prob out of 0–100');
    if (e && e.simAnchor != null) {
      if (!SIMULATOR_ANCHORS.has(e.simAnchor)) {
        problems.push(tag + ': event "' + e.t + '" has unknown simAnchor=' + e.simAnchor);
      } else if (seenSimulatorAnchors.has(e.simAnchor)) {
        problems.push(tag + ': duplicate simAnchor "' + e.simAnchor + '"');
      } else {
        seenSimulatorAnchors.set(e.simAnchor, y.year);
        if (SIMULATOR_ANCHORS.get(e.simAnchor) !== y.year) {
          problems.push(tag + ': simAnchor "' + e.simAnchor + '" must remain in ' + SIMULATOR_ANCHORS.get(e.simAnchor));
        }
        if (!Number.isFinite(e.prob)) problems.push(tag + ': simAnchor "' + e.simAnchor + '" requires a numeric prob');
      }
    }
    if (e && typeof e.t === 'string' && e.t.trim()) eventRows.push({ id: `${y.year}-${i}`, year: y.year, text: e.t.trim() });
  }
  if (y.match) {
    const m = y.match;
    for (const k of ['phrases', 'strong', 'weak']) if (m[k] != null && !Array.isArray(m[k])) problems.push(tag + ': match.' + k + ' must be an array');
    if (m.search != null && typeof m.search !== 'string') problems.push(tag + ': match.search must be a string');
    if (m.headline != null && typeof m.headline !== 'string') problems.push(tag + ': match.headline must be a string');
  }
}
for (const anchor of SIMULATOR_ANCHORS.keys()) {
  if (!seenSimulatorAnchors.has(anchor)) problems.push('missing required probability-simulator simAnchor "' + anchor + '"');
}

function nonEmptyString(v) {
  return typeof v === 'string' && !!v.trim();
}
function validateStringList(value, tag, field) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) {
    problems.push(`${tag}: ${field} must contain 2–4 items`);
    return;
  }
  if (value.some(v => !nonEmptyString(v))) problems.push(`${tag}: ${field} contains an empty/non-string item`);
  if (new Set(value.map(v => String(v).trim().toLowerCase())).size !== value.length) problems.push(`${tag}: ${field} contains duplicates`);
}
function horizonItemText(item) {
  return [item.t, item.caveat, ...(item.dependencies || []), ...(item.indicators || [])].join(' ').toLowerCase();
}

const horizon = d.postSuperintelligence;
if (!horizon || typeof horizon !== 'object' || Array.isArray(horizon)) {
  problems.push('missing "postSuperintelligence" object');
} else {
  if (!nonEmptyString(horizon.title)) problems.push('postSuperintelligence.title missing/empty');
  if (!nonEmptyString(horizon.summary)) problems.push('postSuperintelligence.summary missing/empty');
  const summary = String(horizon.summary || '').toLowerCase();
  if (!/\bundated\b/.test(summary)
      || !/\bconditionalprob\b/.test(summary)
      || !/\baligned superintelligence\b/.test(summary)
      || !/\bnot a probability by 2040\b/.test(summary)
      || !/\bmutually exclusive\b/.test(summary)) {
    problems.push('postSuperintelligence.summary must explain the undated conditionalProb meaning and mutually exclusive branches');
  }
  if (!Array.isArray(horizon.items) || !horizon.items.length) {
    problems.push('postSuperintelligence.items missing/empty');
  } else {
    const horizonIds = new Set();
    for (let i = 0; i < horizon.items.length; i++) {
      const item = horizon.items[i];
      const tag = `horizon item ${i}`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        problems.push(`${tag}: must be an object`);
        continue;
      }
      if (!nonEmptyString(item.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)) problems.push(`${tag}: id must be stable kebab-case`);
      else if (horizonIds.has(item.id)) problems.push(`${tag}: duplicate id "${item.id}"`);
      else horizonIds.add(item.id);
      if (!nonEmptyString(item.t)) problems.push(`${tag}: t missing/empty`);
      if (/\b20(?:2[6-9]|3\d|40)\b/.test(String(item.t || ''))) problems.push(`${tag}: t must remain undated`);
      if (!DOMAINS.includes(item.d)) problems.push(`${tag}: invalid domain d=${item.d}`);
      if (!EPISTEMIC_LABELS.has(item.epistemic)) problems.push(`${tag}: epistemic must be conditional or speculative`);
      if (typeof item.conditionalProb !== 'number' || item.conditionalProb < 0 || item.conditionalProb > 100) {
        problems.push(`${tag}: conditionalProb out of 0–100`);
      }
      validateStringList(item.dependencies, tag, 'dependencies');
      validateStringList(item.indicators, tag, 'indicators');
      if (!nonEmptyString(item.caveat)) problems.push(`${tag}: caveat missing/empty`);
      const match = item.match;
      if (!match || typeof match !== 'object' || Array.isArray(match)) {
        problems.push(`${tag}: match object missing`);
      } else {
        if (!nonEmptyString(match.headline)) problems.push(`${tag}: match.headline missing/empty`);
        if (!nonEmptyString(match.search) || !/\bfrom:peterxing\b/i.test(match.search)) {
          problems.push(`${tag}: match.search must be an honest from:peterxing query`);
        }
        for (const field of ['phrases', 'strong', 'weak']) {
          if (!Array.isArray(match[field]) || match[field].some(v => !nonEmptyString(v))) {
            problems.push(`${tag}: match.${field} must be an array of non-empty strings`);
          }
        }
      }
    }

    const findItem = rx => horizon.items.find(item => rx.test(String(item && item.id || '')) || rx.test(String(item && item.t || '')));
    const implant = findItem(/implantable-neural-symbiosis|implantable neural/i);
    const nonInvasive = findItem(/non-invasive-neural-symbiosis|non-invasive neural/i);
    const uploading = findItem(/whole-brain-emulation|mind uploading/i);
    const dyson = findItem(/proto-dyson|dyson trajectory/i);
    const kardashev = findItem(/kardashev/i);
    const transcension = findItem(/transcension/i);
    const ruliad = findItem(/ruliad/i);
    if (!implant || !/\bbidirectional\b/.test(horizonItemText(implant)) || !/\bsensory restoration\b/.test(horizonItemText(implant))) {
      problems.push('horizon missing distinct implantable bidirectional/sensory neural-symbiosis coverage');
    }
    if (!nonInvasive
        || !/\b(?:eeg|meg|fnirs)\b/.test(horizonItemText(nonInvasive))
        || !/\bendovascular bcis are minimally invasive, not non-invasive\b/.test(horizonItemText(nonInvasive))
        || !/\b(?:semg|muscle).*not bcis\b/.test(horizonItemText(nonInvasive))) {
      problems.push('horizon missing strict genuinely non-invasive neural-interface distinctions');
    }
    if (!uploading
        || !/\bscanning\b/.test(horizonItemText(uploading))
        || !/\bbiochemical\b/.test(horizonItemText(uploading))
        || !/\bfunctional emulation\b/.test(horizonItemText(uploading))
        || !/\bidentity continuity\b/.test(horizonItemText(uploading))
        || !/\bchatbot or digital replica\b/.test(horizonItemText(uploading))) {
      problems.push('horizon missing whole-brain-emulation dependencies and upload/replica/identity distinctions');
    }
    if (!dyson
        || !/\bmining\b/.test(horizonItemText(dyson))
        || !/\bmanufactur/.test(horizonItemText(dyson))
        || !/\bsolar\b/.test(horizonItemText(dyson))
        || !/\bsmall orbital clusters are not a dyson swarm\b/.test(horizonItemText(dyson))) {
      problems.push('horizon missing the gated orbital-compute-to-proto-Dyson trajectory');
    }
    if (!kardashev
        || !/\borders of magnitude\b/.test(horizonItemText(kardashev))
        || !/\benergy-use classification\b/.test(horizonItemText(kardashev))
        || !/\btype i and type ii remain long-horizon\b/.test(horizonItemText(kardashev))) {
      problems.push('horizon missing measurable, non-achievement Kardashev framing');
    }
    if (!transcension
        || !/\binward\b/.test(horizonItemText(transcension))
        || !/\bspeculative\b/.test(horizonItemText(transcension))
        || !/\bno empirical confirmation\b/.test(horizonItemText(transcension))) {
      problems.push('horizon missing speculative, unconfirmed Transcension framing');
    }
    if (!ruliad
        || !/\btestable\b/.test(horizonItemText(ruliad))
        || !/\b(?:computational-metaphysics|foundational-physics)\b/.test(horizonItemText(ruliad))
        || !/\bnot an established physical theory\b/.test(horizonItemText(ruliad))
        || !/\bnot .*simulation to enter\b/.test(horizonItemText(ruliad))) {
      problems.push('horizon missing cautious, testability-gated ruliad framing');
    }
  }
}

const expectedEvidenceIds = [
  ...d.years.flatMap(year => Array.isArray(year.events)
    ? year.events.map((_, index) => `${year.year}-${index}`)
    : []),
  ...(horizon && Array.isArray(horizon.items)
    ? horizon.items.filter(item => item && item.id).map(item => `horizon-${item.id}`)
    : []),
];
const familyCoverage = validateFamilyCoverage(expectedEvidenceIds);
if (familyCoverage.missing.length || familyCoverage.extra.length) {
  problems.push(`evidence-family coverage mismatch (missing: ${familyCoverage.missing.join(', ') || 'none'}; extra: ${familyCoverage.extra.join(', ') || 'none'})`);
}

const STOP = new Set(('the a an and or of to in on for with by from at as is are be becomes become into '
  + 'over under this that these those its their our your major leading roughly about around across every '
  + 'first multiple one at least can could may might').split(/\s+/));
function coreTokens(text) {
  return String(text || '').toLowerCase()
    .replace(/\b(?:managed|ungoverned|default|unpaused)\s+branch\b/g, ' ')
    .replace(/\b(?:by|in)\s+20\d{2}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP.has(w));
}
function branchOf(text) {
  const s = String(text || '').toLowerCase();
  if (/\bmanaged branch\b/.test(s)) return 'managed';
  if (/\b(?:ungoverned|unpaused|default) branch\b|\babsent (?:a sustained slowdown|intervention)\b/.test(s)) return 'unpaused';
  return 'unspecified';
}
function milestoneLevel(text) {
  const s = String(text || '').toLowerCase();
  const vals = [...s.matchAll(/\b(\d{1,3})\s*%/g)].map(m => Number(m[1]));
  if (/\b(?:essentially all|nearly all|almost all)\b/.test(s)) vals.push(99);
  if (/\bmajority\b|\bmore .* than humans\b|\bat least half\b/.test(s)) vals.push(51);
  if (/\bhalf\b/.test(s)) vals.push(50);
  if (/\bone third\b/.test(s)) vals.push(33);
  if (/\bone quarter\b/.test(s)) vals.push(25);
  if (/\bone tenth\b/.test(s)) vals.push(10);
  return vals.length ? Math.max(...vals) : null;
}

// Exact semantic duplicates remain errors even when punctuation, a branch prefix, or a year differs.
const signatures = new Map();
for (const row of eventRows) {
  const sig = coreTokens(row.text).join(' ');
  const prior = signatures.get(sig);
  if (sig && prior) problems.push(`duplicate prediction: ${prior.id} and ${row.id} reduce to "${sig}"`);
  else if (sig) signatures.set(sig, row);
}

// Highly overlapping later events must advance a measurable threshold or state a different branch.
for (let i = 0; i < eventRows.length; i++) {
  const a = eventRows[i]; const as = new Set(coreTokens(a.text));
  for (let j = i + 1; j < eventRows.length; j++) {
    const b = eventRows[j]; const bs = new Set(coreTokens(b.text));
    if (!as.size || !bs.size) continue;
    const shared = [...as].filter(w => bs.has(w)).length;
    const containment = shared / Math.min(as.size, bs.size);
    const jaccard = shared / new Set([...as, ...bs]).size;
    if (containment < 0.86 && jaccard < 0.72) continue;
    const aLevel = milestoneLevel(a.text); const bLevel = milestoneLevel(b.text);
    const advances = aLevel != null && bLevel != null && bLevel > aLevel;
    const branchesDiffer = branchOf(a.text) !== branchOf(b.text)
      && branchOf(a.text) !== 'unspecified' && branchOf(b.text) !== 'unspecified';
    if (!advances && !branchesDiffer) {
      problems.push(`redundant/near-duplicate predictions: ${a.id} and ${b.id} (containment ${containment.toFixed(2)}, Jaccard ${jaccard.toFixed(2)})`);
    }
  }
}

// Known high-impact milestones are easy to restate with different words, so guard their semantic families.
const duplicateFamilies = [
  {
    name: 'trillion-dollar AI valuation',
    test: s => /\b(?:trillion dollar.*valuation|valuation.*trillion dollar|1t valuation)\b/.test(s),
  },
  {
    name: '10x scientific-progress acceleration',
    test: s => /\baccelerat\w* scientific progress\b/.test(s) && /\b10x\b/.test(s),
  },
  {
    name: 'fully automated frontier AI R&D endpoint',
    test: s => /\bai fully automat\w* frontier ai r d\b/.test(s) || /\bai r d is fully automated\b/.test(s),
  },
];
for (const family of duplicateFamilies) {
  const hits = eventRows.filter(r => family.test(r.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ')));
  if (hits.length > 1) problems.push(`duplicate milestone family "${family.name}": ${hits.map(h => h.id).join(', ')}`);
}

// Once the timeline itself predicts full AI-R&D automation, conventional career-reskilling milestones
// are no longer coherent. Later work predictions must describe transition, ownership, or post-work life.
const automationYears = eventRows
  .filter(r => duplicateFamilies[2].test(r.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ')))
  .map(r => r.year);
if (automationYears.length) {
  const pivot = Math.min(...automationYears);
  for (const row of eventRows) {
    const s = row.text.toLowerCase();
    const conventionalCareer = /\b(?:career|careers|reskill|reskilling|job tenure|employability)\b/.test(s);
    const postWork = /\b(?:post work|life after work|rather than employability|meaning|ownership)\b/.test(s);
    if (row.year >= pivot && conventionalCareer && !postWork) {
      problems.push(`chronologically inconsistent after ${pivot} full AI-R&D automation: ${row.id} "${row.text}"`);
    }
  }
}

// A later top-expert milestone after Peter's ungoverned ASI window must identify its alternate branch.
const ungovernedAsi = eventRows.find(r => /\bsuperintelligence emerges\b/i.test(r.text) && /\bungoverned\b/i.test(r.text));
if (ungovernedAsi) {
  for (const row of eventRows) {
    const normalized = row.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ');
    if (row.year <= ungovernedAsi.year || !/\b(?:top expert|top human expert)\b/.test(normalized)) continue;
    if (branchOf(row.text) === 'unspecified') {
      problems.push(`post-ASI top-expert milestone lacks an explicit alternate branch: ${row.id} "${row.text}"`);
    }
  }
}

const horizonCount = Array.isArray(horizon && horizon.items) ? horizon.items.length : 0;
console.log(`predictions.json: ${d.years.length} years, ${events} events, ${horizonCount} horizon items, updated ${d.updated}`);
if (problems.length) { console.log('FAIL (' + problems.length + ' problem(s)):'); problems.forEach(p => console.log('  - ' + p)); process.exit(1); }
console.log('RESULT: PASS — predictions.json is well-formed, non-duplicative, and chronologically coherent.');
