'use strict';

// Concurrency interlock: claim the tree before reading predictions/signals/approvals/floors.
if (require.main === module) require('./pipeline-lock').guard('verify:coverage');

const fs = require('fs');
const path = require('path');

/* Read BEFORE the sibling requires below, deliberately. refresh-signals.js parses this same file at
   MODULE SCOPE, so requiring it first made the refusal here dead on arrival: measured against
   83495FEE2DF739B2, this message printed in 0 of 2 rows built to trigger it while the run exited 76
   from inside the import. A guard's reachability is part of the guard, and "does it fail closed" and
   "does THIS line ever execute" are different questions. Reading first also makes this the FIRST
   reader rather than a later one, so the integer assertion is duplicated here rather than inherited —
   moving a read earlier re-aims every control that used to run before it, and the reader this now
   displaces was the stricter of the two. */
const ratchet = (() => {
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'evidence-floors.json'), 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    console.error(`RESULT: FAIL — evidence-floors.json could not be read as JSON (${error.message}). The evidence `
      + 'ratchet is a gate, not a hint: refusing rather than falling back to the baselines it exists to raise.');
    process.exit(1);
  }
// X RETIREMENT 2026-08-13 — same inversion as the other two read-sites: absence is the intended
// state and reinstatement is the failure. Number.isInteger(undefined) is false, so the original
// check treated a reviewed retirement as a corrupt file and exited 1 with a misleading message.
for (const key of ['peterTotal', 'peterAuthored', 'maxReuse']) {
  if (key in doc) {
    console.error(`evidence-floors.json reinstates retired X floor ${key}; refusing.`);
    process.exit(1);
  }
}
  return doc;
})();
const {
  FAMILY_DEFINITIONS,
  familyForPrediction,
  validateFamilyCoverage,
} = require('./evidence-families');
/* X RETIREMENT 2026-08-13 - readPrivateHistory read the harvested @peterxing status corpus out of
   pap-secrets to cross-check that every published X mapping existed in the harvest. There are no X
   mappings left to cross-check, so the import is retired. It was also the only path by which this
   verifier touched the private corpus at all, and a verifier that no longer needs a secret should not
   retain the ability to read one. */
const {
  EXTERNAL_MAPPINGS,
  EXTERNAL_SOURCES,
} = require('./external-evidence');
const {
  NEWS_MAPPINGS,
  NEWS_SOURCES,
} = require('./news-evidence');

const DIR = __dirname;
const predictions = JSON.parse(fs.readFileSync(path.join(DIR, 'predictions.json'), 'utf8').replace(/^\uFEFF/, ''));
const signals = JSON.parse(fs.readFileSync(path.join(DIR, 'signals.json'), 'utf8').replace(/^\uFEFF/, ''));
/* X RETIREMENT 2026-08-13 - evidence-approvals.json held 30 reviewed x.com URLs and was itself on the
   publish allow-list. It is deleted, not emptied, so its REAPPEARANCE is now the failure. */
const approvals = {};
if (fs.existsSync(path.join(DIR, 'evidence-approvals.json'))) {
  console.log('RESULT: FAIL - evidence-approvals.json has reappeared; the X approvals ledger was retired.');
  process.exit(1);
}
const expectedIds = [
  ...predictions.years.flatMap(year => year.events.map((_, index) => `${year.year}-${index}`)),
  ...predictions.postSuperintelligence.items.map(item => `horizon-${item.id}`),
];
const predictionTextById = new Map([
  ...predictions.years.flatMap(year => year.events.map((event, index) => [`${year.year}-${index}`, event.t])),
  ...predictions.postSuperintelligence.items.map(item => [`horizon-${item.id}`, item.t]),
]);
// Gates ratchet in the safe direction only: evidence-floors.json records the strongest composition a
// published run has achieved, so a later regression fails here instead of shipping weaker evidence.
// The read itself is hoisted above the requires at the top of this file; see the note there.
/* X RETIREMENT 2026-08-13 - GC seq-92 is right that the Math.max(24,...) / Math.max(10,...) baselines
   are X-post floors in their own right, not merely reads of a retired key: even with the key gone they
   would still demand 24 Peter mappings. Both are removed, along with the 30-day Peter re-verification
   window. They are NOT set to zero - a floor of zero is a floor that passes vacuously, which is the
   exact fail-open shape GC caught in the sibling verifier. The reuse ceiling SURVIVES: it constrains
   how many predictions one source may back, which is medium-independent and binds news as it bound X. */
