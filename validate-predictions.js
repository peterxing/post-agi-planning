// validate-predictions.js — sanity-check predictions.json before it goes live. Run after any edit
// (the daily workflow calls this). Exits 0 if valid, 1 with a list of problems otherwise.
//   node validate-predictions.js [path]
const fs = require('fs');
const path = require('path');
const FILE = process.argv[2] || path.join(__dirname, 'predictions.json');
const DOMAINS = ['individual', 'social', 'technology', 'economic', 'geopolitical', 'governance'];

const problems = [];
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
  for (const e of y.events) {
    events++;
    if (!e || typeof e.t !== 'string' || !e.t.trim()) problems.push(tag + ': an event has no title (t)');
    if (!e || !DOMAINS.includes(e.d)) problems.push(tag + ': event "' + (e && e.t) + '" has invalid domain d=' + (e && e.d));
    if (e && e.prob != null && (typeof e.prob !== 'number' || e.prob < 0 || e.prob > 100)) problems.push(tag + ': event "' + e.t + '" prob out of 0–100');
  }
  if (y.match) {
    const m = y.match;
    for (const k of ['phrases', 'strong', 'weak']) if (m[k] != null && !Array.isArray(m[k])) problems.push(tag + ': match.' + k + ' must be an array');
    if (m.search != null && typeof m.search !== 'string') problems.push(tag + ': match.search must be a string');
    if (m.headline != null && typeof m.headline !== 'string') problems.push(tag + ': match.headline must be a string');
  }
}

console.log(`predictions.json: ${d.years.length} years, ${events} events, updated ${d.updated}`);
if (problems.length) { console.log('FAIL (' + problems.length + ' problem(s)):'); problems.forEach(p => console.log('  - ' + p)); process.exit(1); }
console.log('RESULT: PASS — predictions.json is well-formed.');
