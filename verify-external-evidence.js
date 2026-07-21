'use strict';

const fs = require('fs');
const path = require('path');
const approvals = require('./evidence-approvals.json');
const {
  EXTERNAL_DIRECT_IDS,
  EXTERNAL_MAPPINGS,
  EXTERNAL_SOURCES,
  MAX_POST_REUSE,
} = require('./external-evidence');

const predictions = JSON.parse(fs.readFileSync(path.join(__dirname, 'predictions.json'), 'utf8').replace(/^\uFEFF/, ''));
const signals = JSON.parse(fs.readFileSync(path.join(__dirname, 'signals.json'), 'utf8').replace(/^\uFEFF/, ''));
const expectedIds = [
  ...predictions.years.flatMap(year => year.events.map((_, index) => `${year.year}-${index}`)),
  ...predictions.postSuperintelligence.items.map(item => `horizon-${item.id}`),
];
const expected = new Set(expectedIds);
const problems = [];
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
const missingWithoutSearch = missing.filter(id => !signals.search?.[id]);
if (overlap.length || missingWithoutSearch.length || extra.length) {
  problems.push(`ledger coverage mismatch (overlap ${overlap.join(', ') || 'none'}; missing without search ${missingWithoutSearch.join(', ') || 'none'}; extra ${extra.join(', ') || 'none'})`);
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
  if (uses.length > 1 && new Set(uses.map(use => use.mapping.reuseFamily)).size !== 1) {
    problems.push(`${sourceKey}: reuse crosses reviewed compatibility groups`);
  }
  if (uses.length > MAX_POST_REUSE) {
    const selected = EXTERNAL_DIRECT_IDS[sourceKey] || [];
    if (selected.length !== MAX_POST_REUSE
        || new Set(selected).size !== selected.length
        || selected.some(predictionId => !uses.some(use => use.predictionId === predictionId))) {
      problems.push(`${sourceKey}: over-cap ledger source lacks a valid ${MAX_POST_REUSE}-item direct selection`);
    }
  }
}

async function verifyOembed(sourceKey, source) {
  const url = `https://publish.x.com/oembed?url=${encodeURIComponent(source.url)}&omit_script=true`;
  const response = await fetch(url, { headers: { 'User-Agent': 'pap-evidence-verifier/1.0' } });
  if (!response.ok) return `${sourceKey}: X oEmbed returned HTTP ${response.status}`;
  const data = await response.json();
  const returnedId = String(data.url || '').match(/status\/(\d{15,})/)?.[1];
  const returnedHandle = String(data.author_url || '').match(/x\.com\/([A-Za-z0-9_]+)/)?.[1];
  if (returnedId !== source.statusId) return `${sourceKey}: X oEmbed returned a different status ID`;
  if (!returnedHandle || returnedHandle.toLowerCase() !== source.handle.toLowerCase()) {
    return `${sourceKey}: X oEmbed returned a different author`;
  }
  return null;
}

(async () => {
  const entries = Object.entries(EXTERNAL_SOURCES);
  for (let index = 0; index < entries.length; index += 6) {
    const batch = entries.slice(index, index + 6);
    const results = await Promise.all(batch.map(([key, source]) => verifyOembed(key, source).catch(error => `${key}: ${error.message}`)));
    problems.push(...results.filter(Boolean));
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
  console.log('RESULT: PASS — external candidates are reviewed, authoritative, capped for direct use, and resolve through X.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