const MAX_REVIEWED_REUSE = Math.min(10, Number.isFinite(Number(ratchet.maxReuse)) ? Number(ratchet.maxReuse) : 10);
const expected = new Set(expectedIds);
const embeds = signals.embeds && typeof signals.embeds === 'object' ? signals.embeds : {};
const searches = signals.search == null
  ? {}
  : signals.search && typeof signals.search === 'object' ? signals.search : null;
const actualIds = Object.keys(embeds);
const problems = [];

const familyCoverage = validateFamilyCoverage(expectedIds);
if (familyCoverage.missing.length || familyCoverage.extra.length) {
  problems.push(`evidence-family coverage mismatch (missing ${familyCoverage.missing.join(', ') || 'none'}; extra ${familyCoverage.extra.join(', ') || 'none'})`);
}
if (signals.sourceFresh !== true) problems.push('signals.sourceFresh must be true');
if (!signals.sourceFetchedAt) problems.push('signals.sourceFetchedAt is missing');
/* X RETIREMENT 2026-08-13 - this asserted the archive-discovered / first-party-hydrated / oEmbed
   cross-checked X chain. That chain is gone, so the assertion is restated against the chain that now
   runs, rather than deleted: a published provenance claim must still be checkable, or the field becomes
   decoration. It also asserts the INVERSE - no X-era mode, primary source or action may reappear - so a
   regression to the old emitter fails here instead of quietly republishing a false description. */
const sourceStatus = signals.sourceStatus || {};
if (sourceStatus.activeSource !== signals.source
    || signals.source !== 'news-verified'
    || sourceStatus.primarySource !== 'live-verified-news'
    || sourceStatus.mode !== 'news-verified'
    || sourceStatus.reason !== 'x-evidence-retired-2026-08-13'
    || !sourceStatus.message
    || sourceStatus.actionRequired !== null
    || Number(sourceStatus.windowDays) !== Number(ratchet.currencyMaxAgeDays)
    || !Array.isArray(signals.sourceAttempts)
    || !signals.sourceAttempts.every(attempt => attempt.status === 'retired')) {
  problems.push('signals source metadata must describe the live-verified news chain and the registered currency window');
}
if (/oembed|first-party|archive-discovered|hydrat|X API/i.test(String(sourceStatus.message || ''))
    || /oembed|first-party|X API/i.test(String(sourceStatus.primarySource || ''))) {
  problems.push('signals.sourceStatus still describes the retired X hydration chain');
}
/* newestItemAt is now the newest CITED source date. It must be real, inside the window, and must not
   claim to be fresher than the run that produced it. */
if (actualIds.length) {
  const newest = Date.parse(signals.newestItemAt || '');
  if (!Number.isFinite(newest)) {
    problems.push('signals.newestItemAt must carry the publication date of the most recent cited source');
  } else {
    const ageDays = (Date.parse(signals.sourceFetchedAt) - newest) / 864e5;
    if (ageDays < -1) problems.push('signals.newestItemAt is newer than the run that produced it');
    if (Math.round(ageDays) > Number(ratchet.currencyMaxAgeDays)) {
      problems.push(`signals.newestItemAt is ${Math.round(ageDays)}d old, outside the ${ratchet.currencyMaxAgeDays}-day window`);
    }
  }
} else if (signals.newestItemAt !== null) {
  problems.push('signals.newestItemAt must be null when nothing is cited');
}

if (!signals.coverage || !signals.embeds || typeof signals.embeds !== 'object') {
  problems.push('signals.json lacks the direct-evidence schema');
}
if (searches === null) {
  problems.push('signals.search must be absent, null, or an object');
} else if (Object.keys(searches).length) {
  problems.push(`prediction search fallbacks are forbidden: ${Object.keys(searches).join(', ')}`);
}

