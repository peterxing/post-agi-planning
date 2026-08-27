'use strict';

/*
 * verify-x-signals.js — PROVES THE X TRAJECTORY LAYER CANNOT BECOME EVIDENCE.
 *
 * X evidence was retired in full on 2026-08-13 at the site owner's instruction, and the retirement
 * is enforced by INVERSION across the tree: reinstating X as evidence is what fails now. On
 * 2026-08-26 the owner asked for X back — but to "supplement the prediction evidence ... to
 * indicate the accuracy of its trajectory", which is a proximity claim, not a citation claim.
 *
 * So X returns as a SEPARATE, LABELLED layer and the retirement of X-as-evidence stands. This file
 * is the executable statement of that boundary. Every assertion here exists because the alternative
 * is a site where a tweet and a peer-reviewed paper are rendered by the same code path.
 *
 * WHAT IS ASSERTED:
 *   1. Structural separation — X signals never enter `embeds`, never carry news provenance fields,
 *      and the evidence accounting is untouched by their presence.
 *   2. Tier honesty — TRACKED (passes the 253-fixture matcher) and NEAREST (topical proximity only)
 *      are distinguishable in the data and in the rendered statement, so a proximity match can
 *      never read as a tracking match.
 *   3. The matcher is imported, not reimplemented, so the strict tier cannot silently drift looser.
 *   4. Word-boundary and concept gating hold, pinned to the exact collisions they were built from.
 *   5. Refusal is possible and real — a prediction with no proximate activity gets NO signal.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const xs = require('./x-signals.js');
const { detectConcepts, qualifyPost } = require('./refresh-signals.js');

const failures = [];
const notes = [];
function check(name, fn) {
  try { fn(); notes.push(`PASS  ${name}`); }
  catch (error) { failures.push(`FAIL  ${name}: ${String(error.message || error).split('\n')[0]}`); }
}

const OUT = path.join(__dirname, 'x-signals.json');
const built = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;

/* 1. STRUCTURAL SEPARATION ------------------------------------------------------------------- */

/* Comments are not code. An assertion that greps a whole file will fire on the sentence DESCRIBING
   the invariant, which is exactly what happened on the first run of this suite: the only occurrence
   of "embeds" in x-signals.js is the header line promising never to write there. A gate that fails
   on its own documentation trains the reader to ignore it, so the scan strips comments first. */
