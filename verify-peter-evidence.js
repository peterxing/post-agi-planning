'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'evidence-approvals.json');
const approvals = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''));
const problems = [];
const update = process.argv.includes('--update');
const MAX_VERIFICATION_AGE_DAYS = 30;

async function resolveStatus(url) {
  const endpoint = `https://publish.x.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`;
  const response = await fetch(endpoint, {
    headers: { 'User-Agent': 'pap-peter-evidence-verifier/1.0' },
  });
  if (!response.ok) return { status: response.status, id: null, handle: null };
  const data = await response.json();
  return {
    status: response.status,
    id: String(data.url || '').match(/status\/(\d{15,})/)?.[1] || null,
    handle: String(data.author_url || '').match(/x\.com\/([A-Za-z0-9_]+)/)?.[1] || null,
  };
}

(async () => {
  const entries = Object.entries(approvals);
  const today = new Date().toISOString().slice(0, 10);
  for (let index = 0; index < entries.length; index += 5) {
    const batch = entries.slice(index, index + 5);
    const checks = await Promise.all(batch.map(async ([predictionId, approval]) => {
      const original = await resolveStatus(approval.publicUrl);
      const activityUrl = `https://x.com/peterxing/status/${approval.activityId}`;
      const activity = await resolveStatus(activityUrl);
      return { predictionId, approval, original, activity };
    }));
    for (const { predictionId, approval, original, activity } of checks) {
      if (original.status !== 200
          || original.id !== String(approval.postId)
          || original.handle?.toLowerCase() !== approval.author.toLowerCase()) {
        problems.push(`${predictionId}: original status no longer resolves to @${approval.author}/${approval.postId}`);
      }
      if (activity.status !== 200
          || activity.id !== String(approval.activityId)
          || activity.handle?.toLowerCase() !== 'peterxing') {
        problems.push(`${predictionId}: @peterxing activity status no longer resolves to ${approval.activityId}`);
      }
      const verifiedAt = new Date(`${approval.lastVerifiedAt}T00:00:00Z`);
      const ageDays = (Date.now() - verifiedAt.getTime()) / 864e5;
      if (isNaN(verifiedAt.getTime()) || ageDays < -1 || ageDays > MAX_VERIFICATION_AGE_DAYS) {
        problems.push(`${predictionId}: lastVerifiedAt is outside the ${MAX_VERIFICATION_AGE_DAYS}-day window`);
      }
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
  console.log(`Peter mappings: ${entries.length}; unique posts: ${uniquePosts}; unique activity statuses: ${uniqueActivities}; live checks: ${entries.length * 2}`);
  console.log(`RESULT: PASS — every reviewed Peter status and @peterxing activity relationship resolves live${update ? `; lastVerifiedAt updated to ${today}` : ''}.`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
