'use strict';
if (require.main === module) require('./pipeline-lock').guard('verify:references');

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { roster, validateLedger, buildReferencePoints, validatePublishedReferences,
  fetchReference, refreshSource, openReferenceBrowser, sha } = require('./reference-points');

// Synthetic examples exercise refusals; none is a live reference or a measurement.
const now = new Date().toISOString(), url = 'https://example.org/reference';
const example = { t:'Synthetic local fixture: a prerequisite improves', d:'technology', prob:50 };
const predictionsFixture = { years:[{ year:2026, events:[example] }], postSuperintelligence:{ items:[] } };
const fixture = {
  schemaVersion:1,
  sources:{ example:{ url, urls:[url], title:'Synthetic source for tests only', organization:'Example fixture',
    quality:'official-research', transport:'https', format:'html', publishedAt:'2024-01-01', dateEvidence:'January 1, 2024', retrievedAt:now,
    reuse:[{ family:'specific-prerequisite', domains:['technology'], ids:['2026-0'] }] } },
  mappings:[{ id:'2026-0', sourceId:'example', domain:'technology', predictionText:example.t,
    predictionSha256:sha(JSON.stringify(example)), predictionTextSha256:sha(example.t),
    excerpt:'The synthetic experiment measured only a narrow prerequisite.', facet:'One narrow prerequisite.',
    why:'This synthetic example tests relevance metadata, not world knowledge.',
    doesNotEstablish:'It establishes no real result and is never published.',
    relation:'precursor', direction:'supports-prerequisite', metric:null, reuseFamily:'specific-prerequisite',
    reviewedAt:now, reviewedBy:'Agent review under user authorization' }],
};
const html = '<html><body><main><h1>Synthetic source</h1><p>January 1, 2024</p>'
  + '<p>The synthetic experiment measured only a narrow prerequisite.</p>'
  + '<p>These are test fixture words and should not be interpreted as observations about the world.</p>'.repeat(8) + '</main></body></html>';
const response = (body = html, options = {}) => new Response(body, { headers:{ 'content-type':'text/html', etag:'"fixture-v1"', ...options.headers }, ...options });
function syntheticPdf() {
  const text = 'January 1, 2024. The synthetic experiment measured only a narrow prerequisite. These test fixture words describe no real observation.';
  const stream = `BT /F1 10 Tf 10 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1200 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  return Buffer.from(`${pdf}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}