function executableSource(file) {
  return fs.readFileSync(path.join(__dirname, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

check('the X layer is never written into the evidence channel', () => {
  const source = executableSource('x-signals.js');
  assert.ok(!/\.embeds\b/.test(source) && !/\bembeds\s*[[=]/.test(source),
    'x-signals.js touches signals.embeds; X must never enter the evidence channel');
  assert.ok(/channel:\s*'x-trajectory-signal'/.test(source),
    'X signals do not declare their own channel, so a consumer cannot tell them apart');
});

check('no X signal carries a news-provenance field', () => {
  if (!built) return;
  const banned = ['evidenceOwner', 'sourceQuality', 'publisher', 'publisherHost', 'verifiedThrough',
    'textSha256', 'quote', 'evidenceType', 'reuseFamily', 'publishedAtSource'];
  for (const [id, signal] of Object.entries(built.signals)) {
    for (const field of banned) {
      assert.ok(!(field in signal),
        `${id} carries news-provenance field "${field}"; a trajectory signal must not look like a citation`);
    }
  }
});

check('the published evidence accounting is unaffected by the X layer', () => {
  const signalsPath = path.join(__dirname, 'signals.json');
  if (!fs.existsSync(signalsPath)) return;
  const signals = JSON.parse(fs.readFileSync(signalsPath, 'utf8'));
  const coverage = signals.coverage || {};
  assert.strictEqual(Number((coverage.byEvidenceMedium || {}).x || 0), 0,
    'coverage.byEvidenceMedium.x is nonzero; X is still barred from the EVIDENCE channel');
  assert.strictEqual(Number((coverage.byEvidenceOwner || {}).peterxing || 0), 0,
    'coverage.byEvidenceOwner.peterxing is nonzero; @peterxing X evidence remains retired');
  for (const [id, embed] of Object.entries(signals.embeds || {})) {
    assert.notStrictEqual(embed.channel, 'x-trajectory-signal',
      `${id}: an X trajectory signal reached signals.embeds`);
    assert.ok(embed.evidenceOwner !== 'peterxing' && embed.evidenceOwner !== 'external',
      `${id}: a retired X evidence owner reappeared in the evidence channel`);
  }
});

/* 2. TIER HONESTY ---------------------------------------------------------------------------- */

check('both tiers exist and are distinguishable in the data', () => {
  if (!built) return;
  const tiers = new Set(Object.values(built.signals).map(s => s.tier));
  for (const tier of tiers) {
    assert.ok(tier === 'tracked' || tier === 'nearest', `unknown tier "${tier}"`);
  }
  assert.ok(built.summary.byTier && typeof built.summary.byTier.tracked === 'number'
    && typeof built.summary.byTier.nearest === 'number',
  'the summary does not report the tier split, so a reader cannot tell how much is mere proximity');
});

check('a NEAREST statement never claims the post tracks the prediction', () => {
  if (!built) return;
  for (const [id, signal] of Object.entries(built.signals)) {
    if (signal.tier !== 'nearest') continue;
    assert.ok(/closest related/i.test(signal.statement),
      `${id}: a NEAREST signal does not describe itself as closest-related activity`);
    assert.ok(!/about the same development/i.test(signal.statement),
      `${id}: a NEAREST signal borrows the TRACKED wording`);
  }
});

check('every signal states it is not evidence', () => {
  if (!built) return;
  for (const [id, signal] of Object.entries(built.signals)) {
    assert.ok(/not evidence/i.test(signal.statement),
      `${id}: the rendered statement does not disclaim evidentiary weight`);
  }
});

/* 3. THE STRICT MATCHER IS IMPORTED ----------------------------------------------------------- */

check('the strict tier imports the shared matcher rather than reimplementing it', () => {
  const source = executableSource('x-signals.js');
  assert.ok(/require\('\.\/refresh-signals\.js'\)/.test(source),
    'x-signals.js does not import the shared matcher');
  assert.ok(/qualifyPost\(/.test(source), 'x-signals.js does not call qualifyPost');
  assert.ok(!/function\s+qualifyPost\s*\(/.test(source),
    'x-signals.js defines its own qualifyPost; the strict tier must not drift from the 253 fixtures');
});

/* A BEHAVIOURAL CHECK, NOT A TEXT PATTERN. The first version of this assertion matched source text
   between the facet branch and its `continue`, which is brittle in exactly the way that has already
   caused a false failure in this tree (the discovery-ceiling assertion, 2026-08-24). Here the rule
   is exercised: a post the guards actively refuse for a prediction must not appear in that
   prediction's NEAREST list either. */
check('a facet-guard refusal is never demoted into the NEAREST tier', () => {
  if (!built) return;
  const cachePath = path.join('C:/Users/peterxing/pap-secrets', 'x-signal-cache.json');
  if (!fs.existsSync(cachePath)) return;
  const items = JSON.parse(fs.readFileSync(cachePath, 'utf8')).items || [];
  const targets = xs.buildTargets();
  let exercised = 0;
  for (const target of targets.slice(0, 12)) {
    const shape = xs.matcherShape(target);
    const signal = built.signals[target.id];
    if (!signal || signal.tier !== 'nearest') continue;
    const item = items.find(i => i.id === signal.id);
    if (!item) continue;
    const verdict = qualifyPost(item.text, shape, signal.ageDays);
    assert.notStrictEqual(verdict.reason, 'facet',
      `${target.id}: a post the facet guards actively refused was published as its NEAREST signal`);
    exercised++;
  }
  assert.ok(exercised > 0 || !Object.values(built.signals).some(s => s.tier === 'nearest'),
    'the probe never ran against a NEAREST signal, so it established nothing');
});

/* 4. WORD-BOUNDARY AND CONCEPT GATING --------------------------------------------------------- */

/* Pinned to the collisions measured while building this layer. They fall into TWO classes and the
   distinction matters, because only one of them is a matching bug:
     SUFFIX ACCIDENTS — the term is not a word in the post at all ("favor" inside "favorite",
       "whole" inside "@wholemars"). These are fixed by bounding both ends of the term.
     TRUE HOMONYMS — the term IS a word in the post, in a different sense ("stem cells" vs. STEM
       compression; a humanoid "crossed a line" vs. cross-border wealth; a solar farm's "annual
       output" vs. annual alignment spending). No lexical rule can separate these, which is the
       entire reason the concept gate exists and is asserted separately below. */
const SUFFIX_ACCIDENTS = [
  { term: 'favor', text: 'the biggest Humanoid Olympics yet: my favorite moments' },
  { term: 'whole', text: 'starlink cybermesh — @wholemars wait a minute' },
];
const TRUE_HOMONYMS = [
  { term: 'stem', text: 'we have generated the first early human eggs derived from stem cells' },
  { term: 'cross', text: 'a humanoid just crossed a line humans have never broken' },
  { term: 'annual', text: 'our drones clear clouds over solar farms to increase their annual output' },
];

check('an auto-derived term cannot match inside a longer word', () => {
  for (const { term, text } of SUFFIX_ACCIDENTS) {
    assert.strictEqual(xs.containsTerm(text.toLowerCase(), term), false,
      `"${term}" still matches inside a longer word in: ${text.slice(0, 60)}`);
  }
});

check('a true homonym is admitted lexically and must be caught by the concept gate', () => {
  for (const { term, text } of TRUE_HOMONYMS) {
    assert.strictEqual(xs.containsTerm(text.toLowerCase(), term), true,
      `"${term}" no longer matches as a word in: ${text.slice(0, 60)} — the boundary rule has `
      + 'over-tightened and is now rejecting genuine words');
  }
});

check('ordinary inflections still match', () => {
  assert.strictEqual(xs.containsTerm('robots are deployed in factories', 'robot'), true,
    'a plural inflection stopped matching');
  assert.strictEqual(xs.containsTerm('the model was deployed last week', 'deploy'), true,
    'a -ed inflection stopped matching');
  assert.strictEqual(xs.containsTerm('compute scaling is accelerating', 'compute'), true,
    'an exact term stopped matching');
});

check('proximity requires a shared distinctive concept, not shared words', () => {
  const stemCells = detectConcepts('we have generated the first early human eggs derived from stem cells');
  const transcension = detectConcepts('An inward transcension branch could favor extreme STEM compression, '
    + 'miniaturization and computational density over outward expansion');
  const shared = [...new Set(stemCells || [])].filter(c => new Set(transcension || []).has(c));
  assert.strictEqual(shared.length, 0,
    `the stem-cell post shares concepts ${JSON.stringify(shared)} with the transcension branch; `
    + 'the concept gate would admit it');
});

/* 5. REFUSAL IS REAL -------------------------------------------------------------------------- */

check('a prediction with no proximate activity receives no signal', () => {
  if (!built) return;
  assert.ok(Array.isArray(built.summary.unmatchedIds),
    'the summary does not name unmatched predictions, so a gap cannot be audited');
  assert.ok(built.summary.unmatched > 0,
    'every single prediction matched. That is possible, but it is far more likely that the '
    + 'proximity bar has gone slack — a corpus of AI posts should not be close to Kardashev-scale '
    + 'energy, the ruliad AND whole-brain emulation. Investigate before accepting.');
  assert.strictEqual(built.summary.matched + built.summary.unmatched, built.summary.predictions,
    'matched + unmatched does not equal the prediction count; the roster is incomplete');
});

check('post reuse is bounded and reported', () => {
  if (!built) return;
  assert.ok(built.summary.observedMaxReuse <= built.summary.maxReuse,
    `observed reuse ${built.summary.observedMaxReuse} exceeds the declared ceiling ${built.summary.maxReuse}`);
  const counts = new Map();
  for (const signal of Object.values(built.signals)) {
    counts.set(signal.id, (counts.get(signal.id) || 0) + 1);
  }
  const worst = Math.max(0, ...counts.values());
  assert.ok(worst <= built.summary.maxReuse,
    `a post is reused ${worst} times, above the ceiling ${built.summary.maxReuse}`);
});

check('capability limits are recorded rather than hidden', () => {
  if (!built) return;
  const caps = built.summary.caps || {};
  assert.ok(caps.authContext, 'the harvest does not record which auth context it used');
  assert.ok('likes' in caps && 'bookmarks' in caps,
    'likes/bookmarks availability is unrecorded, so an unavailable source looks like an empty one');
  assert.ok(caps.likesBookmarksNote && /user context/i.test(caps.likesBookmarksNote),
    'the reason likes and bookmarks are absent is not stated');
});

for (const note of notes) console.log(note);
for (const failure of failures) console.error(failure);
if (failures.length) {
  console.error(`RESULT: FAIL (${failures.length} of ${failures.length + notes.length} X-layer assertions)`);
  process.exit(1);
}
console.log(`RESULT: PASS (${notes.length} X-layer assertions — X supplements the forecast and cannot become evidence)`);
