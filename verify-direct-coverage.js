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
  EXTERNAL_DIRECT_IDS,
  EXTERNAL_MAPPINGS,
  EXTERNAL_SOURCES,
  MAX_POST_REUSE,
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
const embeds = signals.embeds || {};
const searches = signals.search || {};
const actualIds = Object.keys(embeds);
const searchIds = Object.keys(searches);
const actual = new Set([...actualIds, ...searchIds]);
const history = readPrivateHistory();
const historyById = new Map(history.map(item => [String(item.id), item]));
const problems = [];
const directSchemaPresent = !!signals.coverage
  && signals.search && typeof signals.search === 'object';

const familyCoverage = validateFamilyCoverage(expectedIds);
if (familyCoverage.missing.length || familyCoverage.extra.length) {
  problems.push(`evidence-family coverage mismatch (missing ${familyCoverage.missing.join(', ') || 'none'}; extra ${familyCoverage.extra.join(', ') || 'none'})`);
}
if (signals.sourceFresh !== true) problems.push('signals.sourceFresh must be true');
if (!directSchemaPresent) problems.push('signals.json lacks the current direct-or-search schema');

const missing = expectedIds.filter(id => !actual.has(id));
const extra = actualIds.filter(id => !expected.has(id));
const extraSearches = searchIds.filter(id => !expected.has(id));
const overlaps = expectedIds.filter(id => embeds[id] && searches[id]);
if (missing.length) problems.push(`missing direct-or-search mappings: ${missing.join(', ')}`);
if (extra.length) problems.push(`extra mappings: ${extra.join(', ')}`);
if (extraSearches.length) problems.push(`extra searches: ${extraSearches.join(', ')}`);
if (overlaps.length) problems.push(`direct/search overlap: ${overlaps.join(', ')}`);

const usesByPost = new Map();
for (const predictionId of directSchemaPresent ? actualIds : []) {
  const signal = embeds[predictionId];
  const postId = String(signal && signal.id || '');
  const family = familyForPrediction(predictionId);
  const provenance = signal && signal.provenance || {};
  const approval = approvals[predictionId];
  if (!/^\d{15,}$/.test(postId)) problems.push(`${predictionId}: invalid numeric post ID`);
  if (!['post', 'repost', 'external'].includes(signal && signal.kind)) problems.push(`${predictionId}: invalid activity kind`);
  if (!/^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d{15,}$/.test(String(signal && signal.url || ''))) {
    problems.push(`${predictionId}: invalid direct X URL`);
  }
  if (signal.evidenceFamily !== family || !FAMILY_DEFINITIONS[family]) {
    problems.push(`${predictionId}: evidence-family mismatch`);
  }
  if (signal.evidenceOwner === 'peterxing') {
    if (provenance.evidenceOwner !== 'peterxing'
        || provenance.account !== 'peterxing'
        || !['post', 'repost'].includes(provenance.activityKind)
        || !['authored', 'reposted'].includes(provenance.relationship)
        || !/^\d{15,}$/.test(String(provenance.activityId || ''))
        || !provenance.observedIn) {
      problems.push(`${predictionId}: incomplete @peterxing provenance`);
    }
    if (!approval || String(approval.postId) !== postId
        || signal.reviewed !== true || signal.reviewedAt !== approval.reviewedAt) {
      problems.push(`${predictionId}: mapping is not backed by its reviewed Peter approval`);
    }
    const harvested = historyById.get(postId);
    if (!harvested) {
      problems.push(`${predictionId}: Peter post was not found in the harvested activity corpus`);
    } else {
      if (harvested.kind !== signal.kind) problems.push(`${predictionId}: activity kind differs from harvested history`);
    }
  } else if (signal.evidenceOwner === 'external') {
    const mapping = EXTERNAL_MAPPINGS[predictionId];
    const source = mapping && EXTERNAL_SOURCES[mapping.source];
    const directSelection = EXTERNAL_DIRECT_IDS[mapping?.source];
    const selected = !directSelection || directSelection.includes(predictionId);
    if (!mapping || !source || !selected || String(source.statusId) !== postId
        || signal.reviewed !== true || signal.reviewedAt !== mapping.reviewedAt) {
      problems.push(`${predictionId}: mapping is not backed by the reviewed external ledger`);
    }
    for (const predictionId of directSchemaPresent ? searchIds : []) {
      const search = searches[predictionId];
      if (!search || search.matchMethod !== 'live-search'
          || !/^from:peterxing(?:\s|$)/i.test(String(search.query || ''))
          || !search.maps || !search.reason) {
        problems.push(`${predictionId}: malformed live @peterxing search`);
      }
    }
    if (signal.kind !== 'external'
        || provenance.evidenceOwner !== 'external'
        || provenance.activityKind !== 'external'
        || provenance.account !== source?.handle
        || provenance.displayName !== source?.displayName
        || provenance.sourceQuality !== source?.sourceQuality
        || !provenance.retrievedAt
        || signal.reuseFamily !== mapping?.reuseFamily
        || signal.evidenceType !== mapping?.evidenceType
        || signal.mappingRationale !== mapping?.rationale
        || !['direct', 'scenario', 'leading-indicator'].includes(signal.evidenceType)) {
      problems.push(`${predictionId}: incomplete external provenance or rationale`);
    }
  } else {
    problems.push(`${predictionId}: invalid evidence owner`);
  }
  if (!usesByPost.has(postId)) usesByPost.set(postId, []);
  usesByPost.get(postId).push({ predictionId, family, reuseFamily: signal.reuseFamily || family, signal });
}