async function unit() {
  validateLedger(fixture);
  const base = buildReferencePoints(fixture, predictionsFixture);
  assert.deepEqual(base.coverage, { total:1, mapped:1, gaps:0, sources:1, references:1 });
  assert.throws(() => validatePublishedReferences(base, predictionsFixture, { requireComplete:true }), /never verified/);
  for (const mutate of [
    f => { f.schemaVersion = 8; }, f => { f.mappings[0].direction = 'on-track'; },
    f => { f.mappings[0].relation = 'counterevidence'; },
    f => { f.mappings[0].predictionTextSha256 = '0'.repeat(64); },
    f => { f.mappings[0].metric = { value:NaN, unit:'units', coverage:'fixture' }; },
    f => { f.mappings[0].metric = { value:2, high:1, unit:'units', coverage:'fixture' }; },
    f => { f.mappings[0].metric = { value:2, operator:'on track', unit:'units', coverage:'fixture' }; },
    f => { f.mappings[0].why = ''; }, f => { f.mappings[0].reviewedAt = 'tomorrow'; },
    f => { f.sources.example.publishedAt = '2099-01-01'; },
    f => { f.sources.example.publishedAt = '2024-02-30'; },
    f => { f.sources.example.dateEvidence = null; },
    f => { f.sources.example.urls = ['https://example.org/different']; },
    f => { f.sources.example.reuse[0].domains = ['biology']; },
    f => { f.mappings.push(structuredClone(f.mappings[0])); },
    f => { f.sources.duplicate = structuredClone(f.sources.example); },
  ]) {
    const changed = structuredClone(fixture); mutate(changed);
    assert.throws(() => validateLedger(changed));
  }
  const unknownDate = structuredClone(fixture);
  unknownDate.sources.example.publishedAt = null; unknownDate.sources.example.dateEvidence = null;
  validateLedger(unknownDate);
  unknownDate.sources.example.publishedPeriod = '2024-01'; unknownDate.sources.example.dateEvidence = 'January 2024';
  validateLedger(unknownDate);
  unknownDate.sources.example.publishedPeriod = '2024-13';
  assert.throws(() => validateLedger(unknownDate), /publication month/);
  const predictionChange = structuredClone(predictionsFixture);
  predictionChange.years[0].events[0].prob = 51;
  const rebound = buildReferencePoints(fixture, predictionChange);
  assert.equal(rebound.coverage.mapped, 0);
  assert.match(rebound.gaps['2026-0'], /content changed/);
  validatePublishedReferences(rebound, predictionChange);
  const removed = structuredClone(predictionsFixture); removed.years[0].events = [];
  assert.deepEqual(buildReferencePoints(fixture, removed).orphans, ['2026-0']);

  const source = await refreshSource(base.sources.example, fixture.mappings, { fetchImpl:async () => response() });
  assert.equal(source.health.status, 'verified', source.health.error);
  assert.match(source.health.textSha256, /^[a-f0-9]{64}$/);
  assert.equal(source.publishedAt, fixture.sources.example.publishedAt);
  let condition;
  const unchanged = await refreshSource(source, fixture.mappings, {
    fetchImpl:async (_, options) => { condition = options.headers['If-None-Match']; return new Response(null, { status:304 }); },
  });
  assert.equal(condition, '"fixture-v1"');
  assert.equal(unchanged.health.lastVerifiedAt, source.health.lastVerifiedAt);
  assert.equal(unchanged.health.textSha256, source.health.textSha256);
  assert.ok(Date.parse(unchanged.health.lastCheckedAt) >= Date.parse(source.health.lastCheckedAt));
  for (const result of [
    response('<html><body>Partial document</body></html>'),
    response(html.replace('narrow prerequisite', 'unrelated subject')),
    response(html.replace('January 1, 2024', 'Unknown dateline')),
    response(null, { status:404 }),
  ]) {
    const failed = await refreshSource(source, fixture.mappings, { fetchImpl:async () => result });
    assert.notEqual(failed.health.status, 'verified');
    assert.equal(failed.health.lastVerifiedAt, source.health.lastVerifiedAt);
    assert.equal(failed.health.textSha256, source.health.textSha256);
    assert.equal(failed.publishedAt, source.publishedAt);
  }
  await assert.rejects(() => fetchReference(base.sources.example, {
    fetchImpl:async () => new Response(null, { status:304 }),
  }), /without a verified/);
  let calls = 0;
  await assert.rejects(() => fetchReference(source, { fetchImpl:async () => {
    calls++; return new Response(null, { status:302, headers:{ location:'https://example-not-reviewed.test/private' } });
  } }), /outside the reviewed/);
  assert.equal(calls, 1);
  const insecure = await refreshSource(source, fixture.mappings, { fetchImpl:async () =>
    new Response(null, { status:302, headers:{ location:'http://example.org/reference' } }) });
  assert.match(insecure.health.error, /not an approved public HTTPS/);
  assert.equal(insecure.health.lastVerifiedAt, source.health.lastVerifiedAt);
  await assert.rejects(() => fetchReference(source, { maxBytes:80, fetchImpl:async () => response() }), /byte limit/);
  await assert.rejects(() => fetchReference(source, {
    fetchImpl:async () => response('PDF fixture', { headers:{ 'content-type':'application/pdf' } }),
  }), /declared document format/);
  const timedOut = await refreshSource(source, fixture.mappings, { timeoutMs:5, sleep:async () => {},
    fetchImpl:(_, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort',
      () => reject(new DOMException('Aborted', 'AbortError')), { once:true })) });
  assert.match(timedOut.health.error, /timed out/);
  assert.equal(timedOut.health.lastVerifiedAt, source.health.lastVerifiedAt);
  const limited = await refreshSource(source, fixture.mappings, {
    fetchImpl:async () => new Response(null, { status:429, headers:{ 'retry-after':'120' } }),
  });
  assert.ok(Date.parse(limited.health.retryAt) > Date.now());
  const deferred = await refreshSource(limited, fixture.mappings, { fetchImpl:async () => { throw new Error('Do not call'); } });
  assert.deepEqual(deferred, limited);
  await assert.rejects(() => refreshSource({ ...source, transport:'browser' }, fixture.mappings), /requires the supported/);
  const browserRead = await refreshSource({ ...source, transport:'browser' }, fixture.mappings, {
    browserTransport:async () => ({ body:require('./news-evidence').extractMainText(html), html, etag:null, lastModified:null }),
  });
  assert.equal(browserRead.health.status, 'verified');
  assert.equal(browserRead.health.etag, null, 'A rendered source does not pretend to provide conditional HTTP metadata');
  const { parseReferencePdf } = require('./reference-pdf');
  const pdf = syntheticPdf();
  console.log('PDF fixtures: complete text');
  assert.match(await parseReferencePdf(pdf), /synthetic experiment measured/);
  console.log('PDF fixtures: selected page');
  assert.match(await parseReferencePdf(pdf, { pages:[1] }), /synthetic experiment measured/);
  console.log('PDF fixtures: missing/duplicate page');
  await assert.rejects(() => parseReferencePdf(pdf, { pages:[2] }), /no longer exists/);
  await assert.rejects(() => parseReferencePdf(pdf, { pages:[1, 1] }), /Invalid PDF page/);
  await assert.rejects(() => parseReferencePdf(Buffer.from('not a PDF')), /signature/);
  console.log('PDF fixtures: malformed bytes');
  await assert.rejects(() => parseReferencePdf(Buffer.from('%PDF-1.4\ninvalid')), /PDF source refused/);
  await assert.rejects(() => parseReferencePdf(pdf, { maxPages:0 }), /page limit/);
  console.log('PDF fixtures: text/time limits');
  await assert.rejects(() => parseReferencePdf(pdf, { maxTextBytes:10 }), /text.*limit/);
  await assert.rejects(() => parseReferencePdf(pdf, { timeoutMs:1 }), /timed out/);
  console.log('PDF fixtures: declared media type');
  const pdfRead = await refreshSource({ ...source, format:'pdf', mediaType:'/' }, fixture.mappings,
    { fetchImpl:async () => response(pdf, { headers:{ 'content-type':'/' } }) });
  assert.equal(pdfRead.health.status, 'verified');
  const indexUrl = 'https://www.anthropic.com/responsible-scaling-policy';
  const indexed = { ...source, urls:[url, indexUrl], revisionIndex:{ url:indexUrl, version:'3.4' } };
  for (const version of ['3.4', '3.5']) {
    const checked = await refreshSource(indexed, fixture.mappings, { fetchImpl:async target => target === indexUrl
      ? response(html.replace('<h1>Synthetic source</h1>', `<h1>Current and Prior Versions</h1><p>Version ${version}</p>`))
      : new Response(null, { status:304 }) });
    assert.equal(checked.health.status, version === '3.4' ? 'verified' : 'changed');
    assert.equal(checked.health.lastVerifiedAt, source.health.lastVerifiedAt);
  }
  const metricRows = structuredClone(fixture.mappings);
  metricRows[0].metric = { value:2, operator:'>', unit:'synthetic items', coverage:'Only test fixtures',
    evidence:'More than two synthetic items appeared in the fixture.' };
  const metricSource = buildReferencePoints({ ...fixture, mappings:metricRows }, predictionsFixture, {
    sources:{ example:source },
  }).sources.example;
  const missingMetric = await refreshSource(metricSource, metricRows, { fetchImpl:async () => response() });
  assert.equal(missingMetric.health.status, 'changed');
  assert.match(missingMetric.health.error, /Numeric source evidence/);
  const validMetric = await refreshSource(metricSource, metricRows, { fetchImpl:async () =>
    response(html.replace('</main>', '<p>More than two synthetic items appeared in the fixture.</p></main>')) });
  assert.equal(validMetric.health.status, 'verified');
  const hiddenMetric = await refreshSource(metricSource, metricRows, { fetchImpl:async () =>
    response(html.replace('</main>', '<script>More than two synthetic items appeared in the fixture.</script></main>')) });
  assert.equal(hiddenMetric.health.status, 'changed', 'HTML scripts are not numeric source evidence');
  const registryUrl = 'https://clinicaltrials.gov/api/v2/studies/NCT06429735';
  const jsonSource = { ...source, format:'json', schema:'clinicaltrials-v2', url:registryUrl,
    urls:[registryUrl], dateEvidence:'"date":"2024-01-01"' };
  const registryFixture = { protocolSection:{
    identificationModule:{ nctId:'NCT06429735', officialTitle:source.title },
    descriptionModule:{ briefSummary:fixture.mappings[0].excerpt, limitation:fixture.mappings[0].doesNotEstablish },
    statusModule:{ overallStatus:'RECRUITING', studyFirstPostDateStruct:{ date:'2024-01-01', type:'ACTUAL' },
      lastUpdatePostDateStruct:{ date:'2024-01-02' } }, designModule:{ studyType:'INTERVENTIONAL' },
  }, hasResults:false };
  const jsonRead = await refreshSource(jsonSource, fixture.mappings, { fetchImpl:async () =>
    response(JSON.stringify(registryFixture), { headers:{ 'content-type':'application/json' } }) });
  assert.equal(jsonRead.health.status, 'verified');
  const registryRows = structuredClone(fixture.mappings);
  registryRows[0].metric = { value:12, unit:'months planned', coverage:'Synthetic registry fixture only',
    evidence:'{"measure":"Synthetic outcome","timeFrame":"12 months"}' };
  const registrySource = buildReferencePoints({ ...fixture, sources:{ example:jsonSource }, mappings:registryRows },
    predictionsFixture).sources.example;
  const measuredRegistry = structuredClone(registryFixture);
  measuredRegistry.protocolSection.outcomesModule = { primaryOutcomes:[{ measure:'Synthetic outcome', timeFrame:'12 months' }] };
  const registryProof = await refreshSource(registrySource, registryRows, { fetchImpl:async () =>
    response(JSON.stringify(measuredRegistry), { headers:{ 'content-type':'application/json' } }) });
  assert.equal(registryProof.health.status, 'verified', 'Validated JSON preserves exact structured numeric context');
  measuredRegistry.protocolSection.outcomesModule.primaryOutcomes[0].timeFrame = '24 months';
  const changedRegistry = await refreshSource(registryProof, registryRows, { fetchImpl:async () =>
    response(JSON.stringify(measuredRegistry), { headers:{ 'content-type':'application/json' } }) });
  assert.equal(changedRegistry.health.status, 'changed');
  assert.equal(changedRegistry.health.lastVerifiedAt, registryProof.health.lastVerifiedAt);
  const brokenJson = await refreshSource(jsonRead, fixture.mappings, { fetchImpl:async () =>
    response('{"partial":', { headers:{ 'content-type':'application/json' } }) });
  assert.match(brokenJson.health.error, /Malformed source JSON/);
  assert.equal(brokenJson.health.lastVerifiedAt, jsonRead.health.lastVerifiedAt);
  for (const mutate of [
    d => { d.protocolSection.identificationModule.nctId = 'NCT00000000'; },
    d => { delete d.protocolSection.descriptionModule; },
    d => { d.protocolSection.statusModule.studyFirstPostDateStruct.type = 'ESTIMATED'; },
    d => { d.hasResults = 'true'; },
  ]) {
    const data = structuredClone(registryFixture); mutate(data);
    const invalid = await refreshSource(jsonRead, fixture.mappings, { fetchImpl:async () =>
      response(JSON.stringify(data), { headers:{ 'content-type':'application/json' } }) });
    assert.equal(invalid.health.status, 'changed');
    assert.equal(invalid.health.lastVerifiedAt, jsonRead.health.lastVerifiedAt);
  }
  const good = { ...base, sources:{ example:source }, updatedAt:now };
  validatePublishedReferences(good, predictionsFixture, { requireComplete:true });
  assert.deepEqual(buildReferencePoints(fixture, predictionsFixture, good), good, 'Producer replay preserves source health and dates');
  const rereviewed = structuredClone(fixture);
  rereviewed.mappings[0].excerpt = 'New excerpt not checked against the source.';
  const pendingReview = buildReferencePoints(rereviewed, predictionsFixture, good);
  assert.equal(pendingReview.sources.example.health.lastVerifiedAt, source.health.lastVerifiedAt);
  assert.throws(() => validatePublishedReferences(pendingReview, predictionsFixture, { requireComplete:true }), /exact review/);
  await assert.rejects(() => fetchReference(pendingReview.sources.example, {
    fetchImpl:async (_, options) => {
      assert.equal(options.headers['If-None-Match'], undefined);
      return new Response(null, { status:304 });
    },
  }), /exact review/);
  for (const mutate of [
    b => { b.forecastSha256 = '0'.repeat(64); }, b => { b.coverage.mapped = 8; },
    b => { b.items['2099-7'] = b.items['2026-0']; }, b => { b.gaps['2026-0'] = 'overlap'; },
    b => { b.items['2026-0'][0].predictionText = 'wrong'; },
    b => { b.sources.example.health.lastVerifiedAt = 'not a timestamp'; },
  ]) { const b = structuredClone(good); mutate(b); assert.throws(() => validatePublishedReferences(b, predictionsFixture)); }
  console.log('Reference fixtures PASS: schema/binding/totality/reuse/dates/quotes/redirects/limits/timeout/304/Retry-After/last-good/replay.');
}

