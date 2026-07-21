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
        || signal.reviewedAt !== approval.reviewedAt
        || signal.mappingRationale !== approval.basis
        || signal.evidenceType !== 'direct') {
      problems.push(`${predictionId}: mapping is not backed by its reviewed Peter approval`);
    }
    if (approval?.publicText && signal.text !== approval.publicText) {
      problems.push(`${predictionId}: published text differs from its reviewed public excerpt`);
    }
    if (approval?.publicUrl && signal.url !== approval.publicUrl) {
      problems.push(`${predictionId}: published URL differs from its reviewed public URL`);
    }
    if (!['post', 'repost'].includes(signal.kind)
        || provenance.evidenceOwner !== 'peterxing'
        || provenance.account !== 'peterxing'
        || !['post', 'repost'].includes(provenance.activityKind)
        || !['authored', 'reposted'].includes(provenance.relationship)
        || !/^\d{15,}$/.test(String(provenance.activityId || ''))
        || !provenance.observedIn) {
      problems.push(`${predictionId}: incomplete @peterxing provenance`);
    }
    const harvested = historyById.get(postId);
    if (!harvested) {
      problems.push(`${predictionId}: Peter post was not found in the harvested activity corpus`);
    } else if (harvested.kind !== signal.kind) {
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