const reuseDistribution = {};
let maxReuse = 0;
for (const [postId, uses] of usesByPost) {
  maxReuse = Math.max(maxReuse, uses.length);
  reuseDistribution[uses.length] = (reuseDistribution[uses.length] || 0) + 1;
  const owners = new Set(uses.map(use => use.signal.evidenceOwner));
  const families = new Set(uses.map(use => use.signal.evidenceOwner === 'external' ? use.reuseFamily : use.family));
  if (uses.length > MAX_POST_REUSE) {
    problems.push(`post ${postId}: reuse ${uses.length} exceeds cap ${MAX_POST_REUSE}`);
  }
  if (uses.length > 1) {
    const family = [...families][0];
    if (owners.size !== 1 || families.size !== 1
        || (uses[0].signal.evidenceOwner === 'peterxing' && !FAMILY_DEFINITIONS[family]?.reuse)) {
      problems.push(`post ${postId}: reuse crosses or violates declared family compatibility`);
    }
    const expectedMode = uses[0].signal.evidenceOwner === 'external' ? 'external-reuse' : 'family-reuse';
    if (uses.some(use => use.signal.assignmentMode !== expectedMode)) {
      problems.push(`post ${postId}: reused mapping has an invalid assignment mode`);
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

if (directSchemaPresent && (!signals.coverage || signals.coverage.complete !== true
    || signals.coverage.direct !== actualIds.length
    || signals.coverage.searches !== searchIds.length
    || signals.coverage.total !== expectedIds.length)) {
  problems.push('signals.coverage must declare complete N/N direct-or-search coverage');
}
const approvalIds = Object.keys(approvals);
const unknownApprovals = approvalIds.filter(id => !expected.has(id));
if (unknownApprovals.length) problems.push(`approvals reference unknown predictions: ${unknownApprovals.join(', ')}`);
const externalIds = Object.keys(EXTERNAL_MAPPINGS);
const unknownExternal = externalIds.filter(id => !expected.has(id));
const overlap = approvalIds.filter(id => EXTERNAL_MAPPINGS[id]);
if (unknownExternal.length || overlap.length) {
  problems.push(`mixed ledger mismatch (unknown ${unknownExternal.join(', ') || 'none'}; overlap ${overlap.join(', ') || 'none'})`);
}

const dates = history.map(item => item.created).filter(date => date instanceof Date && !isNaN(date));
const oldest = dates.length ? new Date(Math.min(...dates)).toISOString() : null;
const newest = dates.length ? new Date(Math.max(...dates)).toISOString() : null;
console.log(`Coverage: ${actual.size}/${expectedIds.length} (${actualIds.length} direct, ${searchIds.length} live searches)`);
const observedUses = directSchemaPresent
  ? [...usesByPost.values()].map(uses => uses.length)
  : Object.values(actualIds.reduce((counts, id) => {
      const postId = String(embeds[id] && embeds[id].id || '');
      if (postId) counts[postId] = (counts[postId] || 0) + 1;
      return counts;
    }, {}));
const observedDistribution = {};
for (const count of observedUses) observedDistribution[count] = (observedDistribution[count] || 0) + 1;
console.log(`Unique posts: ${observedUses.length}; maximum reuse: ${Math.max(0, ...observedUses)}; distribution: ${JSON.stringify(observedDistribution)}`);
console.log(`Harvested history: ${history.length} posts/reposts; span: ${oldest || 'unknown'} to ${newest || 'unknown'}`);
if (problems.length) {
  console.log(`RESULT: FAIL (${problems.length} problem(s))`);
  problems.forEach(problem => console.log(`  - ${problem}`));
  process.exit(1);
}
const ownerCounts = {};
const qualityCounts = {};
for (const embed of Object.values(embeds)) {
  ownerCounts[embed.evidenceOwner] = (ownerCounts[embed.evidenceOwner] || 0) + 1;
  qualityCounts[embed.sourceQuality] = (qualityCounts[embed.sourceQuality] || 0) + 1;
}
console.log(`Evidence owners: ${JSON.stringify(ownerCounts)}; source quality: ${JSON.stringify(qualityCounts)}`);
console.log('RESULT: PASS — every prediction has reviewed direct X evidence or an honest live @peterxing search.');
