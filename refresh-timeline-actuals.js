'use strict';
if (require.main === module) require('./pipeline-lock').guard('refresh:timeline');

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { NEWS_SOURCES, verifyNewsSource, normalizeUrl } = require('./news-evidence');
const sha = value => createHash('sha256').update(value).digest('hex');
const need = (condition, message) => { if (!condition) throw new Error(`Timeline actuals: ${message}`); };
const day = value => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const text = (value, max = 1600) => typeof value === 'string' && value.trim().length >= 12 && value.length <= max;
const topics = new Set(['capabilities', 'compute', 'work', 'safety', 'governance']);

function newsIdentity(bundle) {
  const rows = [...Object.entries(bundle.embeds || {}), ...Object.entries(bundle.context?.items || {})]
    .map(([id, row]) => [id, row.url, row.headline, row.publisher, row.byline, row.articleDate,
      row.provenance?.publishedAt, row.quote || row.text, row.mappingRationale, row.evidenceType]);
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return sha(JSON.stringify(rows));
}
function actualsMetadata(previous, next, now) {
  const digest = newsIdentity(next), changed = digest !== newsIdentity(previous);
  return { schemaVersion:1, checkedAt:now, contentSha256:digest,
    contentChangedAt:changed ? now : previous.actualsRefresh?.contentChangedAt || null,
    status:next.sourceFresh ? 'checked' : 'partial',
    note:changed ? 'Reviewed NEWS content changed; publication dates are preserved.'
      : 'Existing reviewed NEWS is unchanged. A source check is not a new reported event.' };
}
/* Actuals-only exception approved by the owner: a stale X layer may be carried forward unchanged only
   when the exact bytes were first published alongside the exact current full forecast set while
   still inside the freshness ceiling. The binding comes from the published mirror history, never
   from a digest minted from today's forecasts. Every other case keeps the producer's refusal. */
