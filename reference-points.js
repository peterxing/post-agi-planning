'use strict';

const { normalizeUrl, extractMainText, quotePresent, detectBotChallenge } = require('./news-evidence');
const { sha, atomicWrite } = require('./refresh-metr');

const RELATIONS = ['measured', 'deployment', 'policy', 'trial', 'precursor', 'feasibility', 'constraint', 'counterevidence', 'theory'];
const DIRECTIONS = ['supports-prerequisite', 'context', 'challenges'];
const QUALITIES = ['official-agency', 'official-research', 'peer-reviewed', 'official-company', 'primary-reporting', 'author-manuscript', 'theory-proposal'];
const REGISTRY_URL = /^https:\/\/clinicaltrials\.gov\/api\/v2\/studies\/(NCT\d{8})$/;
const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\d(?:T[\d:.+-]+Z?)?$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === value.slice(0, 10)
  && Date.parse(value) <= Date.now() + 300000;
const text = (value, limit = 2000) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
function need(condition, message) { if (!condition) throw new Error(`Reference points: ${message}`); }
const reviewHash = rows => sha(JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id) || a.sourceId.localeCompare(b.sourceId))));
function canonical(url) {
  const value = new URL(url);
  need(value.protocol === 'https:' && !value.username && !value.password && !value.port, 'source must be public HTTPS');
  need(!/(^|\.)(x\.com|twitter\.com|localhost)$/.test(value.hostname)
    && !/^\d+(?:\.\d+){3}$/.test(value.hostname), 'source is not an approved reference publisher');
  return normalizeUrl(value.href);
}
function roster(predictions) {
  return [...predictions.years.flatMap(year => year.events.map((data, i) => ({ id:`${year.year}-${i}`, data }))),
    ...predictions.postSuperintelligence.items.map(data => ({ id:`horizon-${data.id}`, data }))];
}
function validateLedger(ledger) {
  need(ledger?.schemaVersion === 1 && ledger.sources && Array.isArray(ledger.mappings), 'unsupported reviewed ledger');
  const urls = new Set();
  for (const [id, source] of Object.entries(ledger.sources)) {
    need(/^[a-z0-9-]+$/.test(id) && source && source.url === canonical(source.url), 'invalid source identity');
    need(!urls.has(source.url), `duplicate canonical source ${source.url}`);
    urls.add(source.url);
    need(text(source.organization, 160) && text(source.title, 400) && QUALITIES.includes(source.quality), `metadata missing for ${id}`);
    need(source.publishedAt === null || (date(source.publishedAt) && text(source.dateEvidence, 500)), `publication provenance missing for ${id}`);
    if (source.publishedPeriod) need(source.publishedAt === null && /^\d{4}-(0[1-9]|1[0-2])$/.test(source.publishedPeriod)
      && source.publishedPeriod <= new Date().toISOString().slice(0, 7) && text(source.dateEvidence, 500), `invalid publication month for ${id}`);
    need(date(source.retrievedAt), `source retrieval not recorded for ${id}`);
    need(['https', 'browser'].includes(source.transport), `undeclared transport for ${id}`);
    need(['html', 'json', 'pdf'].includes(source.format) && !(source.format !== 'html' && source.transport === 'browser'),
      `unsupported document format for ${id}`);
    if (source.format === 'json') need(source.schema === 'clinicaltrials-v2' && REGISTRY_URL.test(source.url),
      `JSON source is not a reviewed registry v2 study endpoint for ${id}`);
    if (source.mediaType) need(source.format === 'pdf' && ['application/pdf', 'application/octet-stream', '/'].includes(source.mediaType),
      `unreviewed PDF media type for ${id}`);
    if (source.pdfPages) need(source.format === 'pdf' && Array.isArray(source.pdfPages) && source.pdfPages.length > 0
      && source.pdfPages.length <= 32 && new Set(source.pdfPages).size === source.pdfPages.length
      && source.pdfPages.every(n => Number.isInteger(n) && n >= 1 && n <= 128), `invalid PDF page selection for ${id}`);
    if (source.revisionIndex) need(source.revisionIndex.url === 'https://www.anthropic.com/responsible-scaling-policy'
      && /^\d+\.\d+$/.test(source.revisionIndex.version) && source.urls.includes(source.revisionIndex.url),
      `unsupported current-policy index for ${id}`);
    need(Array.isArray(source.urls) && source.urls.includes(source.url)
      && source.urls.every(url => canonical(url) === url), `unreviewed redirects for ${id}`);
    if (source.dateEvidenceUrl) need(source.urls.includes(source.dateEvidenceUrl)
      && (new URL(source.dateEvidenceUrl).hostname === new URL(source.url).hostname
        || new URL(source.dateEvidenceUrl).hostname.endsWith(`.${new URL(source.url).hostname}`)),
      `publication-date page must be explicitly reviewed on the same publisher for ${id}`);
    need(Array.isArray(source.reuse) && source.reuse.every(rule => text(rule.family, 120)
      && Array.isArray(rule.domains) && rule.domains.length && Array.isArray(rule.ids) && rule.ids.length), `reuse policy absent for ${id}`);
  }
  const pairs = new Set(), uses = new Map();
  for (const row of ledger.mappings) {
    need(row && text(row.id, 150) && ledger.sources[row.sourceId], 'mapping source/id missing');
    const pair = `${row.id}:${row.sourceId}`;
    need(!pairs.has(pair), `duplicate mapping ${pair}`);
    pairs.add(pair);
    need(text(row.predictionText) && /^[a-f0-9]{64}$/.test(row.predictionSha256)
      && row.predictionTextSha256 === sha(row.predictionText), `forecast fingerprint missing for ${row.id}`);
    need(text(row.domain, 40) && text(row.excerpt, 400) && text(row.facet, 500)
      && text(row.why, 1400) && text(row.doesNotEstablish, 1400), `individual explanation missing for ${row.id}`);
    need(RELATIONS.includes(row.relation) && DIRECTIONS.includes(row.direction)
      && date(row.reviewedAt) && row.reviewedBy === 'Agent review under user authorization', `unreviewed relation for ${row.id}`);
    need(row.relation !== 'counterevidence' || row.direction === 'challenges', `counterevidence must remain challenging for ${row.id}`);
    need(row.metric === null || (Number.isFinite(row.metric?.value) && [undefined, '>', '<', '~'].includes(row.metric.operator)
      && (row.metric.high === undefined || (Number.isFinite(row.metric.high) && row.metric.high >= row.metric.value && !row.metric.operator))
      && text(row.metric.unit, 100)
      && text(row.metric.coverage, 500)), `invalid measured value for ${row.id}`);
    const policy = ledger.sources[row.sourceId].reuse.find(rule => rule.family === row.reuseFamily);
    need(policy?.ids.includes(row.id) && policy.domains.includes(row.domain), `unreviewed domain/family reuse for ${row.id}`);
    if (!uses.has(row.sourceId)) uses.set(row.sourceId, []);
    uses.get(row.sourceId).push(row);
  }
  for (const [id, rows] of uses) {
    need(rows.length <= 6, `source ${id} exceeds six individually reviewed references`);
    need(new Set(rows.map(row => row.why)).size === rows.length, `repeated rationale for ${id}`);
    const excerptWords = [...new Set(rows.flatMap(row => [row.excerpt, row.metric?.evidence]).filter(Boolean))].join(' ').split(/\s+/).length;
    need(excerptWords <= 200, `excessive excerpt reuse for ${id}`);
  }
  need(Object.keys(ledger.sources).every(id => uses.has(id)), 'orphaned source in reviewed ledger');
  return true;
}
function buildReferencePoints(ledger, predictions, previous = null) {
  validateLedger(ledger);
  const expected = roster(predictions), items = {}, gaps = {}, sources = {};
  const known = new Map(expected.map(row => [row.id, row.data]));
  const orphans = ledger.mappings.filter(row => !known.has(row.id)).map(row => row.id);
  for (const [id, source] of Object.entries(ledger.sources)) {
    const old = previous?.sources?.[id];
    const identity = sha(JSON.stringify(source));
    const reviewSha256 = reviewHash(ledger.mappings.filter(row => row.sourceId === id));
    let health = old?.identity === identity ? old.health : null;
    if (health && health.reviewSha256 !== reviewSha256) health = { ...health, status:'unverified',
      error:'Reference review changed; the previous source receipt cannot approve new excerpts.' };
    sources[id] = { ...source, identity, reviewSha256, health:health || { status:'unverified', lastCheckedAt:null,
      lastVerifiedAt:null, textSha256:null, reviewSha256:null,
      error:'Source has not passed this collector yet.', etag:null, lastModified:null, retryAt:null } };
  }
  for (const row of expected) {
    const matches = ledger.mappings.filter(mapping => mapping.id === row.id);
    const valid = matches.filter(mapping => mapping.predictionText === row.data.t
      && mapping.predictionSha256 === sha(JSON.stringify(row.data)) && mapping.domain === row.data.d);
    if (valid.length) items[row.id] = valid;
    else gaps[row.id] = matches.length ? 'Forecast content changed; the old reference requires renewed review.' : 'No reviewed reference point recorded.';
  }
  const used = new Set(Object.values(items).flat().map(row => row.sourceId));
  return { schemaVersion:1, forecastSha256:sha(JSON.stringify(predictions)), ledgerSha256:sha(JSON.stringify(ledger)),
    updatedAt:previous?.updatedAt || null, sources, items, gaps, orphans,
    coverage:{ total:expected.length, mapped:Object.keys(items).length, gaps:Object.keys(gaps).length,
      sources:used.size, references:Object.values(items).flat().length } };
}
class ReferenceSourceError extends Error {
  constructor(message, status = 'unavailable', retryAt = null, retryable = false) {
    super(message); this.status = status; this.retryAt = retryAt; this.retryable = retryable;
  }
}
async function fetchReference(source, { fetchImpl = fetch, timeoutMs = 15000,
  maxBytes = (source.format === 'pdf' ? 8 : 4) * 1024 * 1024 } = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { Accept:source.format === 'json' ? 'application/json' : source.format === 'pdf'
    ? 'application/pdf' : 'text/html,application/xhtml+xml,text/plain',
    'User-Agent':'Mozilla/5.0 Post-AGI-Planning-ReferenceReview/1.0' };
  const reviewed = source.health.lastVerifiedAt && source.health.reviewSha256 === source.reviewSha256;
  if (reviewed && source.health.etag) headers['If-None-Match'] = source.health.etag;
  else if (reviewed && source.health.lastModified) headers['If-Modified-Since'] = source.health.lastModified;
  try {
    let url = source.url;
    for (let hop = 0; hop <= 4; hop++) {
      let approvedUrl;
      try { approvedUrl = canonical(url); } catch { throw new ReferenceSourceError('Redirect is not an approved public HTTPS URL.'); }
      if (!source.urls.includes(approvedUrl)) throw new ReferenceSourceError('Redirect is outside the reviewed source URLs.');
      const response = await fetchImpl(url, { signal:controller.signal, redirect:'manual', headers });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const next = response.headers.get('location');
        if (!next) throw new ReferenceSourceError('Redirect destination missing.');
        url = new URL(next, url).href;
        continue;
      }
      if (response.status === 304) {
        if (!reviewed) throw new ReferenceSourceError('304 without a verified snapshot for this exact review.');
        return { unchanged:true };
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        const retry = response.headers.get('retry-after');
        const time = /^\d+$/.test(retry || '') ? Date.now() + Number(retry) * 1000 : Date.parse(retry || '');
        throw new ReferenceSourceError(`Source HTTP ${response.status}.`, 'unavailable',
          Number.isFinite(new Date(time).getTime()) && time > Date.now() ? new Date(time).toISOString() : null,
          response.status === 429 || response.status >= 500);
      }
      const contentType = response.headers.get('content-type') || '';
      const typeMatches = source.format === 'pdf'
        ? contentType.split(';')[0].trim().toLowerCase() === (source.mediaType || 'application/pdf')
        : (source.format === 'json' ? /application\/json/i : /text\/html|xhtml|text\/plain/i).test(contentType);
      if (!typeMatches) {
        await response.body?.cancel();
        throw new ReferenceSourceError('Source is not accessible in its declared document format; renew review.');
      }
      if (Number(response.headers.get('content-length')) > maxBytes || !response.body) {
        await response.body?.cancel();
        throw new ReferenceSourceError('Missing or oversized source document.');
      }
      const reader = response.body.getReader(), chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > maxBytes) throw new ReferenceSourceError('Source document exceeds the byte limit.');
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel(); }
      const bytes = Buffer.concat(chunks);
      let html = '', body;
      if (source.format === 'pdf') {
        const { parseReferencePdf, PdfReadError } = require('./reference-pdf');
        try { body = await parseReferencePdf(bytes, { pages:source.pdfPages }); }
        catch (error) {
          if (!(error instanceof PdfReadError)) throw error;
          throw new ReferenceSourceError(error.message);
        }
        html = body;
      } else if (source.format === 'json') {
        html = bytes.toString('utf8');
        let data;
        try { data = JSON.parse(html); } catch { throw new ReferenceSourceError('Malformed source JSON; last-good reference retained.'); }
        const protocol = data?.protocolSection, expectedId = source.url.match(REGISTRY_URL)?.[1];
        if (source.schema !== 'clinicaltrials-v2' || !expectedId
          || protocol?.identificationModule?.nctId !== expectedId
          || protocol.identificationModule.officialTitle !== source.title
          || typeof protocol.descriptionModule?.briefSummary !== 'string'
          || typeof protocol.statusModule?.overallStatus !== 'string'
          || protocol.statusModule.studyFirstPostDateStruct?.type !== 'ACTUAL'
          || protocol.statusModule.studyFirstPostDateStruct.date !== source.publishedAt
          || !date(protocol.statusModule.lastUpdatePostDateStruct?.date)
          || !['INTERVENTIONAL', 'OBSERVATIONAL', 'EXPANDED_ACCESS'].includes(protocol.designModule?.studyType)
          || typeof data.hasResults !== 'boolean')
          throw new ReferenceSourceError('Registry v2 schema, NCT identity or reviewed metadata changed; renew review.', 'changed');
        const values = value => value && typeof value === 'object' ? Object.values(value).flatMap(values) : [String(value ?? '')];
        body = values(data).join(' ');
        html = JSON.stringify(data);
      } else {
        html = bytes.toString('utf8');
        body = extractMainText(html);
        if (detectBotChallenge(html, body).challenged) throw new ReferenceSourceError('Publisher challenge; not a verified document.');
      }
      if (body.length < 100) throw new ReferenceSourceError('Source has insufficient readable text.');
      return { body, html, finalUrl:canonical(url), etag:response.headers.get('etag'), lastModified:response.headers.get('last-modified') };
    }
    throw new ReferenceSourceError('Source redirect limit exceeded.');
  } catch (error) {
    if (error instanceof ReferenceSourceError) throw error;
    if (controller.signal.aborted) throw new ReferenceSourceError('Source request timed out.', 'unavailable', null, true);
    if (error instanceof TypeError) throw new ReferenceSourceError('Source transport failed.', 'unavailable', null, true);
    throw error;
  } finally { clearTimeout(timer); }
}
async function refreshSource(source, mappings, options = {}) {
  need(source.reviewSha256 === reviewHash(mappings), 'collector mappings differ from the declared source review');
  if (source.transport === 'browser' && typeof options.browserTransport !== 'function')
    throw new Error('Declared browser source requires the supported browser transport.');
  if (source.health.retryAt && Date.parse(source.health.retryAt) > Date.now()) return source;
  let result;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      result = source.transport === 'browser'
        ? await options.browserTransport(source) : await fetchReference(source, options);
      if (!result.unchanged) {
        const missing = mappings.filter(row => !quotePresent(result.body, row.excerpt));
        if (missing.length) throw new ReferenceSourceError(`Reviewed excerpt changed or absent for ${missing.map(row => row.id).join(', ')}. Renew review.`, 'changed');
        const metrics = mappings.filter(row => row.metric && !quotePresent(result.body, row.metric.evidence)
          && !(source.format === 'json' && typeof row.metric.evidence === 'string' && result.html.includes(row.metric.evidence)));
        if (metrics.length) throw new ReferenceSourceError(`Numeric source evidence missing or changed for ${metrics.map(row => row.id).join(', ')}. Renew review.`, 'changed');
        const dateSource = source.dateEvidenceUrl ? await fetchReference({ ...source,
          url:source.dateEvidenceUrl, format:'html', health:{ lastVerifiedAt:null } }, options) : result;
        if (source.dateEvidence && !quotePresent(dateSource.body, source.dateEvidence)
          && !dateSource.html.includes(source.dateEvidence))
          throw new ReferenceSourceError('Reviewed publication dateline absent; renew metadata review.', 'changed');
      }
      if (source.revisionIndex) {
        const index = await fetchReference({ ...source, url:source.revisionIndex.url,
          format:'html', health:{ lastVerifiedAt:null } }, options);
        const current = index.body.match(/Current and Prior Versions[\s\S]*?Version\s+(\d+\.\d+)/)?.[1];
        if (current !== source.revisionIndex.version)
          throw new ReferenceSourceError(`Policy index now reports ${current || 'an unreadable version'}; reviewed version ${source.revisionIndex.version} requires renewed review.`, 'changed');
      }
      const now = new Date().toISOString();
      return { ...source, health:{ status:'verified', lastCheckedAt:now,
        lastVerifiedAt:result.unchanged ? source.health.lastVerifiedAt : now,
        textSha256:result.unchanged ? source.health.textSha256 : sha(result.body),
        reviewSha256:source.reviewSha256,
        error:null, etag:result.unchanged ? source.health.etag : result.etag,
        lastModified:result.unchanged ? source.health.lastModified : result.lastModified, retryAt:null } };
    } catch (error) {
      if (!(error instanceof ReferenceSourceError)) throw error;
      if (attempt === 0 && error.retryable && !error.retryAt) {
        await (options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))))(1500);
        continue;
      }
      return { ...source, health:{ ...source.health, status:error.status,
        lastCheckedAt:new Date().toISOString(), error:error.message, retryAt:error.retryAt } };
    }
  }
}
async function openReferenceBrowser() {
  const { openBrowser, renderArticle } = require('./browse-transport');
  const browser = await openBrowser();
  let allowed = [];
  await browser.context.route('**/*', route => {
    if (route.request().isNavigationRequest()) {
      let url;
      try { url = canonical(route.request().url()); } catch { return route.abort(); }
      if (!allowed.includes(url)) return route.abort();
    }
    return route.fallback();
  });
  return { close:browser.close, async read(source) {
    allowed = source.urls;
    const result = await renderArticle(browser.context, source.url);
    if (!result.ok) throw new ReferenceSourceError(`Browser source refused: ${result.reason}`);
    if (Buffer.byteLength(result.body, 'utf8') > 4 * 1024 * 1024)
      throw new ReferenceSourceError('Rendered source exceeds the byte limit.');
    return { body:extractMainText(result.body), html:result.body, finalUrl:result.finalUrl, etag:null, lastModified:null };
  } };
}
function validatePublishedReferences(layer, predictions, { requireComplete = false } = {}) {
  need(layer?.schemaVersion === 1 && layer.forecastSha256 === sha(JSON.stringify(predictions)), 'published forecast version mismatch');
  const expected = roster(predictions), keys = new Set(expected.map(row => row.id));
  need(layer.items && layer.gaps && layer.sources && Array.isArray(layer.orphans), 'published layer is malformed');
  need(Object.keys(layer.items).every(id => keys.has(id)) && Object.keys(layer.gaps).every(id => keys.has(id)),
    'published mapping contains an orphan forecast');
  const mappings = Object.values(layer.items).flat(), used = new Set(mappings.map(row => row.sourceId));
  validateLedger({ schemaVersion:1, mappings,
    sources:Object.fromEntries(Object.entries(layer.sources).filter(([id]) => used.has(id))) });
  for (const row of expected) {
    const values = layer.items[row.id];
    need(Boolean(values?.length) !== Boolean(layer.gaps[row.id]), `not exactly one reference state for ${row.id}`);
    if (!values) continue;
    for (const mapping of values) {
      need(mapping.predictionSha256 === sha(JSON.stringify(row.data)) && mapping.predictionText === row.data.t,
        `mapping is not bound to ${row.id}`);
      const s = layer.sources[mapping.sourceId];
      need(s && ['verified', 'unavailable', 'changed', 'unverified'].includes(s.health?.status), 'missing source health');
      need(s.health.lastCheckedAt === null || date(s.health.lastCheckedAt), 'invalid source check timestamp');
      need(s.health.error === null || text(s.health.error), 'invalid source error metadata');
      need(s.health.etag === null || text(s.health.etag, 500), 'invalid source ETag');
      need(s.health.lastModified === null || (typeof s.health.lastModified === 'string'
        && Number.isFinite(Date.parse(s.health.lastModified))), 'invalid HTTP modification timestamp');
      need(s.health.lastVerifiedAt === null || (date(s.health.lastVerifiedAt) && /^[a-f0-9]{64}$/.test(s.health.textSha256)),
        'invalid source verification provenance');
      need(s.health.status !== 'verified' || (s.health.lastVerifiedAt && s.health.lastCheckedAt
        && Date.parse(s.health.lastCheckedAt) >= Date.parse(s.health.lastVerifiedAt)), 'source check predates verification');
      if (requireComplete) {
        need(mapping.metric === null || text(mapping.metric.evidence, 400), `numeric source evidence absent for ${row.id}`);
        need(Boolean(s.health.lastVerifiedAt), `source for ${row.id} has never verified`);
        need(s.health.reviewSha256 === s.reviewSha256
          && s.reviewSha256 === reviewHash(mappings.filter(m => m.sourceId === mapping.sourceId)),
          `source for ${row.id} has not verified this exact review`);
      }
    }
  }
  need(layer.coverage.total === keys.size && layer.coverage.mapped === Object.keys(layer.items).length
    && layer.coverage.gaps === Object.keys(layer.gaps).length && layer.coverage.sources === used.size
    && layer.coverage.references === mappings.length, 'coverage summary differs from actual roster');
  if (requireComplete) need(layer.coverage.gaps === 0 && layer.orphans.length === 0, 'reviewed roster is incomplete or has orphan entries');
}
module.exports = { RELATIONS, DIRECTIONS, QUALITIES, canonical, roster, validateLedger, buildReferencePoints,
  fetchReference, refreshSource, openReferenceBrowser, validatePublishedReferences, ReferenceSourceError, sha, atomicWrite };
