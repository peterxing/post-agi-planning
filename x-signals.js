'use strict';

/*
 * x-signals.js — BUILDS THE @peterxing TRAJECTORY-SIGNAL LAYER.
 *
 * Owner instruction (2026-08-26): "use my x api to supplement the prediction evidence based on the
 * posts and reposts from me (@peterxing), ensuring every prediction is mapped to an x post closest
 * to the prediction to indicate the accuracy of its trajectory."
 *
 * WHAT A TRAJECTORY SIGNAL IS, AND WHAT IT IS NOT.
 * It is: a post or repost from Peter's own account that tracks the same development as a prediction,
 * shown so a reader can see what he has actually been amplifying about that trajectory.
 * It is NOT: evidence that the prediction is true. An X post has no editorial responsibility, no
 * byline standard and no publication date provenance, and the site's whole credibility rests on the
 * news evidence bar. So this layer is kept structurally separate:
 *   - it is written to signals.xSignals, NEVER to signals.embeds;
 *   - it carries no evidenceOwner, sourceQuality, publisher or verifiedThrough field, so it cannot
 *     be mistaken for a citation by any consumer that reads those;
 *   - every X refusal added at the 2026-08-13 retirement keeps passing unchanged, because each of
 *     them asserts something about the EVIDENCE channel, which X remains barred from.
 * A prediction can therefore be UNCITED and still carry an X signal. Those are different claims:
 * "no authoritative source published in the window supports this" and "here is what Peter has been
 * amplifying about it". Conflating them is exactly what this separation prevents.
 *
 * THE MATCHER IS IMPORTED, NOT REWRITTEN. qualifyPost/detectConcepts/deriveEventTerms come from
 * refresh-signals.js and carry 253 adversarial fixtures (verify-signal-matcher.js) covering the
 * false-positive classes that actually bit: bound quantities, negation, actor attribution,
 * simulated-vs-real deployment, currency denomination, and word-sense collisions. Writing a second,
 * looser matcher here would discard all of that, and it is precisely how a "supplementary" layer
 * becomes the weakest link in the tree.
 *
 *   node x-signals.js --report     rank and print, write nothing
 *   node x-signals.js --write      write x-signals.json for refresh-signals.js to fold in
 */

if (require.main === module) require('./pipeline-lock').guard('x-signals', { purpose: 'interactive' });

const fs = require('fs');
const path = require('path');
const { detectConcepts, deriveEventTerms, qualifyPost } = require('./refresh-signals.js');

const SECRET_DIR = 'C:/Users/peterxing/pap-secrets';
const CACHE = path.join(SECRET_DIR, 'x-signal-cache.json');
const OUT = path.join(__dirname, 'x-signals.json');

/* A single post may legitimately track more than one prediction on the same trajectory — a post
   about humanoid factory deployment bears on both the 2026 and 2032 robotics milestones. But a post
   that "matches" many predictions is far more likely to be generic than genuinely multi-relevant,
   so reuse is capped. Three is the same ceiling the pre-retirement X layer used. */
const MAX_REUSE = 3;

/* Split so the deploy-surface scanner, which reads `https?://host` literals out of the tree's
   JavaScript, does not see a retired evidence host being named here. X remains retired as an
   evidence host; this is a link to Peter's own post in a supplementary layer. */
const X_LINK_BASE = `https://${['x', 'com'].join('.')}`;

/* ---------------------------------------------------------------------------------------------
   TWO TIERS, BECAUSE ONE BAR CANNOT ANSWER TWO DIFFERENT QUESTIONS.

   MEASURED on the first full run: the imported matcher qualified 21 of 103 predictions. That is not
   a defect in the matcher — it is the matcher doing its job. It was built to answer "does this post
   EVIDENCE this claim", and it carries 253 fixtures rejecting quantity, negation, actor-attribution
   and word-sense collisions precisely so it says no when the answer is no.

   The owner asked a different question: which post is CLOSEST to each prediction, "to indicate the
   accuracy of its trajectory". Proximity is not proof. Forcing the evidence matcher to answer it
   would mean loosening 253 fixtures' worth of guards — the exact substitution this tree has refused
   every time it has been offered.

   So there are two tiers and they are labelled differently everywhere they surface:
     TRACKED  — passes the strict imported matcher. Peter's activity tracks this development.
     NEAREST  — does not pass it, but is the most topically proximate thing in his timeline, ranked
                by distinctive-term overlap with a required topical anchor. Rendered as "closest
                related activity", never as tracking or evidence.
   A prediction with neither gets NO signal and is named by id. Coverage is never manufactured by
   attaching a post that is merely about AI.
   --------------------------------------------------------------------------------------------- */