const X_FILE = 'x-signals.json';
function mirrorHistory(checkout, branch = 'origin/main') {
  const { execFileSync } = require('node:child_process');
  const readOnly = new Set(['rev-parse', 'log', 'show', 'merge-base']);
  const git = args => {
    need(readOnly.has(args[0]), `refusing non-read git ${args[0]}.`);
    return execFileSync('git', ['-C', checkout, ...args], { maxBuffer:1 << 28, timeout:30000, windowsHide:true, stdio:['ignore', 'pipe', 'pipe'] });
  };
  return {
    head:() => git(['rev-parse', '--verify', 'HEAD^{commit}']).toString().trim(),
    commits:file => git(['log', '--format=%H', '--reverse', 'HEAD', '--', file]).toString().split(/\s+/).filter(Boolean),
    read:(commit, file) => { try { return git(['show', `${commit}:${file}`]); } catch { return null; } },
    published:commit => { try { git(['merge-base', '--is-ancestor', commit, branch]); return true; } catch { return false; } },
  };
}
function retainStaleXSnapshot({ raw, payload, previous, forecastSha256, buildNow, maxAgeDays, history }) {
  const refuse = message => { throw new Error(`Stale X preservation refused: ${message}`); };
  const summary = payload?.summary, signals = payload?.signals;
  if (!summary || !signals || typeof signals !== 'object') refuse('x-signals.json is malformed.');
  const builtAt = Date.parse(summary.builtAt), harvestedAt = Date.parse(summary.harvestedAt);
  if (!Number.isFinite(builtAt) || !Number.isFinite(harvestedAt)) refuse('builtAt/harvestedAt are not valid timestamps.');
  if (builtAt > buildNow || harvestedAt > builtAt) refuse('the snapshot is future-dated or was harvested after it was built.');
  for (const [id, signal] of Object.entries(signals)) {
    const created = Date.parse(signal?.created);
    if (!Number.isFinite(created) || created > harvestedAt) refuse(`signal ${id} has a missing or future post date.`);
  }
  if (!/^[a-f0-9]{64}$/.test(forecastSha256 || '')) refuse('the current full-forecast fingerprint is unavailable.');
  const layer = JSON.stringify({ summary, items:signals }), bytes = sha(raw);
  if (!previous?.xSignals || JSON.stringify(previous.xSignals) !== layer) refuse('the last-good published X layer is absent or differs from x-signals.json.');
  if (previous.forecastVersion?.sha256 !== forecastSha256) refuse('the last-good forecast fingerprint differs from the current forecasts.');
  let head, commits;
  try { head = history.head(); commits = history.commits(X_FILE); }
  catch (error) { refuse(`the published mirror history is unavailable (${error.message}).`); }
  const same = commit => { const blob = history.read(commit, X_FILE); return !!blob && sha(blob) === bytes; };
  if (!same(head)) refuse('the published mirror does not carry these exact X bytes.');
  const pairedCommit = commits.find(same);
  if (!pairedCommit || !history.published(pairedCommit)) refuse('no published snapshot binds these exact X bytes to a forecast set.');
  let pairedSignals, pairedForecast;
  try {
    pairedSignals = JSON.parse(history.read(pairedCommit, 'signals.json').toString('utf8').replace(/^\uFEFF/, ''));
    pairedForecast = sha(JSON.stringify(JSON.parse(history.read(pairedCommit, 'predictions.json').toString('utf8').replace(/^\uFEFF/, ''))));
  } catch { refuse(`the paired snapshot ${pairedCommit} is incomplete or corrupt.`); }
  if (JSON.stringify(pairedSignals.xSignals) !== layer) refuse('the paired snapshot did not publish this exact X layer.');
  const pairedAt = Date.parse(pairedSignals.updated);
  if (!Number.isFinite(pairedAt) || pairedAt < builtAt || pairedAt - builtAt > maxAgeDays * 864e5)
    refuse('the paired snapshot was not published while the X layer was inside its freshness ceiling.');
  if (pairedForecast !== forecastSha256 || (pairedSignals.forecastVersion && pairedSignals.forecastVersion.sha256 !== forecastSha256))
    refuse('the full forecast set changed, was reordered or lost entries since the X layer was paired.');
  const ageDays = Math.floor((buildNow - builtAt) / 864e5);
  return { schemaVersion:1, mode:'stale-snapshot-retained', builtAt:summary.builtAt, harvestedAt:summary.harvestedAt,
    ageDays, maxAgeDays, checkedAt:new Date(buildNow).toISOString(), xSignalsSha256:bytes, forecastSha256,
    pairedCommit, pairedPublishedAt:pairedSignals.updated,
    note:`Stale X snapshot retained unchanged: assembled ${summary.builtAt.slice(0, 10)}, ${ageDays} days before this check and beyond the ${maxAgeDays}-day refresh ceiling. The complete forecast set is identical to the published snapshot it was paired with, so no post, date, metric or assignment changed. It has not been re-verified; X remains discussion, never evidence.` };
}
function parsePage(html) {
  const matches = [...html.matchAll(/(<script type="application\/json" id="timelineData">)([\s\S]*?)(<\/script>)/g)];
  need(matches.length === 1, 'exactly one embedded companion dataset is required.');
  return JSON.parse(matches[0][2]);
}
function contentIdentity(data) {
  const plain = item => Object.fromEntries(Object.entries(item)
    .filter(([key]) => !['checkedAt', 'reviewedAt', 'textSha256'].includes(key)));
  return sha(JSON.stringify({ sources:data.sources.map(plain), events:data.events.map(plain) }));
}
class SourceCheckError extends Error {}

