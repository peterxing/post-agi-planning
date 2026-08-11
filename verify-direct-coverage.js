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
  for (const key of ['peterTotal', 'peterAuthored', 'maxReuse']) {
    if (!Number.isInteger(doc[key])) {
      console.error(`RESULT: FAIL — evidence-floors.json: ${key} must be an integer, found ${JSON.stringify(doc[key])}. `
        + 'Refusing rather than coercing it to the baseline this ratchet exists to raise.');
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
const { readPrivateHistory } = require('./refresh-signals');
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
const approvals = JSON.parse(fs.readFileSync(path.join(DIR, 'evidence-approvals.json'), 'utf8').replace(/^\uFEFF/, ''));
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
const MIN_STICKY_PETER_MAPPINGS = Math.max(24, Number(ratchet.peterTotal) || 0);
const MIN_AUTHORED_PETER_MAPPINGS = Math.max(10, Number(ratchet.peterAuthored) || 0);
const MAX_REVIEWED_REUSE = Math.min(10, Number.isFinite(Number(ratchet.maxReuse)) ? Number(ratchet.maxReuse) : 10);
const PETER_VERIFICATION_MAX_AGE_DAYS = 30;
const expected = new Set(expectedIds);
const embeds = signals.embeds && typeof signals.embeds === 'object' ? signals.embeds : {};
const searches = signals.search == null
  ? {}
  : signals.search && typeof signals.search === 'object' ? signals.search : null;
const actualIds = Object.keys(embeds);
const history = readPrivateHistory();
const historyById = new Map(history.map(item => [String(item.id), item]));
const historyByActivity = new Map(history.map(item => [String(item.activityId), item]));
const problems = [];

const familyCoverage = validateFamilyCoverage(expectedIds);
if (familyCoverage.missing.length || familyCoverage.extra.length) {
  problems.push(`evidence-family coverage mismatch (missing ${familyCoverage.missing.join(', ') || 'none'}; extra ${familyCoverage.extra.join(', ') || 'none'})`);
}
if (signals.sourceFresh !== true) problems.push('signals.sourceFresh must be true');
if (!signals.sourceFetchedAt || !signals.newestItemAt) problems.push('signals source timestamps are incomplete');
const sourceStatus = signals.sourceStatus || {};
if (sourceStatus.activeSource !== signals.source
    || signals.source !== 'archive-verified'
    || sourceStatus.primarySource !== 'first-party-status'
    || sourceStatus.mode !== 'archive-verified'
    || !sourceStatus.reason || !sourceStatus.message
    || Number(sourceStatus.hydratedThisRun) <= 0
    || !Array.isArray(signals.sourceAttempts)
    || !['wayback-cdx','tweet-result','x-oembed'].every(source =>
      signals.sourceAttempts.some(attempt => attempt.source === source))) {
  problems.push('signals source metadata must describe the archive-discovered, first-party hydrated and oEmbed-cross-checked chain');
}
if (!signals.coverage || !signals.embeds || typeof signals.embeds !== 'object') {
  problems.push('signals.json lacks the direct-evidence schema');
}
if (searches === null) {
  problems.push('signals.search must be absent, null, or an object');
} else if (Object.keys(searches).length) {
  problems.push(`prediction search fallbacks are forbidden: ${Object.keys(searches).join(', ')}`);
}

const missing = expectedIds.filter(id => !embeds[id]);
const extra = actualIds.filter(id => !expected.has(id));
if (missing.length) problems.push(`missing direct mappings: ${missing.join(', ')}`);
if (extra.length) problems.push(`extra direct mappings: ${extra.join(', ')}`);

const approvalIds = Object.keys(approvals);
const externalIds = Object.keys(EXTERNAL_MAPPINGS);
const unknownApprovals = approvalIds.filter(id => !expected.has(id));
const unknownExternal = externalIds.filter(id => !expected.has(id));
const overlap = approvalIds.filter(id => EXTERNAL_MAPPINGS[id]);
const missingLedger = expectedIds.filter(id => !approvals[id] && !EXTERNAL_MAPPINGS[id]);
if (unknownApprovals.length || unknownExternal.length || overlap.length || missingLedger.length) {
  problems.push(`evidence-ledger mismatch (unknown Peter ${unknownApprovals.join(', ') || 'none'}; unknown external ${unknownExternal.join(', ') || 'none'}; overlap ${overlap.join(', ') || 'none'}; missing ${missingLedger.join(', ') || 'none'})`);
}
if (approvalIds.length < MIN_STICKY_PETER_MAPPINGS) {
  problems.push(`sticky Peter approval floor fell below ${MIN_STICKY_PETER_MAPPINGS}: ${approvalIds.length}`);
}
const authoredApprovalCount = Object.values(approvals)
  .filter(approval => approval.relationship === 'authored').length;
if (authoredApprovalCount < MIN_AUTHORED_PETER_MAPPINGS) {
  problems.push(`sticky Peter-authored approval floor fell below ${MIN_AUTHORED_PETER_MAPPINGS}: ${authoredApprovalCount}`);
}
for (const [predictionId, approval] of Object.entries(approvals)) {
  if (!approval || approval.status !== 'active' || approval.sticky !== true
      || approval.predictionText !== predictionTextById.get(predictionId)
      || !/^\d{15,}$/.test(String(approval.postId || ''))
      || !/^\d{15,}$/.test(String(approval.activityId || ''))
      || !['post', 'repost'].includes(approval.activityKind)
      || !['authored', 'reposted'].includes(approval.relationship)
      || !approval.author
      || approval.publicUrl !== `https://x.com/${approval.author}/status/${approval.postId}`
      || !approval.publicText || !approval.basis
      || (approval.evidenceType != null
        && !['direct','scenario','leading-indicator'].includes(approval.evidenceType))
      || !approval.reviewedAt || !approval.lastVerifiedAt
      || (Date.now() - Date.parse(approval.lastVerifiedAt)) / 864e5 > PETER_VERIFICATION_MAX_AGE_DAYS
      || (Date.now() - Date.parse(approval.lastVerifiedAt)) / 864e5 < -1) {
    problems.push(`${predictionId}: sticky Peter approval metadata is incomplete or stale`);
  }
}

const usesByPost = new Map();
for (const predictionId of expectedIds) {
  const signal = embeds[predictionId];
  if (!signal) continue;
  const postId = String(signal.id || '');
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

  if (signal.evidenceOwner === 'peterxing') {
    const approval = approvals[predictionId];
    if (!approval || EXTERNAL_MAPPINGS[predictionId]
        || String(approval.postId) !== postId
        || approval.status !== 'active'
        || approval.sticky !== true
        || approval.predictionText !== predictionTextById.get(predictionId)
        || signal.reviewedAt !== approval.reviewedAt
        || signal.lastVerifiedAt !== approval.lastVerifiedAt
        || signal.mappingRationale !== approval.basis
        || signal.evidenceType !== (approval.evidenceType || 'direct')
        || signal.matchMethod !== 'reviewed-sticky') {
      problems.push(`${predictionId}: mapping is not backed by its reviewed Peter approval`);
    }
    const publicText = String(approval?.publicText || '').replace(/\s+/g, ' ').trim();
    const expectedText = publicText.length > 160 ? publicText.slice(0, 157) + '\u2026' : publicText;
    if (approval?.publicText && signal.text !== expectedText) {
      problems.push(`${predictionId}: published text differs from its reviewed public excerpt`);
    }
    if (approval?.publicUrl && signal.url !== approval.publicUrl) {
      problems.push(`${predictionId}: published URL differs from its reviewed public URL`);
    }
    if (!['post', 'repost'].includes(signal.kind)
        || provenance.evidenceOwner !== 'peterxing'
        || provenance.account !== 'peterxing'
        || provenance.activityKind !== approval?.activityKind
        || provenance.relationship !== approval?.relationship
        || String(provenance.activityId || '') !== String(approval?.activityId || '')
        || provenance.observedIn !== approval?.observedIn
        || provenance.verifiedThrough !== 'archive-verified'
        || !Array.isArray(provenance.sourceChain)
        || !provenance.sourceChain.includes('tweet-result')
        || signal.authorship !== (approval?.activityKind === 'post' ? 'authored' : 'reposted')
        || provenance.lastVerifiedAt !== approval?.lastVerifiedAt) {
      problems.push(`${predictionId}: incomplete @peterxing provenance`);
    }
    const harvested = historyByActivity.get(String(approval?.activityId || ''));
    if (!harvested) {
      problems.push(`${predictionId}: Peter post was not found in the harvested activity corpus`);
    } else if (String(harvested.id) !== postId
        || harvested.kind !== signal.kind
        || String(harvested.activityId || harvested.id) !== String(approval?.activityId || '')) {
      problems.push(`${predictionId}: activity kind differs from harvested history`);
    }
  } else if (signal.evidenceOwner === 'external') {
    const mapping = EXTERNAL_MAPPINGS[predictionId];
    const source = mapping && EXTERNAL_SOURCES[mapping.source];
    if (!mapping || approvals[predictionId] || !source
        || String(source.statusId) !== postId
        || source.url !== signal.url
        || signal.reviewedAt !== mapping.reviewedAt
        || signal.mappingRationale !== mapping.rationale
        || signal.reuseFamily !== mapping.reuseFamily
        || signal.evidenceType !== mapping.evidenceType) {
      problems.push(`${predictionId}: mapping is not backed by the reviewed external ledger`);
    }
    if (signal.kind !== 'external'
        || signal.activityKind !== 'external'
        || provenance.evidenceOwner !== 'external'
        || provenance.activityKind !== 'external'
        || provenance.account !== source?.handle
        || provenance.displayName !== source?.displayName
        || provenance.sourceQuality !== source?.sourceQuality
        || provenance.retrievedAt !== source?.retrievedAt
        || provenance.verifiedThrough !== 'first-party-status+oembed'
        || !Array.isArray(provenance.sourceChain)
        || !provenance.sourceChain.includes('tweet-result')
        || signal.authorship !== 'external'
        || !['direct', 'scenario', 'leading-indicator'].includes(signal.evidenceType)) {
      problems.push(`${predictionId}: incomplete external provenance or rationale`);
    }
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

  if (!usesByPost.has(postId)) usesByPost.set(postId, []);
  usesByPost.get(postId).push({
    predictionId,
    family,
    reuseFamily: signal.evidenceOwner === 'peterxing' ? family : signal.reuseFamily,
    signal,
  });
}

const reuseDistribution = {};
let maxReuse = 0;
for (const [postId, uses] of usesByPost) {
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
        || (owner === 'peterxing' && !FAMILY_DEFINITIONS[group]?.reuse)
        || uses.some(use => use.signal.assignmentMode !== expectedMode)) {
      problems.push(`post ${postId}: reuse crosses or violates its reviewed compatibility group`);
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
    || coverage.direct !== expectedIds.length
    || coverage.searches !== 0
    || coverage.total !== expectedIds.length
    || coverage.uniquePosts !== usesByPost.size
    || coverage.maxReuse !== maxReuse
    || coverage.stickyPeterFloor !== MIN_STICKY_PETER_MAPPINGS
    || coverage.stickyPeterAuthoredFloor !== MIN_AUTHORED_PETER_MAPPINGS
    || coverage.reuseCeiling !== MAX_REVIEWED_REUSE
    || JSON.stringify(coverage.reuseDistribution || {}) !== JSON.stringify(reuseDistribution)) {
  problems.push('signals.coverage must declare exact N/N direct-only coverage and reuse metrics');
}

const dates = history.map(item => item.created).filter(date => date instanceof Date && !isNaN(date));
const oldest = dates.length ? new Date(Math.min(...dates)).toISOString() : null;
const newest = dates.length ? new Date(Math.max(...dates)).toISOString() : null;
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
// News may never be counted toward, or used to rescue, the Peter floors.
if (mediumCounts.news && (ownerCounts.peterxing || 0) < MIN_STICKY_PETER_MAPPINGS) {
  problems.push('news evidence may never substitute for the Peter floors');
}
if ((ownerCounts.peterxing || 0) < MIN_STICKY_PETER_MAPPINGS) {
  problems.push(`published Peter evidence fell below the sticky floor: ${ownerCounts.peterxing || 0}`);
}
if (JSON.stringify(coverage.byPeterAuthorship || {}) !== JSON.stringify(peterAuthorshipCounts)
    || peterAuthorshipCounts.authored + peterAuthorshipCounts.reposted !== (ownerCounts.peterxing || 0)) {
  problems.push('published Peter authored/reposted split is missing or inaccurate');
}
if (peterAuthorshipCounts.authored < MIN_AUTHORED_PETER_MAPPINGS) {
  problems.push(`published Peter-authored evidence fell below the sticky floor: ${peterAuthorshipCounts.authored}`);
}

console.log(`Coverage: ${actualIds.length}/${expectedIds.length} direct; searches: ${searches ? Object.keys(searches).length : 0}`);
console.log(`Unique statuses: ${usesByPost.size}; maximum reviewed reuse: ${maxReuse}; distribution: ${JSON.stringify(reuseDistribution)}`);
console.log(`Archive-verified corpus: ${history.length} authored/reposted statuses; span: ${oldest || 'unknown'} to ${newest || 'unknown'}`);
if (problems.length) {
  console.log(`RESULT: FAIL (${problems.length} problem(s))`);
  problems.forEach(problem => console.log(`  - ${problem}`));
  process.exit(1);
}
console.log(`Evidence owners: ${JSON.stringify(ownerCounts)}; Peter authorship: ${JSON.stringify(peterAuthorshipCounts)}; source quality: ${JSON.stringify(qualityCounts)}`);
console.log(`Evidence medium: ${mediumCounts.x} X statuses; ${mediumCounts.news} live-verified news articles.`);
console.log(mediumCounts.news === 0
  ? 'RESULT: PASS — every prediction has exactly one reviewed direct X status with valid provenance and compatible reuse.'
  : `RESULT: PASS — every prediction has exactly one reviewed direct source (${mediumCounts.x} X statuses, ${mediumCounts.news} verified news) with valid provenance and compatible reuse.`);
