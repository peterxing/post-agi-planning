'use strict';

const fs = require('fs');
const path = require('path');
const {
  CORPUS_FILE,
  DISCOVERY_FILE,
  STATUS_PACE_MS,
  WAYBACK_PATTERNS,
  loadCorpus,
} = require('./x-archive');

const DIR = __dirname;
const SITE = 'C:\\Users\\peterxing\\pap-site';
const GIT = 'C:\\Users\\peterxing\\pap-github';
const signals = JSON.parse(fs.readFileSync(path.join(DIR, 'signals.json'), 'utf8').replace(/^\uFEFF/, ''));
const refreshSource = fs.readFileSync(path.join(DIR, 'refresh-signals.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(DIR, 'server.js'), 'utf8');
const publisherSource = fs.readFileSync(path.join(DIR, 'publish-github.ps1'), 'utf8');
const discovery = JSON.parse(fs.readFileSync(DISCOVERY_FILE, 'utf8').replace(/^\uFEFF/, ''));
const corpus = loadCorpus();
const problems = [];
const secretDir = path.dirname(CORPUS_FILE);

if (!CORPUS_FILE.toLowerCase().startsWith('c:\\users\\peterxing\\pap-secrets\\')
    || !DISCOVERY_FILE.toLowerCase().startsWith('c:\\users\\peterxing\\pap-secrets\\')) {
  problems.push('archive corpus and discovery cache must stay under pap-secrets');
}
for (const root of [DIR, SITE, GIT]) {
  const privateFiles = fs.existsSync(root)
    ? fs.readdirSync(root).filter(file => /^x-(?:status-corpus|wayback|external-account).*\.json$/i.test(file))
    : [];
  for (const file of privateFiles) {
    problems.push(`${file} leaked into ${root}`);
  }
}
if (!Array.isArray(discovery.ids) || discovery.ids.length < 1000
    || new Set(discovery.ids).size !== discovery.ids.length
    || !discovery.ids.every(id => /^\d{15,}$/.test(String(id)))) {
  problems.push('Wayback discovery cache is incomplete, duplicated or malformed');
}
if (!Array.isArray(discovery.sources) || discovery.sources.length !== WAYBACK_PATTERNS.length
    || !WAYBACK_PATTERNS.every(pattern => discovery.sources.some(source =>
      source.pattern === pattern && source.pages > 0 && source.pagesRead > 0))) {
  problems.push('Wayback discovery must cover both hosts and both handle case variants with pagination');
}
const verified = corpus.items.filter(item => item.verifiedAt);
const authored = verified.filter(item => ['authored','quote','reply'].includes(item.kind));
const reposted = verified.filter(item => item.kind === 'repost');
if (verified.length < 100 || !authored.length || !reposted.length) {
  problems.push('private corpus lacks a substantial verified authored/repost mix');
}
if (STATUS_PACE_MS < 600 || Number(corpus.metadata.verification?.statusPaceMs) < 600) {
  problems.push('first-party status hydration pace must remain at least 600 ms');
}
const externalAccountFiles = fs.readdirSync(secretDir)
  .filter(file => /^x-external-account-[a-z0-9_]+\.json$/i.test(file));
if (externalAccountFiles.length < 3) {
  problems.push('reviewed external-account discovery caches are missing');
}
for (const file of externalAccountFiles) {
  const accountCorpus = JSON.parse(fs.readFileSync(path.join(secretDir, file), 'utf8').replace(/^\uFEFF/, ''));
  if (!accountCorpus.account || Number(accountCorpus.discovery?.count) <= 0
      || Number(accountCorpus.verification?.statusPaceMs) < 600
      || !Array.isArray(accountCorpus.items) || !accountCorpus.items.length
      || accountCorpus.items.some(item => !item.verifiedAt
        || !item.verification?.tweetResult
        || item.verification?.statusOembed !== true
        || item.verification?.activityOembed !== true)) {
    problems.push(`${file}: external-account discovery/hydration cache is incomplete`);
  }
}
if (verified.some(item => !/^\d{15,}$/.test(String(item.activityId || ''))
    || !/^\d{15,}$/.test(String(item.statusId || ''))
    || !item.author || !item.createdAt || !item.text || !item.verifiedAt
    || !['authored','quote','reply','repost'].includes(item.kind)
    || !item.verification?.tweetResult || item.verification?.statusOembed !== true
    || item.verification?.activityOembed !== true)) {
  problems.push('verified corpus contains incomplete first-party/oEmbed provenance');
}
if (signals.source !== 'archive-verified' || signals.sourceFresh !== true
    || signals.sourceStatus?.mode !== 'archive-verified'
    || signals.sourceStatus?.primarySource !== 'first-party-status'
    || Number(signals.sourceStatus?.verificationPaceMs) < 600
    || !Array.isArray(signals.sourceAttempts)
    || !['wayback-cdx','tweet-result','x-oembed'].every(source =>
      signals.sourceAttempts.some(attempt => attempt.source === source))) {
  problems.push('signals.json does not expose the archive-verified source chain honestly');
}
if (/https:\/\/nitter\.net\/peterxing\/rss|timeline-profile\/screen-name\/peterxing|RSS_URL|SYND_URL/.test(refreshSource)) {
  problems.push('refresh-signals.js still depends on a dead bulk profile endpoint');
}
if (!/bulk-profile-feeds[\s\S]{0,120}disabled-unavailable/.test(refreshSource)) {
  problems.push('refresh-signals.js must record dead bulk feeds as disabled diagnostics');
}
if (!/Default-deny/.test(serverSource) || /ALLOW_FILES[\s\S]{0,400}x-archive\.js/.test(serverSource)) {
  problems.push('server.js must not serve archive operational code');
}
if (!publisherSource.includes("'x-archive.js'")
    || !publisherSource.includes("'verify-archive-corpus.js'")
    || !/x-status-corpus\|x-wayback\|x-external-account/.test(publisherSource)) {
  problems.push('publisher allow/deny rules do not preserve archive source without exposing private caches');
}

console.log(`Discovery IDs: ${discovery.ids.length}; verified corpus: ${verified.length}; authored/quote/reply: ${authored.length}; reposted: ${reposted.length}; external account corpora: ${externalAccountFiles.length}; hydration pace: ${STATUS_PACE_MS}ms`);
if (problems.length) {
  console.log(`RESULT: FAIL (${problems.length} problem(s))`);
  problems.forEach(problem => console.log(`  - ${problem}`));
  process.exit(1);
}
console.log('RESULT: PASS — Wayback discovery, private corpus isolation, first-party hydration, oEmbed cross-checks and archive source metadata are complete.');