/* X RETIREMENT 2026-08-13 - "every prediction has an embed" is superseded by "every prediction is
   ACCOUNTED FOR". 96 of 103 predictions have no qualifying source inside the registered window, and the
   honest published state for those is an explicit uncited record naming the window searched. Totality is
   NOT relaxed: a prediction that is neither cited nor recorded as uncited is still a hard failure, and
   every uncited record is validated for shape below so the channel cannot become a silent catch-all. */
const uncitedItems = (signals.uncited && typeof signals.uncited.items === 'object' && signals.uncited.items) || {};
const missing = expectedIds.filter(id => !embeds[id] && !uncitedItems[id]);
const extra = actualIds.filter(id => !expected.has(id));
if (missing.length) problems.push(`predictions neither cited nor recorded as uncited: ${missing.join(', ')}`);
if (!signals.uncited || Number(signals.uncited.windowDays) !== Number(ratchet.currencyMaxAgeDays)) {
  problems.push(`signals.uncited.windowDays (${signals.uncited?.windowDays}) must equal the registered currencyMaxAgeDays (${ratchet.currencyMaxAgeDays})`);
}
if (signals.uncited && Number(signals.uncited.count) !== Object.keys(uncitedItems).length) {
  problems.push('signals.uncited.count disagrees with the number of uncited records');
}
for (const [id, item] of Object.entries(uncitedItems)) {
  if (!expected.has(id)) { problems.push(`uncited record for unknown prediction ${id}`); continue; }
  if (embeds[id]) problems.push(`${id}: recorded as uncited while also carrying an embed`);
  if (!item || item.reason !== 'no-qualifying-source-in-window'
      || Number(item.windowDays) !== Number(ratchet.currencyMaxAgeDays)
      || !item.searchedAt || Number.isNaN(Date.parse(item.searchedAt))
      || !item.statement || !String(item.statement).includes(String(ratchet.currencyMaxAgeDays))) {
    problems.push(`${id}: uncited record is incomplete or does not state the window searched`);
  }
}
if (extra.length) problems.push(`extra direct mappings: ${extra.join(', ')}`);

/* X RETIREMENT 2026-08-13 - this block validated the sticky @peterxing approvals ledger: its floors,
   its authored split, its 15-digit status IDs, its x.com public URLs and its 30-day freshness. All of it
   retires with the ledger. What replaces it is the INVERSE assertion: both X ledgers must be empty, so a
   reappearance fails here rather than passing unnoticed. */
const externalIds = Object.keys(EXTERNAL_MAPPINGS);
if (Object.keys(approvals).length) problems.push('the retired X approvals ledger is not empty');
if (externalIds.length) problems.push(`the retired external X ledger is not empty: ${externalIds.join(', ')}`);
const unknownNews = Object.keys(NEWS_MAPPINGS).filter(id => !expected.has(id));
if (unknownNews.length) problems.push(`news mappings for unknown predictions: ${unknownNews.join(', ')}`);