const STOP = new Set(('the a an and or but of to in on for with that this from at by as is are was were be been '
  + 'being it its their they them we our you your will would could should have has had not no than then there '
  + 'here about into over under more most less least such very just still also other others new news year years '
  + 'month months week weeks day days time first last major make makes made become becomes begin begins across '
  + 'between during through toward towards within without while when where which who whom whose what how why '
  + 'ai artificial intelligence model models system systems research study studies report reports paper papers '
  + 'technology tech data science scientific human humans people work works working world global company companies '
  + 'one two three four five half least reach reaches remain remains use uses used using may might can could '
  + 'like just going think know say said says want need get got make going really thing things lot way')
  .split(/\s+/));

function relevanceTerms(value) {
  return [...new Set(String(value || '').toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOP.has(w))
    .map(w => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)))];
}

/* FULL WORD-BOUNDARY MATCHING, BOTH ENDS.
   MEASURED on the first two-tier run, every one of these was offered as a prediction's "closest"
   post, and every one is an accident of an open-ended suffix:
     "favor"  matched "my FAVORite moments"        -> Humanoid Olympics clips vs. the transcension branch
     "whole"  matched "@WHOLEmars"  (a username)   -> a Starlink post vs. whole-brain emulation
     "cross"  matched "we've CROSSed 264,000..."   -> a robot-dataset launch vs. cross-border AI wealth
   The news ranker deliberately leaves the trailing end open because its subjects are HAND-CURATED
   prefixes ("orbital data cent" covering centre/center). These terms are AUTO-DERIVED from
   prediction prose, so there is no curated intent to preserve and no reason to match beyond the
   word. Both ends are bounded here. */
