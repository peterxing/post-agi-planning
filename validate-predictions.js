// validate-predictions.js — schema + forecast-coherence checks before predictions.json goes live.
// The hourly workflow calls this after any edit. Exits 0 if valid, 1 with a list of problems.
//   node validate-predictions.js [path]
const fs = require('fs');
const path = require('path');
const FILE = process.argv[2] || path.join(__dirname, 'predictions.json');
const DOMAINS = ['individual', 'social', 'technology', 'economic', 'geopolitical', 'governance'];

const problems = [];
const eventRows = [];
let d;
try { d = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, '')); }
catch (e) { console.log('FAIL: not valid JSON — ' + e.message); process.exit(1); }

if (!d || !Array.isArray(d.years) || !d.years.length) { console.log('FAIL: missing non-empty "years" array'); process.exit(1); }
if (!d.updated || isNaN(Date.parse(d.updated))) problems.push('"updated" missing or not an ISO date');

const seen = new Set();
let events = 0;
for (const y of d.years) {
  const tag = 'year ' + (y && y.year);
  if (!y || typeof y.year !== 'number') { problems.push(tag + ': year is not a number'); continue; }
  if (y.year < 2025 || y.year > 2100) problems.push(tag + ': year out of plausible range');
  if (seen.has(y.year)) problems.push(tag + ': duplicate year'); seen.add(y.year);
  if (typeof y.summary !== 'string' || !y.summary.trim()) problems.push(tag + ': summary missing/empty');
  if (!Array.isArray(y.events) || !y.events.length) { problems.push(tag + ': events missing/empty'); continue; }
  for (let i = 0; i < y.events.length; i++) {
    const e = y.events[i];
    events++;
    if (!e || typeof e.t !== 'string' || !e.t.trim()) problems.push(tag + ': an event has no title (t)');
    if (!e || !DOMAINS.includes(e.d)) problems.push(tag + ': event "' + (e && e.t) + '" has invalid domain d=' + (e && e.d));
    if (e && e.prob != null && (typeof e.prob !== 'number' || e.prob < 0 || e.prob > 100)) problems.push(tag + ': event "' + e.t + '" prob out of 0–100');
    if (e && typeof e.t === 'string' && e.t.trim()) eventRows.push({ id: `${y.year}-${i}`, year: y.year, text: e.t.trim() });
  }
  if (y.match) {
    const m = y.match;
    for (const k of ['phrases', 'strong', 'weak']) if (m[k] != null && !Array.isArray(m[k])) problems.push(tag + ': match.' + k + ' must be an array');
    if (m.search != null && typeof m.search !== 'string') problems.push(tag + ': match.search must be a string');
    if (m.headline != null && typeof m.headline !== 'string') problems.push(tag + ': match.headline must be a string');
  }
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

console.log(`predictions.json: ${d.years.length} years, ${events} events, updated ${d.updated}`);
if (problems.length) { console.log('FAIL (' + problems.length + ' problem(s)):'); problems.forEach(p => console.log('  - ' + p)); process.exit(1); }
console.log('RESULT: PASS — predictions.json is well-formed, non-duplicative, and chronologically coherent.');
