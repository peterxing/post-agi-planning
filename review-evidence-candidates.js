'use strict';

// Concurrency interlock: claim the tree before reading predictions/signals/approvals/floors.
if (require.main === module) require('./pipeline-lock').guard('review:candidates');

const approvals = require('./evidence-approvals.json');
const {
  buildPredictions,
  qualifyFamilyPost,
  qualifyPost,
} = require('./refresh-signals');
const {
  corpusToMatcherItems,
  hydrateTweetResult,
  loadCorpus,
} = require('./x-archive');

const showArg = process.argv.find(argument => argument.startsWith('--show-public='));

async function showPublicStatus(id) {
  if (!/^\d{15,}$/.test(id)) throw new Error('status ID must be numeric');
  const result = await hydrateTweetResult(id);
  if (!result.ok) throw new Error(`status unavailable (${result.status || result.reason})`);
  const tweet = result.data;
  console.log(JSON.stringify({
    id: String(tweet.id_str),
    author: tweet.user?.screen_name || null,
    date: tweet.created_at || null,
    text: tweet.text || tweet.full_text || '',
  }, null, 2));
}

function candidateAudit() {
  const corpus = loadCorpus();
  const recordsByActivity = new Map(corpus.items.map(item => [String(item.activityId), item]));
  const activity = corpusToMatcherItems(corpus.items);
  const predictions = buildPredictions();
  const now = Date.now();
  const audit = {};
  const unique = new Map();
  for (const prediction of predictions) {
    const candidates = [];
    for (const item of activity) {
      const ageDays = Math.max(0, (now - item.created.getTime()) / 864e5);
      const direct = qualifyPost(item.text, prediction, ageDays);
      const family = direct.ok ? null : qualifyFamilyPost(item.text, prediction);
      const qualified = direct.ok ? direct : family;
      if (!qualified?.ok) continue;
      const record = recordsByActivity.get(String(item.activityId));
      const authorship = item.kind === 'post' ? 'authored' : 'reposted';
      const row = {
        statusId: item.id,
        activityId: item.activityId,
        kind: record?.kind || (authorship === 'authored' ? 'authored' : 'repost'),
        authorship,
        date: item.created.toISOString().slice(0, 10),
        method: qualified.matchMethod,
        assignmentMode: direct.ok ? 'direct' : 'family-reuse-candidate',
        score: qualified.scored.score,
        coverage: qualified.scored.coverage,
        conceptScore: qualified.scored.conceptScore,
        concepts: qualified.scored.conceptHits,
        approved: String(approvals[prediction.id]?.postId || '') === String(item.id)
          && String(approvals[prediction.id]?.activityId || '') === String(item.activityId),
      };
      candidates.push(row);
      if (!unique.has(item.activityId)) unique.set(item.activityId, { authored:authorship === 'authored', predictions:new Set() });
      unique.get(item.activityId).predictions.add(prediction.id);
    }
    candidates.sort((a, b) =>
      Number(b.authorship === 'authored') - Number(a.authorship === 'authored')
      || Number(b.assignmentMode === 'direct') - Number(a.assignmentMode === 'direct')
      || b.coverage - a.coverage
      || b.conceptScore - a.conceptScore
      || b.score - a.score
      || b.date.localeCompare(a.date));
    audit[prediction.id] = candidates.slice(0, 5);
  }
  const authored = [...unique.values()].filter(item => item.authored);
  console.log(JSON.stringify({
    corpus: {
      discovered: corpus.metadata.discovery?.count || 0,
      records: corpus.items.length,
      verified: corpus.items.filter(item => item.verifiedAt).length,
    },
    candidateSummary: {
      uniqueActivities: unique.size,
      uniqueAuthoredActivities: authored.length,
      predictionsWithAuthoredCandidate: new Set(authored.flatMap(item => [...item.predictions])).size,
    },
    candidates: audit,
  }, null, 2));
}

(showArg
  ? showPublicStatus(showArg.split('=')[1])
  : Promise.resolve(candidateAudit())
).catch(error => {
  console.error(error.message);
  process.exit(1);
});