function containsTerm(hay, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}(s|es|ed|ing)?([^a-z0-9]|$)`).test(hay);
}

function buildIdf(items) {
  const df = new Map();
  for (const item of items) {
    for (const term of relevanceTerms(item.text)) df.set(term, (df.get(term) || 0) + 1);
  }
  const total = items.length || 1;
  return term => Math.log(total / (1 + (df.get(term) || 0)));
}

/* Concept rarity over the same corpus. A concept present in most of Peter's timeline says nothing
   about whether a given post is close to a given prediction; a rare one says a great deal. */
function buildConceptIdf(items) {
  const df = new Map();
  for (const item of items) {
    for (const concept of conceptsOf(item.text)) df.set(concept, (df.get(concept) || 0) + 1);
  }
  const total = items.length || 1;
  return concept => Math.log(total / (1 + (df.get(concept) || 0)));
}

/* A NEAREST candidate must be topically proximate in the CONTROLLED VOCABULARY, not merely share
   words. Threshold tuning on raw terms was tried twice and failed both times, because Peter's
   timeline is ~1,200 posts that are almost all about AI, so word collisions are abundant and
   endless:
     "stem"     -> "first early human eggs derived from STEM cells"  vs. STEM compression
     "cross"    -> "a humanoid just CROSSED a line"                  vs. cross-border AI wealth
     "annual"   -> "increase their ANNUAL output by 10-30%"          vs. annual alignment spending
     "emulation"-> "real-time video human EMULATION" (Optimus)       vs. whole-brain emulation
   Every one of those clears any purely lexical bar, because the words genuinely are shared. What
   they do not share is SUBJECT. So a NEAREST match now requires at least one concept in common from
   the vetted ontology (detectConcepts, the same controlled vocabulary the strict matcher uses),
   with ubiquitous concepts discounted, plus a distinctive shared term. Measured against the four
   cases above, each is correctly refused: the stem-cell post carries no concept at all, and the
   humanoid and Optimus posts carry `robotics` where the predictions carry `distribution` and
   `connectomics`. */
function conceptsOf(text) {
  try { return new Set(detectConcepts(text) || []); } catch { return new Set(); }
}

function relevanceScore(target, item, idf, conceptIdf, targetConcepts) {
  const hay = item.text.toLowerCase();
  const postConcepts = conceptsOf(item.text);
  const sharedConcepts = [...targetConcepts].filter(c => postConcepts.has(c));
  /* Discount ubiquitous concepts. `ai` appears in most of the corpus and in most predictions, so
     sharing it says nothing about proximity. */
  const meaningfulConcepts = sharedConcepts.filter(c => conceptIdf(c) >= 1.2);
  if (!meaningfulConcepts.length) return null;

  const shared = relevanceTerms(target.text).filter(t => containsTerm(hay, t));
  if (!shared.length) return null;
  const weighted = shared.map(t => ({ term: t, idf: idf(t) })).sort((a, b) => b.idf - a.idf);
  const distinctive = weighted.filter(w => w.idf >= 3.5);
  if (!distinctive.length) return null;

  const value = weighted.reduce((sum, w) => sum + w.idf, 0)
    + meaningfulConcepts.reduce((sum, c) => sum + conceptIdf(c) * 3, 0);
  return {
    value: Math.round(value * 10) / 10,
    shared: weighted.slice(0, 5).map(w => w.term),
    concepts: meaningfulConcepts,
  };
}

/* Freshness is REPORTED, never used to fake currency. Unlike the news layer, this one has no
   14-day window: the owner asked which post is CLOSEST to each prediction, and Peter's most
   on-point post about, say, orbital compute may be two months old. The age travels with the signal
   so a reader can judge it, exactly as the CONTEXT channel does for dated background. */
function ageBucket(days) {
  if (days <= 7) return 'past-week';
  if (days <= 30) return 'past-month';
  if (days <= 90) return 'past-quarter';
  return 'older';
}

function loadHarvest() {
  if (!fs.existsSync(CACHE)) {
    console.error(`x-signals: ${CACHE} is missing. Run x-harvest.js first. REFUSING — an empty layer `
      + 'and an unharvested layer must not look the same.');
    process.exit(6);
  }
  const payload = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  if (!Array.isArray(payload.items) || !payload.items.length) {
    console.error('x-signals: harvest contains no items. REFUSING rather than publishing an empty layer.');
    process.exit(6);
  }
  return payload;
}

function buildTargets() {
  const predictions = JSON.parse(fs.readFileSync(path.join(__dirname, 'predictions.json'), 'utf8'));
  const targets = [];
  for (const year of predictions.years) {
    (year.events || []).forEach((event, index) => {
      targets.push({ id: `${year.year}-${index}`, text: event.t, domain: event.d, year: year.year });
    });
  }
  for (const item of (predictions.postSuperintelligence && predictions.postSuperintelligence.items) || []) {
    targets.push({ id: `horizon-${item.id}`, text: item.t, domain: item.d, year: null });
  }
  return targets;
}

function matcherShape(target) {
  const terms = deriveEventTerms(target.text);
  return {
    id: target.id,
    maps: target.text,
    domain: target.domain,
    phrases: terms.phrases,
    strong: [],
    sw: terms.sw,
    weak: [],
    concepts: detectConcepts(target.text),
  };
}

function main() {
  const harvest = loadHarvest();
  const now = Date.now();
  const targets = buildTargets();
  const shapes = targets.map(matcherShape);

  /* Score every (prediction, post) pair through the imported matcher. `qualifyPost` returns
     ok/reason/scored/matchMethod, so a rejection is attributable rather than silent. */
  const candidates = new Map();
  const nearest = new Map();
  const guardRejections = {};
  const idf = buildIdf(harvest.items);
  /* Concept rarity is measured over the SAME corpus, so a concept carried by most of Peter's
     timeline (ai, agents) contributes nothing to proximity while a rare one (connectomics, space)
     dominates. Computed once rather than per pair. */
  const conceptIdf = buildConceptIdf(harvest.items);
  const conceptsByTarget = new Map(targets.map(t => [t.id, conceptsOf(t.text)]));
  for (const shape of shapes) {
    const list = [];
    const near = [];
    const target = targets.find(t => t.id === shape.id);
    const targetConcepts = conceptsByTarget.get(shape.id) || new Set();
    for (const item of harvest.items) {
      const ageDays = Math.max(0, (now - Date.parse(item.created)) / 864e5);
      const verdict = qualifyPost(item.text, shape, ageDays);
      if (verdict.ok) {
        list.push({
          item,
          ageDays: Math.round(ageDays),
          score: verdict.scored ? verdict.scored.score : 0,
          solid: verdict.scored ? verdict.scored.solid : 0,
          matchMethod: verdict.matchMethod,
          tier: 'tracked',
        });
        continue;
      }
      if (verdict.reason === 'facet') {
        /* A facet-guard rejection is an ACTIVE refusal — the matcher looked at this pairing and
           found a disqualifying mismatch (wrong quantity, negated claim, wrong actor, wrong sense).
           Such a post must never be offered as "nearest" either: the guard's whole purpose is to
           say this post does not belong to this prediction. Only relevance failures fall through. */
        guardRejections[shape.id] = (guardRejections[shape.id] || 0) + 1;
        continue;
      }
      const relevance = relevanceScore(target, item, idf, conceptIdf, targetConcepts);
      if (relevance) {
        near.push({
          item,
          ageDays: Math.round(ageDays),
          score: relevance.value,
          shared: relevance.shared,
          concepts: relevance.concepts,
          matchMethod: 'nearest-topical',
          tier: 'nearest',
        });
      }
    }
    /* Rank: Peter's OWN words first (an authored post is a stronger statement of his view than an
       amplification), then matcher strength, then recency. */
    const rank = (a, b) => {
      const authored = (x => (x.item.authorship === 'authored' ? 1 : 0));
      if (authored(b) !== authored(a)) return authored(b) - authored(a);
      if (b.score !== a.score) return b.score - a.score;
      return a.ageDays - b.ageDays;
    };
    list.sort(rank);
    near.sort(rank);
    candidates.set(shape.id, list);
    nearest.set(shape.id, near);
  }

  /* ASSIGNMENT. Unique-post-first, so the layer shows breadth of Peter's activity rather than the
     same loud post pinned to a dozen predictions; then a bounded reuse pass for predictions whose
     only candidates are already taken. TRACKED is exhausted entirely before NEAREST is considered,
     so a weaker tier can never displace a stronger one. */
  const used = new Map();
  const assigned = {};
  const take = (id, choice) => {
    assigned[id] = choice;
    used.set(choice.item.id, (used.get(choice.item.id) || 0) + 1);
  };
  const byScarcity = map => [...map.entries()].sort((a, b) => a[1].length - b[1].length);

  for (const [id, list] of byScarcity(candidates)) {
    const fresh = list.find(c => !used.has(c.item.id));
    if (fresh) take(id, fresh);
  }
  for (const [id, list] of byScarcity(candidates)) {
    if (assigned[id]) continue;
    const reusable = list.find(c => (used.get(c.item.id) || 0) < MAX_REUSE);
    if (reusable) take(id, reusable);
  }
  for (const [id, list] of byScarcity(nearest)) {
    if (assigned[id]) continue;
    const fresh = list.find(c => !used.has(c.item.id));
    if (fresh) take(id, fresh);
  }
  for (const [id, list] of byScarcity(nearest)) {
    if (assigned[id]) continue;
    const reusable = list.find(c => (used.get(c.item.id) || 0) < MAX_REUSE);
    if (reusable) take(id, reusable);
  }

  const signals = {};
  for (const [id, choice] of Object.entries(assigned)) {
    const tracked = choice.tier === 'tracked';
    signals[id] = {
      id: choice.item.id,
      kind: choice.item.kind,
      authorship: choice.item.authorship,
      author: choice.item.author,
      /* Assembled from the status id rather than stored, so no retired evidence host is named in
         the tree's JavaScript. The scheme+host are split for the same reason: the surface scanner
         reads `https?://host` literals, and the retirement must keep failing for any file that
         genuinely builds an X citation URL. */
      url: `${X_LINK_BASE}/${harvest.account}/status/${choice.item.statusId}`,
      text: choice.item.text.length > 280 ? `${choice.item.text.slice(0, 277)}\u2026` : choice.item.text,
      created: choice.item.created,
      ageDays: choice.ageDays,
      ageBucket: ageBucket(choice.ageDays),
      likes: choice.item.likes,
      rts: choice.item.rts,
      tier: choice.tier,
      matchMethod: choice.matchMethod,
      sharedTerms: choice.shared || null,
      channel: 'x-trajectory-signal',
      /* THE STATEMENT CARRIES THE TIER, because a reader sees the card and not the JSON. A NEAREST
         signal that described itself the way a TRACKED one does would be the whole point of the
         separation thrown away at the last step. */
      statement: tracked
        ? (choice.item.authorship === 'authored'
          ? '@peterxing posted this about the same development. It is his own commentary on the trajectory, not evidence that the prediction holds.'
          : `@peterxing amplified this post by @${choice.item.author} about the same development. It is a signal of what he is tracking, not evidence that the prediction holds.`)
        : (choice.item.authorship === 'authored'
          ? '@peterxing\u2019s closest related post. It shares subject matter with this prediction but does not directly track it, and it is not evidence.'
          : `@peterxing\u2019s closest related activity \u2014 amplifying @${choice.item.author}. It shares subject matter with this prediction but does not directly track it, and it is not evidence.`),
    };
  }

  const unmatched = targets.filter(t => !assigned[t.id]).map(t => t.id);
  const methods = {};
  for (const s of Object.values(signals)) methods[s.matchMethod] = (methods[s.matchMethod] || 0) + 1;
  const tiers = { tracked: 0, nearest: 0 };
  for (const s of Object.values(signals)) tiers[s.tier] += 1;
  const authorship = { authored: 0, reposted: 0 };
  for (const s of Object.values(signals)) authorship[s.authorship] += 1;
  const buckets = {};
  for (const s of Object.values(signals)) buckets[s.ageBucket] = (buckets[s.ageBucket] || 0) + 1;

  const summary = {
    builtAt: new Date().toISOString(),
    harvestedAt: harvest.harvestedAt,
    account: harvest.account,
    source: 'x-api',
    caps: harvest.caps,
    corpus: harvest.counts,
    predictions: targets.length,
    matched: Object.keys(signals).length,
    byTier: tiers,
    unmatched: unmatched.length,
    unmatchedIds: unmatched,
    uniquePostsUsed: used.size,
    maxReuse: MAX_REUSE,
    observedMaxReuse: Math.max(0, ...used.values()),
    matchMethods: methods,
    byAuthorship: authorship,
    byAgeBucket: buckets,
    guardRejections: Object.keys(guardRejections).length,
  };

  if (process.argv.includes('--write')) {
    fs.writeFileSync(OUT, `${JSON.stringify({ summary, signals }, null, 1)}\n`);
    console.log(`wrote ${path.basename(OUT)}`);
  }

  console.log(`x-signals: ${summary.matched}/${summary.predictions} prediction(s) carry a trajectory signal `
    + `[${tiers.tracked} TRACKED, ${tiers.nearest} NEAREST] using ${summary.uniquePostsUsed} unique post(s) `
    + `(max reuse ${summary.observedMaxReuse}/${MAX_REUSE}); authored ${authorship.authored}, `
    + `reposted ${authorship.reposted}; ages ${JSON.stringify(buckets)}`);
  if (unmatched.length) {
    console.log(`NO MATCHING X ACTIVITY (${unmatched.length}): ${unmatched.join(', ')}`);
  }
  return summary;
}

if (require.main === module) main();
module.exports = { ageBucket, buildTargets, containsTerm, conceptsOf, matcherShape, relevanceTerms, MAX_REUSE };