const usesByPost = new Map();
for (const predictionId of expectedIds) {
  const signal = embeds[predictionId];
  if (!signal) continue;
  const postId = String(signal.id || '');
  /* A SOURCE is the thing cited, not the row that cites it. The builder publishes that identity as
     sourceKey (the resolved article url). Absence is a failure, not a fallback: defaulting to the
     row name here is exactly how a reused source came to report as two unique ones. */
  if (signal.evidenceMedium === 'news' && !String(signal.sourceKey || '').trim()) {
    problems.push(`${predictionId}: news evidence has no sourceKey, so its source cannot be identified`);
  }
  const sourceId = String(signal.sourceKey || signal.id || '');
  const family = familyForPrediction(predictionId);
  const provenance = signal.provenance || {};
  const commonValid = (signal.evidenceOwner === 'news'
    ? /^news:[a-z0-9][a-z0-9-]*$/.test(postId)
      && /^https:\/\/[^\s/]+\.[^\s/]+\/\S*$/.test(String(signal.url || ''))
    : /^\d{15,}$/.test(postId)
      && /^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d{15,}$/.test(String(signal.url || '')))
    && signal.evidenceFamily === family
    && FAMILY_DEFINITIONS[family]
    && signal.reviewed === true
    && signal.mappingRationale;
  if (!commonValid) problems.push(`${predictionId}: invalid direct evidence schema`);

  /* X RETIREMENT 2026-08-13 - this branch validated approval backing, public excerpt, public x.com URL,
     archive provenance and harvested-corpus membership. No path can produce an X-owned embed now, so
     rather than delete the branch and let one fall through to the generic "invalid evidence owner", it
     is kept and named for what it would be: a reinstatement. */
  if (signal.evidenceOwner === 'peterxing') {
    problems.push(`${predictionId}: @peterxing X evidence was retired on 2026-08-13 and must not be published`);
  } else if (signal.evidenceOwner === 'external') {
    /* X RETIREMENT 2026-08-13 — the peterxing branch above was inverted on the day; this one kept
       validating 'first-party-status+oembed' + 'tweet-result' provenance, which is the same contract
       one field over. External evidence is an X status from another account: X-medium, retired. */
    problems.push(`${predictionId}: external X evidence was retired on 2026-08-13 and must not be published`);
  } else if (signal.evidenceOwner === 'news') {
    // News is tier 3: legitimate only where the prediction has no reviewed X evidence at all.
    const mapping = NEWS_MAPPINGS[predictionId];
    const article = mapping && NEWS_SOURCES[mapping.source];
    if (!mapping || !article || approvals[predictionId] || EXTERNAL_MAPPINGS[predictionId]
        || postId !== `news:${mapping.source}`
        || article.resolvedUrl !== signal.url
        || signal.reviewedAt !== mapping.reviewedAt
        || signal.mappingRationale !== mapping.rationale
        || signal.reuseFamily !== mapping.reuseFamily
        || signal.evidenceType !== mapping.evidenceType) {
      problems.push(`${predictionId}: mapping is not backed by the reviewed news ledger, or displaces X evidence`);
    }
    if (signal.kind !== 'news'
        || signal.activityKind !== 'news'
        || signal.authorship !== 'news'
        || signal.matchMethod !== 'reviewed-news'
        || provenance.evidenceOwner !== 'news'
        || provenance.activityKind !== 'news'
        || provenance.publisher !== article?.publisher
        || provenance.publisherHost !== article?.publisherHost
        || provenance.sourceQuality !== article?.sourceQuality
        || provenance.retrievedAt !== article?.retrievedAt
        || provenance.textSha256 !== article?.textSha256
        || provenance.verifiedThrough !== 'live-fetch+quote-match'
        || !Array.isArray(provenance.sourceChain)
        || !provenance.sourceChain.includes('quote-match')
        || signal.headline !== article?.headline
        || signal.quote !== article?.quote
        || !['direct', 'scenario', 'leading-indicator'].includes(signal.evidenceType)) {
      problems.push(`${predictionId}: incomplete news provenance or rationale`);
    }
  } else {
    problems.push(`${predictionId}: invalid evidence owner`);
  }

  if (!usesByPost.has(sourceId)) usesByPost.set(sourceId, []);
  usesByPost.get(sourceId).push({
    predictionId,
    family,
    reuseFamily: signal.evidenceOwner === 'peterxing' ? family : signal.reuseFamily,
    signal,
  });
}

const reuseDistribution = {};
let maxReuse = 0;
for (const [sourceId, uses] of usesByPost) {
  maxReuse = Math.max(maxReuse, uses.length);
  reuseDistribution[uses.length] = (reuseDistribution[uses.length] || 0) + 1;
  const owners = new Set(uses.map(use => use.signal.evidenceOwner));
  const groups = new Set(uses.map(use => use.reuseFamily));
  if (uses.length > 1) {
    const owner = uses[0].signal.evidenceOwner;
    const group = uses[0].reuseFamily;
    const expectedMode = owner === 'external' ? 'external-reuse'
      : owner === 'news' ? 'news-reuse' : 'family-reuse';
    if (owners.size !== 1 || groups.size !== 1
        || uses.some(use => use.signal.assignmentMode !== expectedMode)) {
      problems.push(`source ${sourceId}: reuse crosses or violates its reviewed compatibility group`);
    }
    if (maxReuse > MAX_REVIEWED_REUSE) {
      problems.push(`maximum reviewed reuse exceeds ${MAX_REVIEWED_REUSE}: ${maxReuse}`);
    }
  } else if (uses[0].signal.assignmentMode !== 'unique') {
    problems.push(`${uses[0].predictionId}: single-use mapping is not labeled unique`);
  }
  for (const use of uses) {
    if (Number(use.signal.reuseCount) !== uses.length) {
      problems.push(`${use.predictionId}: reuseCount does not match actual usage`);
    }
  }
}

