'use strict';
if (require.main === module) require('./pipeline-lock').guard('refresh-metr');

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const YAML = require('yaml');

const SOURCE = 'https://metr.org/assets/benchmark_results_1_1.yaml';
const METHOD = 'https://metr.org/time-horizons/';
const UNIT_REFERENCE = 'https://metr.org/assets/js/time-horizon-chart.js';
const BENCHMARK = 'METR-Horizon-v1.1';
// Reviewed 2026-09-05 UTC+10: the official chart divides both horizon fields by 60
// to display hours, and labels their intervals "95% CI". YAML does not declare units.
const UNIT = 'human-expert minutes';
const CONTEXT_TEXT = 'Frontier agents reliably complete multi-hour computer workflows with human review, while monitored research systems can persist for days or weeks and require trajectory-level safeguards';
const sha = value => createHash('sha256').update(value).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value)
  && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + 300000;

class SourceError extends Error {
  constructor(message, retryable = false, retryAt = null) {
    super(message);
    this.retryable = retryable;
    this.retryAt = retryAt;
  }
}
function requireValue(condition, message) {
  if (!condition) throw new SourceError(message);
}
function interval(value) {
  requireValue(object(value) && ['estimate', 'ci_low', 'ci_high'].every(key =>
    typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] > 0),
  'METR interval requires finite positive numbers');
  requireValue(value.ci_low <= value.estimate && value.estimate <= value.ci_high, 'METR interval order is invalid');
  return { estimate:value.estimate, ci_low:value.ci_low, ci_high:value.ci_high };
}
function normalize(text) {
  let doc;
  try {
    const parsed = YAML.parseDocument(text, { uniqueKeys:true, schema:'core' });
    requireValue(!parsed.errors.length && !parsed.warnings.length, 'METR YAML is malformed or has unsupported tags');
    doc = parsed.toJS({ maxAliasCount:0 });
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError('METR YAML cannot be parsed safely');
  }
  requireValue(object(doc) && doc.benchmark_name === BENCHMARK, 'METR benchmark version changed; review required');
  requireValue(doc.unit === undefined || doc.unit === 'minutes', 'METR unit changed; review required');
  requireValue(doc.units === undefined || doc.units === 'minutes', 'METR units changed; review required');
  requireValue(['long_tasks_version', 'swaa_version'].every(key => /^[a-f0-9]{40}$/.test(doc[key] || '')),
    'METR task revision identifiers are missing');
  requireValue(object(doc.results) && Object.keys(doc.results).length > 0 && Object.keys(doc.results).length <= 200,
    'METR result roster is missing or oversized');
  let excludedLegacy = 0;
  const records = [];
  for (const [id, row] of Object.entries(doc.results)) {
    requireValue(/^[a-zA-Z0-9_-]{1,120}$/.test(id) && object(row), 'METR model identifier is invalid');
    requireValue([BENCHMARK, 'METR-Horizon-v1.0'].includes(row.benchmark_name), 'METR row benchmark is unknown');
    requireValue(row.unit === undefined || row.unit === 'minutes', 'METR row unit changed');
    requireValue(/^\d{4}-\d\d-\d\d$/.test(row.release_date || '')
      && Number.isFinite(Date.parse(row.release_date))
      && new Date(row.release_date).toISOString().slice(0, 10) === row.release_date
      && Date.parse(row.release_date) <= Date.now(), 'METR model release date is invalid');
    requireValue(Array.isArray(row.scaffolds) && row.scaffolds.length > 0 && row.scaffolds.length <= 30
      && row.scaffolds.every(value => value === null || (typeof value === 'string' && value.length > 0 && value.length <= 250)),
    'METR scaffolds are missing or invalid');
    const p50 = interval(row.metrics?.p50_horizon_length);
    const p80 = interval(row.metrics?.p80_horizon_length);
    requireValue(p80.estimate <= p50.estimate, 'METR reliability horizons are inconsistent');
    if (row.benchmark_name !== BENCHMARK) { excludedLegacy++; continue; }
    records.push({ id, releaseDate:row.release_date, scaffolds:row.scaffolds, p50, p80 });
  }
  requireValue(records.length > 0, 'METR has no records for the reviewed benchmark');
  records.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.id.localeCompare(b.id));
  return { benchmark:BENCHMARK, unit:UNIT, intervalLevel:0.95,
    longTasksVersion:doc.long_tasks_version, swaaVersion:doc.swaa_version, excludedLegacy, records };
}
function validateSnapshot(snapshot) {
  requireValue(object(snapshot) && /^[a-f0-9]{64}$/.test(snapshot.sha256 || '')
    && iso(snapshot.retrievedAt) && snapshot.publishedAt === null && snapshot.measuredAt === null,
  'METR snapshot provenance is invalid');
  requireValue(snapshot.benchmark === BENCHMARK && snapshot.unit === UNIT && snapshot.intervalLevel === 0.95,
    'METR snapshot version or units are invalid');
  requireValue(snapshot.etag === null || (typeof snapshot.etag === 'string' && snapshot.etag.length <= 512
    && !/[\r\n]/.test(snapshot.etag)), 'METR ETag is invalid');
  requireValue(snapshot.lastModified === null || (typeof snapshot.lastModified === 'string'
    && Number.isFinite(Date.parse(snapshot.lastModified))
    && iso(new Date(snapshot.lastModified).toISOString())), 'METR Last-Modified is invalid');
  requireValue(snapshot.excludedLegacy >= 0 && Number.isInteger(snapshot.excludedLegacy)
    && Array.isArray(snapshot.records), 'METR snapshot roster is invalid');
  // Reuse the source validator; persisted snapshots cannot bypass numeric/schema checks.
  const normalized = normalize(YAML.stringify({
    benchmark_name:snapshot.benchmark, unit:'minutes',
    long_tasks_version:snapshot.longTasksVersion, swaa_version:snapshot.swaaVersion,
    results:Object.fromEntries(snapshot.records.map(row => [row.id, {
      benchmark_name:snapshot.benchmark, release_date:row.releaseDate, scaffolds:row.scaffolds,
      metrics:{ p50_horizon_length:row.p50, p80_horizon_length:row.p80 },
    }])),
  }));
  requireValue(normalized.records.length === snapshot.records.length, 'METR snapshot has duplicate model identifiers');
}
function validateState(state) {
  requireValue(object(state) && state.schemaVersion === 1 && state.sourceUrl === SOURCE && state.methodologyUrl === METHOD
    && state.unitReference === UNIT_REFERENCE && ['ok', 'error', 'unavailable'].includes(state.status), 'METR state schema is invalid');
  requireValue(state.lastCheckedAt === null || iso(state.lastCheckedAt), 'METR check timestamp is invalid');
  requireValue(state.retryAt === null || (typeof state.retryAt === 'string' && Number.isFinite(Date.parse(state.retryAt))),
    'METR retry timestamp is invalid');
  requireValue(state.status === 'ok' ? state.error === null : typeof state.error === 'string', 'METR health status is invalid');
  requireValue(state.previous === null || object(state.previous), 'METR previous snapshot is invalid');
  if (state.current) {
    validateSnapshot(state.current);
    requireValue(state.lastSuccessfulFetchAt === state.current.retrievedAt
      && Date.parse(state.lastCheckedAt) >= Date.parse(state.lastSuccessfulFetchAt), 'METR collection timestamps disagree');
  } else requireValue(state.current === null && state.previous === null && state.lastSuccessfulFetchAt === null
    && state.status !== 'ok', 'METR empty source must remain unavailable');
  if (state.previous) {
    validateSnapshot(state.previous);
    requireValue(Date.parse(state.previous.retrievedAt) <= Date.parse(state.current.retrievedAt), 'METR snapshot chronology is invalid');
  }
}
function emptyState() {
  return { schemaVersion:1, sourceUrl:SOURCE, methodologyUrl:METHOD, unitReference:UNIT_REFERENCE,
    status:'unavailable', error:'METR has not been collected.', lastCheckedAt:null,
    lastSuccessfulFetchAt:null, retryAt:null, current:null, previous:null };
}
function changes(state) {
  const a = state.previous, b = state.current;
  if (!a || !b) return 'First collection: no site change history yet.';
  if (a.benchmark !== b.benchmark || a.longTasksVersion !== b.longTasksVersion || a.swaaVersion !== b.swaaVersion) {
    return 'Task revisions changed; snapshots are not comparable.';
  }
  const old = new Map(a.records.map(row => [row.id, row]));
  let added = 0, changed = 0, setupChanged = 0;
  for (const row of b.records) {
    const prior = old.get(row.id);
    if (!prior) { added++; continue; }
    old.delete(row.id);
    if (JSON.stringify(prior.scaffolds) !== JSON.stringify(row.scaffolds)) { setupChanged++; continue; }
    if (JSON.stringify([prior.p50, prior.p80]) !== JSON.stringify([row.p50, row.p80])) changed++;
  }
  return `Since collection ${a.retrievedAt}: ${added} added, ${old.size} removed, ${changed} revised model measurements; ${setupChanged} changed scaffolds (not compared).`;
}
function bindState(state, predictions) {
  const value = state || emptyState();
  validateState(value);
  const text = predictions.years.find(year => year.year === 2026)?.events[0]?.t;
  return { ...value, changeSummary:changes(value), context:text === CONTEXT_TEXT ? {
    id:'2026-0', textSha256:sha(CONTEXT_TEXT), forecastSha256:sha(JSON.stringify(predictions)),
    role:'Context only: software-task capability, not human-reviewed workflows, monitored runtime or safeguards. No forecast milestone is assessed.',
  } : null };
}
function retryTime(header, now) {
  if (!header) return null;
  const time = /^\d+$/.test(header) ? now + Number(header) * 1000 : Date.parse(header);
  return Number.isFinite(new Date(time).getTime()) && time > now ? new Date(time).toISOString() : null;
}
async function requestSource(state, { fetchImpl = fetch, timeoutMs = 12000, maxBytes = 262144 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { Accept:'application/yaml, text/yaml, text/plain', 'User-Agent':'Post-AGI-Planning-METR/1.0' };
  if (state.current?.etag) headers['If-None-Match'] = state.current.etag;
  else if (state.current?.lastModified) headers['If-Modified-Since'] = state.current.lastModified;
  try {
    let url = SOURCE;
    for (let redirects = 0; redirects <= 2; redirects++) {
      requireValue(url === SOURCE, 'METR redirect left the exact approved source');
      const response = await fetchImpl(url, { headers, signal:controller.signal, redirect:'manual' });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        requireValue(location, 'METR redirect has no destination');
        url = new URL(location, url).href;
        continue;
      }
      if (response.status === 304) {
        requireValue(Boolean(state.current), 'METR returned 304 without a stored snapshot');
        return { unchanged:true };
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new SourceError(`METR source returned HTTP ${response.status}`, response.status === 429 || response.status >= 500,
          retryTime(response.headers.get('retry-after'), Date.now()));
      }
      requireValue(Number(response.headers.get('content-length')) <= maxBytes, 'METR response exceeds size limit');
      requireValue(response.body, 'METR response body is missing');
      const reader = response.body.getReader();
      const chunks = [];
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          requireValue(length <= maxBytes, 'METR response exceeds size limit');
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel(); }
      const body = Buffer.concat(chunks);
      const normalized = normalize(new TextDecoder('utf-8', { fatal:true }).decode(body));
      return { normalized, sha256:sha(body), etag:response.headers.get('etag'), lastModified:response.headers.get('last-modified') };
    }
    throw new SourceError('METR redirect limit exceeded');
  } catch (error) {
    if (error instanceof SourceError) throw error;
    if (controller.signal.aborted) throw new SourceError('METR source request timed out', true);
    if (error instanceof TypeError) throw new SourceError('METR source transport or encoding failed', true);
    throw error;
  } finally { clearTimeout(timer); }
}
async function collect(previous, options = {}) {
  const state = previous || emptyState();
  validateState(state);
  if (state.retryAt && Date.parse(state.retryAt) > Date.now()) return state;
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await requestSource(state, options);
      const checked = new Date().toISOString();
      if (result.unchanged) return { ...state, status:'ok', error:null, retryAt:null, lastCheckedAt:checked };
      const current = { ...result.normalized, sha256:result.sha256, etag:result.etag,
        lastModified:result.lastModified, retrievedAt:checked, publishedAt:null, measuredAt:null };
      validateSnapshot(current);
      return { ...state, status:'ok', error:null, retryAt:null, lastCheckedAt:checked,
        lastSuccessfulFetchAt:checked, current, previous:state.current };
    } catch (error) {
      if (!(error instanceof SourceError)) throw error;
      if (error.retryable && !error.retryAt && attempt < 2) { await sleep(1000 * 2 ** attempt); continue; }
      return { ...state, status:state.current ? 'error' : 'unavailable', error:error.message,
        lastCheckedAt:new Date().toISOString(), retryAt:error.retryAt };
    }
  }
}
function attach(bundle, state, predictions) {
  requireValue(bundle.forecastVersion?.schemaVersion === 1 && bundle.forecastVersion.sha256 === sha(JSON.stringify(predictions)),
    'Forecast and published bundle disagree; refusing METR-only update');
  return { ...bundle, capabilities:{ ...bundle.capabilities, metr:bindState(state, predictions) } };
}
function atomicWrite(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  let fd, created = false;
  try {
    fd = fs.openSync(temp, 'wx');
    created = true;
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (created && fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
async function main() {
  const file = path.join(__dirname, 'signals.json');
  const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
  const predictions = JSON.parse(fs.readFileSync(path.join(__dirname, 'predictions.json'), 'utf8'));
  const state = await collect(bundle.capabilities?.metr);
  atomicWrite(file, attach(bundle, state, predictions));
  console.log(`METR ${state.status}: ${state.current?.records.length || 0} ${BENCHMARK} records; checked ${state.lastCheckedAt}; fetched ${state.lastSuccessfulFetchAt || 'never'}.`);
  console.log(state.error || `Source SHA-256 ${state.current.sha256}; ${changes(state)}`);
  if (state.status !== 'ok') process.exitCode = 10;
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { SOURCE, METHOD, BENCHMARK, UNIT, CONTEXT_TEXT, SourceError, normalize, validateState,
  emptyState, changes, bindState, requestSource, collect, attach, atomicWrite, sha };