async function applyReview(previous, review, { now = new Date().toISOString(), sources = NEWS_SOURCES,
  verify = (key, source, options) => verifyNewsSource(key, source, options), browserTransport } = {}) {
  const today = now.slice(0, 10);
  need(review?.schemaVersion === 1 && review.reviewedBy === 'Owner-authorized editorial review',
    'a separately reviewed companion mapping is required.');
  need(day(review.windowStart) && day(review.windowEnd) && review.windowStart <= review.windowEnd
    && review.windowEnd <= today && Date.parse(review.windowEnd) - Date.parse(review.windowStart) <= 31 * 86400000,
    'invalid bounded discovery window.');
  need(text(review.summary) && review.checkpointSha256 === sha(JSON.stringify(previous.checkpoints)),
    'missing discovery summary or scenario identity changed.');
  need(Array.isArray(review.checkedSources) && review.checkedSources.length > 0
    && review.checkedSources.length <= 12 && new Set(review.checkedSources).size === review.checkedSources.length
    && review.checkedSources.every(key => Object.hasOwn(sources, key)), 'checks must name 1-12 existing reviewed NEWS source keys.');
  need(Array.isArray(review.entries) && review.entries.length <= 12, 'bounded reviewed event list required.');
  const checkpoints = new Set(previous.checkpoints.map(item => item.id));
  const ids = new Set();
  for (const entry of review.entries) {
    need(entry && /^[a-z0-9-]+$/.test(entry.id) && !ids.has(entry.id), 'invalid or duplicated event identity.');
    ids.add(entry.id);
    need(['add', 'update'].includes(entry.action) && review.checkedSources.includes(entry.sourceKey),
      'each entry needs an explicit action and a checked canonical NEWS source.');
    const existing = previous.events.find(item => item.id === entry.id);
    need(entry.action === 'add' ? !existing : Boolean(existing) && text(entry.correctionNote),
      'existing events require an explicit correction note, never a silent replacement.');
    need(text(entry.title, 220) && text(entry.summary) && text(entry.limitation)
      && Array.isArray(entry.topics) && entry.topics.length && entry.topics.every(topic => topics.has(topic)),
      'event summary, limitations and valid topics required.');
    need(Array.isArray(entry.maps) && entry.maps.length > 0 && entry.maps.length <= 5
      && new Set(entry.maps.map(mapping => mapping.checkpoint)).size === entry.maps.length
      && entry.maps.every(mapping => checkpoints.has(mapping.checkpoint) && text(mapping.note)),
      'each companion relationship must be reviewed independently of canonical forecast mappings.');
    const source = sources[entry.sourceKey];
    need(day(source.publishedAt?.slice(0, 10)) && source.publishedAt.slice(0, 10) <= today,
      'source publication date is invalid or future-dated.');
    if (existing) {
      const prior = previous.sources.find(item => item.id === existing.source);
      need(normalizeUrl(prior.url) === normalizeUrl(source.resolvedUrl), 'a correction cannot substitute an unrelated source.');
      if (Object.hasOwn(entry, 'date')) need(entry.date === existing.date, 'original event dates cannot be redated by a refresh.');
    } else if (Object.hasOwn(entry, 'date')) {
      need(entry.date === source.publishedAt.slice(0, 10), 'new entries use the verified publication date, not an inferred occurrence date.');
    }
  }
  for (const key of review.checkedSources) {
    const source = sources[key];
    const result = await verify(key, source, { requireStableText:true, browserTransport });
    if (!result.fetched?.ok || !Array.isArray(result.problems) || result.problems.length || !result.extracted
      || result.extracted.textSha256 !== source.textSha256) {
      throw new SourceCheckError(`Source ${key} could not be reverified: ${(result.problems || []).join('; ') || 'missing source receipt'}`);
    }
  }
  const next = structuredClone(previous);
  for (const source of next.sources)
    if (review.checkedSources.includes(source.canonicalNewsSource)) source.checkedAt = now;
  for (const entry of review.entries) {
    const source = sources[entry.sourceKey], url = normalizeUrl(source.resolvedUrl);
    const existing = next.events.find(item => item.id === entry.id);
    const priorSource = next.sources.find(item => normalizeUrl(item.url) === url);
    need(!priorSource || existing?.source === priorSource.id, 'duplicate article: update the existing event instead of counting it twice.');
    const sourceId = priorSource?.id || `news-${entry.sourceKey}`;
    const record = { id:sourceId, publisher:source.publisher, kind:'Reviewed original NEWS',
      title:source.headline, url:source.resolvedUrl, published:source.publishedAt.slice(0, 10),
      dateNote:'Original publisher date verified through the canonical NEWS ledger. Check time is recorded separately.',
      reviewedAt:today, checkedAt:now, canonicalNewsSource:entry.sourceKey, textSha256:source.textSha256 };
    if (priorSource) Object.assign(priorSource, record); else next.sources.push(record);
    const event = { id:entry.id, date:existing?.date || record.published, type:existing?.type || 'Report published',
      topics:entry.topics, title:entry.title, summary:entry.summary, limitation:entry.limitation,
      source:sourceId, maps:entry.maps, reviewedAt:today };
    if (existing) {
      Object.assign(existing, event);
      existing.corrections = [...(existing.corrections || []), { reviewedAt:today, note:entry.correctionNote }];
    } else next.events.push(event);
  }
  const changed = contentIdentity(next) !== contentIdentity(previous);
  if (changed) next.reviewedAt = today;
  next.actualsCheck = { status:changed ? 'updated' : 'checked', attemptedAt:now, checkedAt:now,
    contentChangedAt:changed ? now : previous.actualsCheck?.contentChangedAt || null,
    checkedSourceIds:[...review.checkedSources], windowStart:review.windowStart, windowEnd:review.windowEnd,
    summary:`${review.checkedSources.length} selected canonical NEWS sources reverified. ${review.summary} `
      + (changed ? 'Reviewed companion records changed.' : 'No new or changed companion facts. Original source and event dates retained.') };
  need(JSON.stringify(next.checkpoints) === JSON.stringify(previous.checkpoints)
    && JSON.stringify(next.branches) === JSON.stringify(previous.branches), 'scenario text or assumptions changed.');
  return next;
}
function serializePage(html, data) {
  return html.replace(/(<script type="application\/json" id="timelineData">)[\s\S]*?(<\/script>)/,
    (_, start, end) => start + '\n' + JSON.stringify(data, null, 2).replace(/</g, '\\u003c') + '\n  ' + end);
}
function writePage(file, original, data) {
  need(fs.readFileSync(file, 'utf8') === original, 'page changed during review; refusing to overwrite another writer.');
  const output = serializePage(original, data);
  need(Buffer.byteLength(output) < 180000, 'companion exceeds its existing budget; retain history and request review, do not prune facts.');
  const temporary = file + `.${process.pid}.tmp`;
  let owned = false;
  try {
    fs.writeFileSync(temporary, output, { flag:'wx' }); owned = true;
    fs.renameSync(temporary, file);
  } finally {
    if (owned && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
async function main() {
  const argument = process.argv.find(value => value.startsWith('--review='));
  need(argument, 'usage: node refresh-timeline-actuals.js --review=ABSOLUTE_REVIEW_JSON [--dry-run]. No implicit source promotion.');
  const reviewPath = argument.slice(9);
  need(path.isAbsolute(reviewPath) && path.extname(reviewPath) === '.json', 'review must be an explicit absolute JSON path.');
  const file = path.join(__dirname, 'ai-timeline.html'), html = fs.readFileSync(file, 'utf8');
  const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
  need(review.expectedPageSha256 === sha(html), 'review is bound to a different page; re-review before applying.');
  const data = parsePage(html);
  let session;
  try {
    if (review.checkedSources?.some(key => NEWS_SOURCES[key]?.transport === 'browser'))
      session = await require('./browse-transport').openBrowser();
    const browserTransport = session ? require('./browse-transport').createTransport(session.context) : undefined;
    const next = await applyReview(data, review, { browserTransport });
    if (!process.argv.includes('--dry-run')) writePage(file, html, next);
    console.log(JSON.stringify({ dryRun:process.argv.includes('--dry-run'), ...next.actualsCheck, events:next.events.length }));
  } catch (error) {
    if (error instanceof SourceCheckError && !process.argv.includes('--dry-run')) {
      data.actualsCheck = { ...data.actualsCheck, status:'failed', attemptedAt:new Date().toISOString(), summary:error.message };
      writePage(file, html, data);
    }
    throw error;
  } finally { if (session) await session.close(); }
}
module.exports = { newsIdentity, actualsMetadata, mirrorHistory, retainStaleXSnapshot, parsePage, contentIdentity, applyReview, serializePage, SourceCheckError };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