const coverage = signals.coverage || {};
if (coverage.complete !== true
    || coverage.direct !== actualIds.length
    || (Number(coverage.direct) + Number(signals.uncited?.count ?? -1)) !== expectedIds.length
    || coverage.searches !== 0
    || coverage.total !== expectedIds.length
    || coverage.uniqueSources !== usesByPost.size
    || coverage.maxReuse !== maxReuse
    || coverage.stickyPeterFloor !== undefined
    || coverage.stickyPeterAuthoredFloor !== undefined
    || coverage.reuseCeiling !== undefined
    || JSON.stringify(coverage.reuseDistribution || {}) !== JSON.stringify(reuseDistribution)) {
  problems.push('signals.coverage must declare exact N/N direct-only coverage and reuse metrics');
}

const ownerCounts = {};
const qualityCounts = {};
const mediumCounts = { x: 0, news: 0 };
const peterAuthorshipCounts = { authored:0, reposted:0 };
for (const embed of Object.values(embeds)) {
  ownerCounts[embed.evidenceOwner] = (ownerCounts[embed.evidenceOwner] || 0) + 1;
  qualityCounts[embed.sourceQuality] = (qualityCounts[embed.sourceQuality] || 0) + 1;
  mediumCounts[embed.evidenceOwner === 'news' ? 'news' : 'x']++;
  if (embed.evidenceOwner === 'peterxing' && peterAuthorshipCounts[embed.authorship] != null) {
    peterAuthorshipCounts[embed.authorship]++;
  }
}
if (JSON.stringify(coverage.byEvidenceMedium || {}) !== JSON.stringify(mediumCounts)) {
  problems.push('signals.coverage.byEvidenceMedium must declare the exact X-vs-news split');
}
/* X RETIREMENT 2026-08-13 - four checks here floored published Peter evidence and forbade news from
   rescuing those floors. GC seq-90/91 showed what happens when such a check outlives its subject: with
   the floor absent it degenerates to `x < 0`, permanently false and silently passing. Re-expressed
   positively against something that still exists - X-owned coverage must be ABSENT, and any nonzero
   count is a reinstatement. Asserted, never defaulted. */
if ((ownerCounts.peterxing || 0) !== 0) {
  problems.push(`published @peterxing X evidence is ${ownerCounts.peterxing}; it was retired and must be absent`);
}
if (mediumCounts.x !== 0) {
  problems.push(`published X-medium evidence is ${mediumCounts.x}; it was retired and must be absent`);
}
if (peterAuthorshipCounts.authored !== 0 || peterAuthorshipCounts.reposted !== 0) {
  problems.push('published Peter authored/reposted counts must both be zero after the X retirement');
}

console.log(`Coverage: ${actualIds.length}/${expectedIds.length} direct; searches: ${searches ? Object.keys(searches).length : 0}`);
console.log(`Unique sources: ${usesByPost.size}; maximum reviewed reuse: ${maxReuse}; distribution: ${JSON.stringify(reuseDistribution)}`);
console.log(`Uncited: ${Object.keys(uncitedItems).length} prediction(s) with no qualifying source inside the ${ratchet.currencyMaxAgeDays}-day window.`);
if (problems.length) {
  console.log(`RESULT: FAIL (${problems.length} problem(s))`);
  problems.forEach(problem => console.log(`  - ${problem}`));
  process.exit(1);
}
console.log(`Evidence owners: ${JSON.stringify(ownerCounts)}; source quality: ${JSON.stringify(qualityCounts)}`);
console.log(`Evidence medium: ${mediumCounts.x} X statuses; ${mediumCounts.news} live-verified news articles.`);
console.log(`RESULT: PASS \u2014 all ${expectedIds.length} predictions accounted for: ${actualIds.length} carry a `
  + `live-verified news source and ${Object.keys(uncitedItems).length} are explicitly recorded as having no `
  + `qualifying source inside the ${ratchet.currencyMaxAgeDays}-day window. No X evidence remains.`);
