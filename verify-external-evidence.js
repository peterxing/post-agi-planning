'use strict';

// Concurrency interlock: claim the tree before reading predictions/signals/approvals/floors.
if (require.main === module) require('./pipeline-lock').guard('verify:external');

const fs = require('fs');
const path = require('path');
const approvals = require('./evidence-approvals.json');
const {
  EXTERNAL_MAPPINGS,
  EXTERNAL_SOURCES,
} = require('./external-evidence');
const {
  hydrateTweetResult,
  resolveOembed,
} = require('./x-archive');

const predictions = JSON.parse(fs.readFileSync(path.join(__dirname, 'predictions.json'), 'utf8').replace(/^\uFEFF/, ''));
const signals = JSON.parse(fs.readFileSync(path.join(__dirname, 'signals.json'), 'utf8').replace(/^\uFEFF/, ''));
const expectedIds = [
  ...predictions.years.flatMap(year => year.events.map((_, index) => `${year.year}-${index}`)),
  ...predictions.postSuperintelligence.items.map(item => `horizon-${item.id}`),
];
const expected = new Set(expectedIds);
const problems = [];
const MAX_REVIEWED_REUSE = 10;
const qualityClasses = new Set([
  'official-research-organization',
  'official-ai-lab',
  'official-company',
  'government',
  'intergovernmental-organization',
  'academic-researcher',
  'academic-research-institution',
  'privacy-research-organization',
  'original-scenario-author',
  'original-framework-author',
  'original-researcher',
]);
const mappingIds = Object.keys(EXTERNAL_MAPPINGS);
const overlap = Object.keys(approvals).filter(id => EXTERNAL_MAPPINGS[id]);
const missing = expectedIds.filter(id => !approvals[id] && !EXTERNAL_MAPPINGS[id]);
const extra = mappingIds.filter(id => !expected.has(id));
if (overlap.length || missing.length || extra.length) {
  problems.push(`ledger coverage mismatch (overlap ${overlap.join(', ') || 'none'}; missing ${missing.join(', ') || 'none'}; extra ${extra.join(', ') || 'none'})`);
}
if (Object.keys(signals.search || {}).length) {
  problems.push('signals.search must be empty');
}
if (!signals.coverage || signals.coverage.reuseCeiling !== MAX_REVIEWED_REUSE
    || signals.coverage.maxReuse > MAX_REVIEWED_REUSE) {
  problems.push(`signals coverage must enforce the reviewed reuse ceiling ${MAX_REVIEWED_REUSE}`);
}

const sourceUses = new Map();
for (const [predictionId, mapping] of Object.entries(EXTERNAL_MAPPINGS)) {
  const source = EXTERNAL_SOURCES[mapping.source];
  if (!source) {
    problems.push(`${predictionId}: unknown external source ${mapping.source}`);
    continue;
  }
  if (!sourceUses.has(mapping.source)) sourceUses.set(mapping.source, []);
  sourceUses.get(mapping.source).push({ predictionId, mapping });
  if (!['direct', 'scenario', 'leading-indicator'].includes(mapping.evidenceType)) {
    problems.push(`${predictionId}: invalid evidence type`);
  }
  if (!mapping.rationale || !mapping.reviewedAt || !mapping.reuseFamily) {
    problems.push(`${predictionId}: incomplete reviewed mapping metadata`);
  }
  const signal = signals.embeds && signals.embeds[predictionId];
  if (!signal || signal.evidenceOwner !== 'external'
      || String(signal.id || '') !== String(source.statusId)
      || signal.mappingRationale !== mapping.rationale
      || signal.reuseFamily !== mapping.reuseFamily
      || signal.evidenceType !== mapping.evidenceType) {
    problems.push(`${predictionId}: published embed differs from the reviewed external mapping`);
  }
}
for (const [sourceKey, source] of Object.entries(EXTERNAL_SOURCES)) {
  if (!sourceUses.has(sourceKey)) problems.push(`${sourceKey}: unused external source`);
  if (!/^\d{15,}$/.test(String(source.statusId || ''))
      || source.url !== `https://x.com/${source.handle}/status/${source.statusId}`) {
    problems.push(`${sourceKey}: invalid status ID or canonical URL`);
  }
  if (!source.handle || !source.displayName || !source.postedAt || !source.retrievedAt || !source.text) {
    problems.push(`${sourceKey}: incomplete public-safe source metadata`);
  }
  if (!qualityClasses.has(source.sourceQuality)) problems.push(`${sourceKey}: invalid source-quality class`);
  const uses = sourceUses.get(sourceKey) || [];
  if (uses.length > MAX_REVIEWED_REUSE) {
    problems.push(`${sourceKey}: reuse ${uses.length} exceeds reviewed ceiling ${MAX_REVIEWED_REUSE}`);
  }
  if (uses.length > 1 && new Set(uses.map(use => use.mapping.reuseFamily)).size !== 1) {
    problems.push(`${sourceKey}: reuse crosses reviewed compatibility groups`);
  }
}

async function verifySource(sourceKey, source) {
  const hydrated = await hydrateTweetResult(source.statusId);
  if (!hydrated.ok) return `${sourceKey}: X first-party hydration returned ${hydrated.status || hydrated.reason}`;
  const hydratedId = String(hydrated.data.id_str || '');
  const hydratedHandle = String(hydrated.data.user?.screen_name || '');
  if (hydratedId !== source.statusId) return `${sourceKey}: X first-party hydration returned a different status ID`;
  if (hydratedHandle.toLowerCase() !== source.handle.toLowerCase()) {
    return `${sourceKey}: X first-party hydration returned a different author`;
  }
  const crossCheck = await resolveOembed(source.url);
  if (!crossCheck.ok) return `${sourceKey}: X oEmbed returned HTTP ${crossCheck.status || crossCheck.reason}`;
  if (crossCheck.id !== source.statusId) return `${sourceKey}: X oEmbed returned a different status ID`;
  if (crossCheck.handle.toLowerCase() !== source.handle.toLowerCase()) {
    return `${sourceKey}: X oEmbed returned a different author`;
  }
  return null;
}

(async () => {
  const entries = Object.entries(EXTERNAL_SOURCES);
  for (const [key, source] of entries) {
    const result = await verifySource(key, source).catch(error => `${key}: ${error.message}`);
    if (result) problems.push(result);
  }
  const useCounts = [...sourceUses.values()].map(uses => uses.length);
  const distribution = {};
  for (const count of useCounts) distribution[count] = (distribution[count] || 0) + 1;
  console.log(`External mappings: ${mappingIds.length}; unique statuses: ${entries.length}; max reuse: ${Math.max(0, ...useCounts)}; distribution: ${JSON.stringify(distribution)}`);
  if (problems.length) {
    console.log(`RESULT: FAIL (${problems.length} problem(s))`);
    problems.forEach(problem => console.log(`  - ${problem}`));
    process.exit(1);
  }
  console.log('RESULT: PASS — every external mapping is reviewed, authoritative, compatibility-grouped, first-party hydrated, and independently cross-checked through X oEmbed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
