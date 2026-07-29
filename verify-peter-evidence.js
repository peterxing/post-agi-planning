'use strict';

// Concurrency interlock: claim the tree before reading predictions/signals/approvals/floors.
if (require.main === module) require('./pipeline-lock').guard('verify:peter');

const fs = require('fs');
const path = require('path');
const {
  hydrateTweetResult,
  loadCorpus,
  resolveOembed,
} = require('./x-archive');

const FILE = path.join(__dirname, 'evidence-approvals.json');
const approvals = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''));
const problems = [];
const update = process.argv.includes('--update');
const MAX_VERIFICATION_AGE_DAYS = 30;

(async () => {
  const entries = Object.entries(approvals);
  const today = new Date().toISOString().slice(0, 10);
  const corpus = loadCorpus();
  const corpusByActivity = new Map(corpus.items.map(item => [String(item.activityId), item]));
  const statusCache = new Map();
  const oembedCache = new Map();
  for (const [predictionId, approval] of entries) {
    if (!statusCache.has(approval.postId)) {
      statusCache.set(approval.postId, await hydrateTweetResult(String(approval.postId)));
    }
    if (!oembedCache.has(approval.publicUrl)) {
      oembedCache.set(approval.publicUrl, await resolveOembed(approval.publicUrl));
    }
    const activityUrl = `https://x.com/peterxing/status/${approval.activityId}`;
    if (!oembedCache.has(activityUrl)) {
      oembedCache.set(activityUrl, await resolveOembed(activityUrl));
    }
    const hydrated = statusCache.get(approval.postId);
    const original = oembedCache.get(approval.publicUrl);
    const activity = oembedCache.get(activityUrl);
    const hydratedId = String(hydrated?.data?.id_str || '');
    const hydratedAuthor = String(hydrated?.data?.user?.screen_name || '');
    if (!hydrated?.ok || hydratedId !== String(approval.postId)
        || hydratedAuthor.toLowerCase() !== approval.author.toLowerCase()) {
      problems.push(`${predictionId}: first-party status hydration failed for @${approval.author}/${approval.postId}`);
    }
    if (!original?.ok
          || original.id !== String(approval.postId)
          || original.handle?.toLowerCase() !== approval.author.toLowerCase()) {
        problems.push(`${predictionId}: original status no longer resolves to @${approval.author}/${approval.postId}`);
    }
    if (!activity?.ok
          || activity.id !== String(approval.activityId)
          || activity.handle?.toLowerCase() !== 'peterxing') {
      problems.push(`${predictionId}: @peterxing activity status no longer resolves to ${approval.activityId}`);
    }
    const corpusItem = corpusByActivity.get(String(approval.activityId));
    if (!corpusItem || String(corpusItem.statusId) !== String(approval.postId)
        || (approval.activityKind === 'repost'
          ? corpusItem.kind !== 'repost'
          : !['authored', 'quote', 'reply'].includes(corpusItem.kind))
        || !corpusItem.verifiedAt) {
      problems.push(`${predictionId}: private archive corpus lacks matching verified activity provenance`);
    }
    const verifiedAt = new Date(`${approval.lastVerifiedAt}T00:00:00Z`);
    const ageDays = (Date.now() - verifiedAt.getTime()) / 864e5;
    if (isNaN(verifiedAt.getTime()) || ageDays < -1 || ageDays > MAX_VERIFICATION_AGE_DAYS) {
      problems.push(`${predictionId}: lastVerifiedAt is outside the ${MAX_VERIFICATION_AGE_DAYS}-day window`);
    }
  }

  if (problems.length) {
    console.log(`RESULT: FAIL (${problems.length} problem(s))`);
    problems.forEach(problem => console.log(`  - ${problem}`));
    process.exit(1);
  }
  if (update) {
    for (const approval of Object.values(approvals)) approval.lastVerifiedAt = today;
    fs.writeFileSync(FILE, JSON.stringify(approvals, null, 2) + '\n');
  }
  const uniquePosts = new Set(Object.values(approvals).map(approval => approval.postId)).size;
  const uniqueActivities = new Set(Object.values(approvals).map(approval => approval.activityId)).size;
  console.log(`Peter mappings: ${entries.length}; unique posts: ${uniquePosts}; unique activity statuses: ${uniqueActivities}; first-party hydrations: ${statusCache.size}; oEmbed cross-checks: ${oembedCache.size}`);
  console.log(`RESULT: PASS — every reviewed Peter status hydrates through X first-party JSON and every @peterxing activity relationship cross-checks through oEmbed${update ? `; lastVerifiedAt updated to ${today}` : ''}.`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