async function ui(bundle, predictions) {
  const { chromium } = require('playwright');
  const base = process.argv.find(arg => /^https?:/.test(arg)) || 'http://127.0.0.1:8787/';
  const records = roster(predictions);
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  try {
    for (const profile of [{ width:1440, theme:'light' }, { width:390, theme:'dark' }, { width:320, theme:'light' }]) {
      const context = await browser.newContext({ viewport:{ width:profile.width, height:1000 }, reducedMotion:'reduce' });
      try {
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${base}${base.includes('?') ? '&' : '?'}scoutTheme=${profile.theme}`);
        await page.waitForFunction(() => publishedSignals?.referencePoints);
        assert.equal(await page.locator('[data-reference]').count(), records.length);
        const inspected = profile.width === 1440 ? records : [records[0], ...records.slice(-7)];
        for (const row of inspected) {
          const href = row.id.startsWith('horizon-') ? `#${row.id}` : `#event-${row.id}`;
          await page.evaluate(hash => { location.hash = hash; revealHashTarget(); }, href);
          await page.locator(`[data-reference="${row.id}"]`).click();
          assert.equal(await page.locator('#observationPrediction').inputValue(), row.id);
          const detail = page.locator(`[data-reference-detail="${row.id}"]`);
          assert.equal(await detail.count(), bundle.referencePoints.items[row.id].length);
          assert.match(await detail.first().textContent(), /Does not establish:/);
          const mapping = bundle.referencePoints.items[row.id][0], source = bundle.referencePoints.sources[mapping.sourceId];
          assert.ok((await detail.first().textContent()).includes(mapping.why));
          assert.equal(await detail.first().locator('h4 > a').getAttribute('href'), source.url);
          if (bundle.uncited.items[row.id])
            assert.match(await page.locator('#observationDetail > .source-inspection summary').textContent(), /^News evidence gap/);
          assert.match(await page.locator('.trajectory-state').textContent(), /not yet assessed/);
        }
        const geometry = await page.evaluate(() => ({
          overflow:document.documentElement.scrollWidth > innerWidth,
          rendered:document.querySelectorAll('*').length,
          referencePanels:document.querySelectorAll('[data-reference-detail]').length,
        }));
        assert.equal(geometry.overflow, false);
        assert.ok(geometry.rendered <= 6550, `DOM ${geometry.rendered} exceeds unchanged 6550`);
        assert.equal(geometry.referencePanels, bundle.referencePoints.items[inspected.at(-1).id].length);
        if (process.env.PAP_UI_ARTIFACT_DIR && profile.width !== 320) {
          fs.mkdirSync(process.env.PAP_UI_ARTIFACT_DIR, { recursive:true });
          await page.locator('[data-reference-detail] details').first().evaluate(node => { node.open = true; });
          await page.locator('#observationDetail').scrollIntoViewIfNeeded();
          await page.screenshot({ path:path.join(process.env.PAP_UI_ARTIFACT_DIR, `references-${profile.width}-${profile.theme}.png`) });
        }
        if (profile.width === 1440) {
          const id = records[0].id;
          await page.locator('#observationPrediction').selectOption(id);
          await page.locator('#observationDetail [data-watch]').click();
          const before = await page.evaluate(() => {
            window.referenceTestEvent = document.querySelector('.event');
            return JSON.stringify([publishedSignals.embeds, publishedSignals.context, publishedSignals.uncited, publishedSignals.xSignals, publishedSignals.capabilities]);
          });
          const revised = structuredClone(bundle);
          revised.referencePoints.items[id][0].why += ' Synthetic refresh test only.';
          await page.route('**/signals.json', route => route.fulfill({ json:revised }));
          await page.clock.install(); await page.clock.fastForward(16000);
          await page.locator('#observationDetail [data-watch]').focus();
          await page.evaluate(() => refreshPublishedObservations());
          assert.equal(await page.evaluate(() => Boolean(pendingSignals)), true);
          assert.equal(await page.evaluate(() => document.activeElement.matches('[data-watch]')), true);
          await page.locator('#applyObservations').click();
          assert.match(await page.locator(`[data-watch-status="${id}"]`).textContent(), /reviewed reference points/);
          assert.equal(await page.evaluate(() => document.querySelector('.event') === window.referenceTestEvent), true);
          assert.equal(await page.evaluate(() => JSON.stringify([publishedSignals.embeds, publishedSignals.context, publishedSignals.uncited, publishedSignals.xSignals, publishedSignals.capabilities])), before);
          const refusal = await page.evaluate(data => {
            data.referencePoints.forecastSha256 = '0'.repeat(64);
            const old = publishedSignals;
            try { applySignalBundle(data); return false; } catch { return publishedSignals === old; }
          }, revised);
          assert.equal(refusal, true);
          await page.reload(); await page.waitForFunction(() => publishedSignals?.referencePoints);
          assert.equal(await page.locator(`[data-watch-status="${id}"]`).count(), 1);
          const unknown = structuredClone(revised);
          const source = Object.values(unknown.referencePoints.sources)[0];
          source.publishedAt = null; source.health.status = 'unavailable'; source.health.error = 'Synthetic source outage; last-good retained.';
          const selected = Object.entries(unknown.referencePoints.items).find(([, rows]) => rows.some(r => unknown.referencePoints.sources[r.sourceId] === source))[0];
          await page.evaluate(data => applySignalBundle(data), unknown);
          await page.locator('#observationPrediction').selectOption(selected);
          assert.match(await page.locator('[data-reference-detail]').textContent(), /source date unknown/);
          assert.match(await page.locator('[data-reference-detail]').textContent(), /last-good retained/);
        }
        assert.deepEqual(errors, []);
        console.log(`Reference UI ${profile.width}/${profile.theme}: ${inspected.length} actual links opened, no overflow; DOM ${geometry.rendered}.`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
async function main() {
  await unit();
  if (process.argv.includes('--unit')) return;
  const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
  const predictions = read('predictions.json'), bundle = read('signals.json'), ledger = read('reference-ledger.json');
  const producer = fs.readFileSync(path.join(__dirname, 'refresh-signals.js'), 'utf8');
  const daily = fs.readFileSync(path.join(__dirname, 'DAILY-RUN.md'), 'utf8');
  const authorRun = fs.readFileSync(path.join(__dirname, 'AUTHOR-RUN.md'), 'utf8');
  const publisher = fs.readFileSync(path.join(__dirname, 'publish-github.ps1'), 'utf8');
  assert.match(producer, /const referencePoints = buildReferencePoints\(/);
  assert.match(producer, /const out = \{\s*referencePoints,/);
  assert.match(daily, /node refresh-metr\.js\s+node refresh-reference-points\.js --refresh\s+node refresh-signals\.js/);
  assert.match(daily, /Every daily forecasting run must also make a bounded newest-vintage review/);
  assert.match(daily, /re-run the reference collector before the FINAL/);
  assert.match(authorRun, /This author workflow does NOT collect references/);
  assert.match(authorRun, /`verify:references` gate read-only/);
  for (const file of ['reference-ledger.json','reference-points.js','reference-pdf.js','refresh-reference-points.js','verify-reference-points.js'])
    assert.ok(publisher.includes(`'${file}'`), `Mirror dependency absent: ${file}`);
  assert.match(publisher, /& node \$referencesVerifier --no-ui/);
  validateLedger(ledger);
  validatePublishedReferences(bundle.referencePoints, predictions, { requireComplete:true });
  assert.deepEqual(buildReferencePoints(ledger, predictions, bundle.referencePoints), bundle.referencePoints,
    'Ordinary producer must deterministically retain all mappings and source health');
  if (process.env.PAP_CONTENT_BASELINE) {
    const original = JSON.parse(fs.readFileSync(path.join(process.env.PAP_CONTENT_BASELINE, 'signals.json'), 'utf8'));
    const actual = structuredClone(bundle); delete actual.referencePoints;
    assert.deepEqual(actual, original, 'NEWS, X, METR and all original evidence timestamps must be byte-value equivalent');
  }
  console.log(`Reviewed roster PASS: ${JSON.stringify(bundle.referencePoints.coverage)}; whole-forecast verdicts remain independent.`);
  if (process.argv.includes('--live')) {
    let browser;
    try {
      for (const [id, source] of Object.entries(bundle.referencePoints.sources)) {
        if (source.transport === 'browser' && !browser) browser = await openReferenceBrowser();
        const result = await refreshSource(source, ledger.mappings.filter(row => row.sourceId === id),
          { browserTransport:browser?.read });
        assert.equal(result.health.status, 'verified', `${id}: ${result.health.error}`);
      }
    } finally { if (browser) await browser.close(); }
    console.log('Live reference excerpts PASS across all canonical sources.');
  }
  if (!process.argv.includes('--no-ui')) await ui(bundle, predictions);
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
