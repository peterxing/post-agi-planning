'use strict';
if (require.main === module) require('./pipeline-lock').guard('verify:metr');

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const YAML = require('yaml');
const { SOURCE, BENCHMARK, normalize, validateState, emptyState, changes, bindState,
  collect, attach, atomicWrite, sha, CONTEXT_TEXT } = require('./refresh-metr');

async function verifyUI(bundle) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  const url = process.argv.find(value => /^https?:/.test(value)) || 'http://127.0.0.1:8787/';
  const display = v => `${v.estimate.toFixed(2)} min (95% CI ${v.ci_low.toFixed(2)}–${v.ci_high.toFixed(2)})`;
  try {
    for (const theme of ['light', 'dark']) for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({ viewport:{ width, height:1000 }, reducedMotion:'reduce' });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${url}${url.includes('?') ? '&' : '?'}scoutTheme=${theme}`);
        await page.waitForFunction(() => publishedSignals);
        const source = bundle.capabilities?.metr;
        if (source?.current) {
          const rows = source.current.records;
          assert.equal(await page.locator('#metrModel option').count(), rows.length);
          assert.equal(await page.locator('#metrP50').textContent(), display(rows[0].p50));
          assert.equal(await page.locator('#metrP80').textContent(), display(rows[0].p80));
          await page.locator('#metrModel').selectOption(rows.at(-1).id);
          assert.equal(await page.locator('#metrP50').textContent(), display(rows.at(-1).p50));
          await page.locator('#metrModel').selectOption(rows[0].id);
          if (process.env.PAP_UI_ARTIFACT_DIR && width !== 320) {
            fs.mkdirSync(process.env.PAP_UI_ARTIFACT_DIR, { recursive:true });
            await page.locator('#metrInstrument').evaluate(node => window.scrollTo(0, window.scrollY + node.getBoundingClientRect().top - 90));
            await page.screenshot({ path:path.join(process.env.PAP_UI_ARTIFACT_DIR, `metr-${width}-${theme}.png`) });
          }
          if (theme === 'light' && width === 1440) {
            await page.locator('#observationPrediction').selectOption('2026-0');
            assert.match(await page.locator('#metrContext').textContent(), /Context only/);
            assert.match(await page.locator('.trajectory-state').textContent(), /not yet assessed/);
            await page.locator('#observationDetail [data-watch]').click();
            const unrelatedId = await page.evaluate(() => forecastRecords().find(r => r.id !== '2026-0').id);
            const beforeOther = await page.evaluate(id => evidenceSnapshot(id), unrelatedId);
            await page.locator('#observationPrediction').selectOption(unrelatedId);
            assert.equal(await page.locator('#metrContext').textContent(), '');
            const revised = structuredClone(bundle);
            const metric = revised.capabilities.metr.current.records[0].p50;
            metric.estimate = (metric.estimate + metric.ci_high) / 2;
            await page.route('**/signals.json', route => route.fulfill({ json:revised }));
            await page.clock.install();
            await page.clock.fastForward(16000);
            await page.locator('#metrModel').focus();
            await page.evaluate(() => refreshPublishedObservations());
            assert.equal(await page.evaluate(() => Boolean(pendingSignals)), true);
            assert.equal(await page.locator('#metrP50').textContent(), display(rows[0].p50));
            assert.equal(await page.locator('#metrModel').evaluate(node => node === document.activeElement), true);
            await page.locator('#applyObservations').click();
            assert.equal(await page.locator('#metrP50').textContent(), display(metric));
            assert.match(await page.locator('[data-watch-status="2026-0"]').textContent(), /METR measurements/);
            assert.equal(await page.evaluate(id => evidenceSnapshot(id), unrelatedId), beforeOther);
            const verdict = await page.evaluate(data => {
              const before = publishedSignals;
              data.capabilities.metr.current.unit = 'hours';
              let rejected = false;
              try { applySignalBundle(data); } catch { rejected = true; }
              return { rejected, retained:publishedSignals === before };
            }, structuredClone(revised));
            assert.deepEqual(verdict, { rejected:true, retained:true });
            const rollback = await page.evaluate(data => {
              data.capabilities.metr.lastCheckedAt = '2025-01-01T00:00:00.000Z';
              try { applySignalBundle(data); return false; } catch { return true; }
            }, structuredClone(revised));
            assert.equal(rollback, true, 'A cached artifact cannot roll back newer METR data while news dates match');
            await page.clock.setSystemTime(Date.now() + 49 * 3600000);
            await page.evaluate(() => renderMetr());
            assert.match(await page.locator('#metrStatus').textContent(), /Stale/);
            await page.clock.setSystemTime(Date.now());
            const outage = structuredClone(revised);
            outage.capabilities.metr.status = 'error';
            outage.capabilities.metr.error = 'Synthetic source outage';
            await page.evaluate(data => applySignalBundle(data), outage);
            assert.match(await page.locator('#metrStatus').textContent(), /Last-good measurements retained/);
            assert.equal(await page.locator('#metrP50').textContent(), display(metric));
            await page.unroute('**/signals.json');
            await page.route('**/signals.json', route => route.fulfill({ json:{ ...bundle,
              capabilities:{ metr:emptyState() } } }));
            await page.reload();
            await page.waitForFunction(() => publishedSignals);
            assert.equal(await page.locator('#metrModel').isDisabled(), true);
            assert.match(await page.locator('#metrStatus').textContent(), /No measurements/);
          }
        }
        const geometry = await page.locator('#metrInstrument').evaluate(node => {
          const rect = node.getBoundingClientRect();
          return { inside:rect.left >= 0 && rect.right <= innerWidth, overflow:document.documentElement.scrollWidth > innerWidth };
        });
        assert.deepEqual(geometry, { inside:true, overflow:false });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  console.log('[METR UI] actual values/model selection, scoped watch changes, focused refresh, stale/error/empty states and both-theme mobile geometry passed.');
}

async function verify() {
  // Synthetic records exercise the adapter, never the published measurement layer.
  const row = { benchmark_name:BENCHMARK, release_date:'2025-01-01', scaffolds:['synthetic'],
    metrics:{ p50_horizon_length:{ estimate:60, ci_low:40, ci_high:80 },
      p80_horizon_length:{ estimate:20, ci_low:10, ci_high:30 } } };
  const fixture = { benchmark_name:BENCHMARK, long_tasks_version:'a'.repeat(40), swaa_version:'b'.repeat(40),
    results:{ synthetic:row, legacy:{ ...structuredClone(row), benchmark_name:'METR-Horizon-v1.0' } } };
  const body = YAML.stringify(fixture);
  const parsed = normalize(body);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.excludedLegacy, 1);
  assert.equal(parsed.unit, 'human-expert minutes');
  assert.equal(parsed.intervalLevel, 0.95);
  for (const mutate of [
    d => { d.benchmark_name = 'unknown'; }, d => { d.units = 'hours'; },
    d => { d.results.synthetic.unit = 'hours'; },
    d => { d.results.synthetic.benchmark_name = 'unknown'; },
    d => { d.long_tasks_version = ''; }, d => { d.results = {}; },
    d => { d.results.synthetic.release_date = '2025-02-30'; },
    d => { d.results.synthetic.scaffolds = []; },
    d => { d.results.synthetic.metrics.p50_horizon_length.estimate = '60'; },
    d => { d.results.synthetic.metrics.p50_horizon_length.estimate = Infinity; },
    d => { d.results.synthetic.metrics.p50_horizon_length.ci_low = -1; },
    d => { d.results.synthetic.metrics.p50_horizon_length.ci_high = 50; },
    d => { delete d.results.synthetic.metrics.p80_horizon_length; },
  ]) {
    const bad = structuredClone(fixture);
    mutate(bad);
    assert.throws(() => normalize(YAML.stringify(bad)));
  }
  assert.throws(() => normalize(body + '\nbenchmark_name: duplicate\n'));
  assert.throws(() => normalize('a: &a [*a]'));
  const headers = { etag:'"fixture"', 'last-modified':'Wed, 01 Jan 2025 00:00:00 GMT' };
  const first = await collect(null, { fetchImpl:async () => new Response(body, { headers }) });
  validateState(first);
  assert.equal(first.current.sha256, sha(body));
  assert.equal(first.current.measuredAt, null);
  assert.equal(first.current.publishedAt, null);
  assert.equal(first.current.records[0].releaseDate, '2025-01-01');
  assert.equal(first.previous, null);
  assert.match(changes(first), /First collection/);
  const checked = await collect(first, { fetchImpl:async (url, options) => {
    assert.equal(url, SOURCE);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers['If-None-Match'], '"fixture"');
    return new Response(null, { status:304 });
  } });
  assert.deepEqual(checked.current, first.current);
  assert.equal(checked.lastSuccessfulFetchAt, first.lastSuccessfulFetchAt);
  assert.equal(checked.previous, null);
  const withoutEtag = structuredClone(first);
  withoutEtag.current.etag = null;
  await collect(withoutEtag, { fetchImpl:async (_, options) => {
    assert.equal(options.headers['If-Modified-Since'], headers['last-modified']);
    return new Response(null, { status:304 });
  } });
  const revised = structuredClone(fixture);
  revised.results.synthetic.metrics.p50_horizon_length.estimate = 70;
  const second = await collect(first, { fetchImpl:async () => new Response(YAML.stringify(revised)) });
  assert.deepEqual(second.previous, first.current);
  assert.match(changes(second), /1 revised/);
  const incompatible = structuredClone(second);
  incompatible.current.longTasksVersion = 'c'.repeat(40);
  assert.match(changes(incompatible), /not comparable/);
  incompatible.current.longTasksVersion = first.current.longTasksVersion;
  incompatible.current.records[0].scaffolds = ['changed'];
  assert.match(changes(incompatible), /1 changed scaffolds \(not compared\)/);
  let redirects = 0;
  const refused = await collect(first, { fetchImpl:async () => {
    redirects++;
    return new Response(null, { status:302, headers:{ location:'https://example.org/' } });
  } });
  assert.equal(redirects, 1);
  assert.equal(refused.status, 'error');
  assert.deepEqual(refused.current, first.current);
  for (const badResponse of [
    () => new Response('partial: ['),
    () => new Response(body, { headers:{ 'content-length':'999999' } }),
    () => new Response('x'.repeat(262145)),
    () => new Response(body, { headers:{ 'last-modified':'invalid' } }),
  ]) {
    const failed = await collect(first, { fetchImpl:async () => badResponse() });
    assert.equal(failed.status, 'error');
    assert.deepEqual(failed.current, first.current);
    assert.equal(failed.lastSuccessfulFetchAt, first.lastSuccessfulFetchAt);
    validateState(failed);
  }
  let attempts = 0;
  const rateLimited = await collect(first, { fetchImpl:async () => {
    attempts++;
    return new Response(null, { status:429, headers:{ 'retry-after':'3600' } });
  } });
  assert.equal(attempts, 1);
  assert.ok(Date.parse(rateLimited.retryAt) > Date.now());
  assert.deepEqual(await collect(rateLimited, { fetchImpl:() => assert.fail('Cooldown must not request') }), rateLimited);
  const timedOut = await collect(first, { timeoutMs:5, sleep:async () => {},
    fetchImpl:async (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort',
      () => reject(new DOMException('Synthetic timeout', 'AbortError')), { once:true })) });
  assert.match(timedOut.error, /timed out/);
  assert.deepEqual(timedOut.current, first.current);
  assert.equal((await collect(null, { fetchImpl:async () => new Response(null, { status:304 }) })).status, 'unavailable');
  assert.equal((await collect(null, { fetchImpl:async () => new Response('invalid') })).status, 'unavailable');
  const predictions = JSON.parse(fs.readFileSync(path.join(__dirname, 'predictions.json'), 'utf8'));
  const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, 'signals.json'), 'utf8'));
  const attached = attach(bundle, first, predictions);
  const stripped = structuredClone(attached);
  if (bundle.capabilities) stripped.capabilities = bundle.capabilities;
  else delete stripped.capabilities;
  assert.deepEqual(stripped, bundle, 'METR-only writes must preserve all news fields/timestamps');
  assert.equal(bindState(first, predictions).context?.id, '2026-0');
  assert.equal(bindState(first, predictions).context.textSha256, sha(CONTEXT_TEXT));
  const retained = bindState(refused, predictions);
  delete retained.context;
  delete retained.changeSummary;
  assert.deepEqual(retained, refused, 'The shared producer binding preserves failed-source health and all last-good data');
  assert.throws(() => bindState({ ...first, current:{ ...first.current, unit:'hours' } }, predictions));
  const changedForecast = structuredClone(predictions);
  changedForecast.years[0].events[0].t += ' Synthetic change';
  assert.equal(bindState(first, changedForecast).context, null);
  assert.throws(() => attach(bundle, first, changedForecast));
  assert.throws(() => attach({ ...bundle, forecastVersion:{ ...bundle.forecastVersion, schemaVersion:2 } }, first, predictions));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pap-metr-'));
  const file = path.join(dir, 'snapshot.json');
  try {
    const collision = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(collision, 'Prior interrupted write');
    assert.throws(() => atomicWrite(file, attached));
    assert.equal(fs.readFileSync(collision, 'utf8'), 'Prior interrupted write');
    fs.unlinkSync(collision);
    atomicWrite(file, attached);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), attached);
    atomicWrite(file, attach(bundle, refused, predictions));
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).capabilities.metr.current, first.current);
    assert.deepEqual(fs.readdirSync(dir), ['snapshot.json']);
  } finally { if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(dir); }
  const producer = fs.readFileSync(path.join(__dirname, 'refresh-signals.js'), 'utf8');
  assert.match(producer, /bindMetrState\(prev\.capabilities\?\.metr/);
  assert.match(producer, /capabilities:\s*\{ metr \}/);
  const daily = fs.readFileSync(path.join(__dirname, 'DAILY-RUN.md'), 'utf8');
  assert.match(daily, /node refresh-metr\.js\r?\n\s+node refresh-signals\.js/);
  if (bundle.capabilities?.metr) {
    validateState(bundle.capabilities.metr);
    assert.deepEqual(bindState(bundle.capabilities.metr, predictions), bundle.capabilities.metr);
    console.log(`Published METR: ${bundle.capabilities.metr.status}; ${bundle.capabilities.metr.current?.records.length || 0} measurements.`);
  }
  if (!process.argv.includes('--unit-only')) await verifyUI(bundle);
  console.log('RESULT: PASS - METR schema/units/CI, bounded transport, 304, retry/timeout, last-good retention, dates, bindings and atomic publication.');
}
if (require.main === module) verify().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { verify };
