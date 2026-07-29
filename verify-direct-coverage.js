'use strict';

const fs = require('fs');
const path = require('path');
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
const MIN_STICKY_PETER_MAPPINGS = 17;
const MAX_REVIEWED_REUSE = 12;
const PETER_VERIFICATION_MAX_AGE_DAYS = 30;
const expected = new Set(expectedIds);
const embeds = signals.embeds && typeof signals.embeds === 'object' ? signals.embeds : {};
const searches = signals.search == null
  ? {}
  : signals.search && typeof signals.search === 'object' ? signals.search : null;
const actualIds = Object.keys(embeds);
const history = readPrivateHistory();
const historyById = new Map(history.map(item => [String(item.id), item]));
const problems = [];

const familyCoverage = validateFamilyCoverage(expectedIds);
if (familyCoverage.missing.length || familyCoverage.extra.length) {
  problems.push(`evidence-family coverage mismatch (missing ${familyCoverage.missing.join(', ') || 'none'}; extra ${familyCoverage.extra.join(', ') || 'none'})`);
}
if (signals.sourceFresh !== true) problems.push('signals.sourceFresh must be true');
if (!signals.sourceFetchedAt || !signals.newestItemAt) problems.push('signals source timestamps are incomplete');
const sourceStatus = signals.sourceStatus || {};
if (sourceStatus.activeSource !== signals.source
    || sourceStatus.primarySource !== 'x-api'
    || !['primary', 'degraded'].includes(sourceStatus.mode)
    || (signals.source === 'x-api' && (sourceStatus.mode !== 'primary' || sourceStatus.reason))
    || (signals.source !== 'x-api' && (sourceStatus.mode !== 'degraded'
      || !sourceStatus.reason || !sourceStatus.message || !sourceStatus.actionRequired))) {
  problems.push('signals.sourceStatus must honestly describe primary or degraded source operation');
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
  const commonValid = /^\d{15,}$/.test(postId)
    && /^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d{15,}$/.test(String(signal.url || ''))
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
        || signal.evidenceType !== 'direct'
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
        || provenance.lastVerifiedAt !== approval?.lastVerifiedAt) {
      problems.push(`${predictionId}: incomplete @peterxing provenance`);
    }
    const harvested = historyById.get(postId);
    if (!harvested) {
      problems.push(`${predictionId}: Peter post was not found in the harvested activity corpus`);
    } else if (harvested.kind !== signal.kind
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
        || !['direct', 'scenario', 'leading-indicator'].includes(signal.evidenceType)) {
      problems.push(`${predictionId}: incomplete external provenance or rationale`);
    }
  } else {
    problems.push(`${predictionId}: invalid evidence owner`);
  }

  if (!usesByPost.has(postId)) usesByPost.set(postId, []);
  usesByPost.get(postId).push({
    predictionId,
    family,
    reuseFamily: signal.evidenceOwner === 'external' ? signal.reuseFamily : family,
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
    const expectedMode = owner === 'external' ? 'external-reuse' : 'family-reuse';
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
    || coverage.reuseCeiling !== MAX_REVIEWED_REUSE
    || JSON.stringify(coverage.reuseDistribution || {}) !== JSON.stringify(reuseDistribution)) {
  problems.push('signals.coverage must declare exact N/N direct-only coverage and reuse metrics');
}

const dates = history.map(item => item.created).filter(date => date instanceof Date && !isNaN(date));
const oldest = dates.length ? new Date(Math.min(...dates)).toISOString() : null;
const newest = dates.length ? new Date(Math.max(...dates)).toISOString() : null;
const ownerCounts = {};
const qualityCounts = {};
for (const embed of Object.values(embeds)) {
  ownerCounts[embed.evidenceOwner] = (ownerCounts[embed.evidenceOwner] || 0) + 1;
  qualityCounts[embed.sourceQuality] = (qualityCounts[embed.sourceQuality] || 0) + 1;
}
if ((ownerCounts.peterxing || 0) < MIN_STICKY_PETER_MAPPINGS) {
  problems.push(`published Peter evidence fell below the sticky floor: ${ownerCounts.peterxing || 0}`);
}

console.log(`Coverage: ${actualIds.length}/${expectedIds.length} direct; searches: ${searches ? Object.keys(searches).length : 0}`);
console.log(`Unique statuses: ${usesByPost.size}; maximum reviewed reuse: ${maxReuse}; distribution: ${JSON.stringify(reuseDistribution)}`);
console.log(`Harvested history: ${history.length} posts/reposts; span: ${oldest || 'unknown'} to ${newest || 'unknown'}`);
if (problems.length) {
  console.log(`RESULT: FAIL (${problems.length} problem(s))`);
  problems.forEach(problem => console.log(`  - ${problem}`));
  process.exit(1);
}
console.log(`Evidence owners: ${JSON.stringify(ownerCounts)}; source quality: ${JSON.stringify(qualityCounts)}`);
console.log('RESULT: PASS — every prediction has exactly one reviewed direct X status with valid provenance and compatible reuse.');
