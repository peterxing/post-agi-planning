// Concurrency interlock: claim the tree before reading predictions/signals/approvals/floors.
if (require.main === module) require('./pipeline-lock').guard('verify:ui');

const { chromium } = require('playwright');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const predictions = require('./predictions.json');
const signals = require('./signals.json');

/* REDUCED MOTION: COVERAGE, NOT PRESENCE (GC seq-129 §4, 2026-08-13).
   The 'reduced-motion' profile below re-runs every ordinary check under reducedMotion:'reduce',
   which proves the page RENDERS under the preference — it does not prove motion is SUPPRESSED.
   A build that animated identically under 'reduce' passed all of those checks. Counting
   `prefers-reduced-motion` occurrences has the same defect one level up: a block guarding 3 of 8
   keyframes is indistinguishable from one guarding all 8.

   So the keyframe list is READ OUT OF styles.css rather than restated here — a newly added
   @keyframes is covered automatically instead of being remembered — and the assertion is made
   against the live computed styles of every element: under 'reduce', NOTHING may animate. */
const STYLES_PATH = path.join(__dirname, 'styles.css');
const declaredKeyframes = [...new Set(
  [...fs.readFileSync(STYLES_PATH, 'utf8').matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map(m => m[1])
)];
if (declaredKeyframes.length === 0) {
  console.error('[verify:ui] REFUSED — styles.css declares zero @keyframes. Either the stylesheet '
    + 'moved or the parse broke; an empty keyframe list would make the reduced-motion assertion '
    + 'vacuously true against an empty subject.');
  process.exit(1);
}
const observedAnimating = new Set();

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
/* How long to wait for a render to settle before deciding the page is wrong. This is PATIENCE, not
   a threshold: every assertion using it is unchanged by its value, and a condition that never
   becomes true still fails, just later. It is generous on purpose because this suite runs alongside
   16 other gates and a browser on one machine, and a wait tuned for an idle host produces failures
   that say "the page is broken" when the truth is "the host was busy". See the RENDER_SETTLE_MS use
   sites for the measurement that prompted it. */
const RENDER_SETTLE_MS = 30000;
/* A12 CLASS (GC seq-115, 2026-08-13). An expectation coerced out of a MISSING field is not an
   expectation: `Number(x) || 0` turns a renamed or deleted operand into a comparison against 0,
   which the DOM then satisfies trivially, and the arm goes on to print the conclusion of a
   measurement it never made. Absence is therefore a REFUSAL here, taken before any arm runs, and
   the message NAMES the field so the failure can never be read as a data regression.
   Proven by mutation: renaming or deleting coverage.cited must abort this file, not pass it. */
function required(value, fieldPath, predicate) {
  if (value === undefined || value === null || !predicate(value)) {
    console.error(`[verify:ui] REFUSED — signals.json ${fieldPath} is missing or unusable `
      + `(got ${JSON.stringify(value)}). No expectation can be derived from an absent field.`);
    process.exit(1);
  }
  return value;
}
const isCount = value => Number.isFinite(Number(value)) && Number(value) >= 0;
const expectedEvents = predictions.years.reduce((sum, year) => sum + year.events.length, 0);
const expectedTechnology = predictions.years.reduce(
  (sum, year) => sum + year.events.filter(event => event.d === 'technology').length,
  0
);
const expectedYears = predictions.years.length;
const expectedHorizon = predictions.postSuperintelligence.items.length;
/* X retirement (2026-08-13). The evidence mix is derived from signals.json rather than
   asserted as '> 0', which was an X-era portfolio expectation that says nothing about
   whether the rendered label matches the record it came from. */
const expectedEvidenceTypes = Object.values(signals.embeds || {})
  .reduce((acc, embed) => {
    const key = embed.evidenceType || 'direct';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
const artefactCited = Number(required(
  signals.coverage && signals.coverage.cited, 'coverage.cited', isCount));
const artefactUncited = Number(required(
  signals.uncited && signals.uncited.count, 'uncited.count', isCount));
const artefactContext = Number(required(
  signals.context && signals.context.count, 'context.count', isCount));
const artefactReality = required(signals.reality, 'reality', Array.isArray).length;
const expectedChanged = predictions.years.reduce(
  (sum, year) => sum + year.events.filter(event => event.revisedAt === predictions.updated.slice(0, 10)).length,
  0
);
const expectedOwners = signals.coverage.byEvidenceOwner;
const expectedAuthorship = required(
  signals.coverage.byPeterAuthorship, 'coverage.byPeterAuthorship',
  value => isCount(value.authored) && isCount(value.reposted));
const expectedPeterStatuses = new Set(
  Object.values(signals.embeds).filter(embed => embed.evidenceOwner === 'peterxing').map(embed => embed.id)
).size;
const expectedExternalStatuses = new Set(
  Object.values(signals.embeds).filter(embed => embed.evidenceOwner === 'external').map(embed => embed.id)
).size;
const expectedManaged = predictions.years.reduce(
  (sum, year) => sum + year.events.filter(event => /^managed branch:/i.test(event.t)).length,
  0
);
/* THE DEEP-LINK FIXTURE MUST FOLLOW THE DATA, NOT PIN A NUMBER THE FORECAST IS ALLOWED TO CHANGE.
   This check loads ?fd=governance&fp=high#<event> and asserts the filters survive the load. It used
   to hard-code #event-2031-4, which sat at prob 76 and so fell inside the 'high' band (60-79) that
   app.js probabilityBand() defines. On 2026-08-24 that prediction was legitimately recalibrated to 82,
   moving it into 'very-high'. app.js then did exactly the right thing: revealHashTarget() sees the
   target hidden by the restored filters and calls resetForecastFilters(), because a deep link must
   never land a reader on an invisible anchor. The check failed reporting domain 'all' — a CORRECT
   app behaviour indistinguishable, to the old fixture, from a broken filter restore.
   So the target is now DERIVED: pick a governance event that is actually inside the band being
   filtered for. A recalibration moves the chosen event instead of breaking the check, and the check
   keeps testing the thing it exists to test. Sorted by id so the pick is stable across runs. */
const restoredBandEvents = predictions.years.flatMap(year =>
  year.events
    .map((event, index) => ({ id:`event-${year.year}-${index}`, event }))
    .filter(row => row.event.d === 'governance'
      && Number.isFinite(row.event.prob)
      && row.event.prob >= 60
      && row.event.prob < 80));
const expectedRestored = restoredBandEvents.length;
if (!expectedRestored) {
  console.error('verify-observatory: no governance prediction sits in the 60-79 band, so the '
    + 'filter-restore deep-link fixture has nothing to target. Choose a different band rather than '
    + 'deleting the check.');
  process.exit(1);
}
const restoreTargetId = restoredBandEvents.map(row => row.id).sort()[0];

const profiles = [
  { name:'desktop-dark', theme:'dark', width:1440, height:1000, collapsedYears:10 },
  { name:'desktop-light', theme:'light', width:1440, height:1000, collapsedYears:10 },
  { name:'tablet-dark', theme:'dark', width:820, height:1180, collapsedYears:10, touch:true },
  { name:'mobile-light', theme:'light', width:390, height:844, collapsedYears:12, mobile:true, touch:true },
  { name:'narrow-320', theme:'dark', width:320, height:800, collapsedYears:12, mobile:true, touch:true },
  { name:'high-zoom-layout', theme:'light', width:640, height:900, collapsedYears:12, compactNav:true },
  { name:'reduced-motion', theme:'dark', width:1280, height:900, collapsedYears:10, reduced:true },
];

function check(results, label, condition, detail = '') {
  results.push({ label, ok:Boolean(condition), detail });
}
function requestStatus(pathname) {
  const target = new globalThis.URL(URL);
  return new Promise((resolve, reject) => {
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.request({
      hostname:target.hostname,
      port:target.port || (target.protocol === 'https:' ? 443 : 80),
      path:pathname,
      method:'GET',
    }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end();
  });
}

async function verifyMission(browser){
  const context = await browser.newContext({ viewport:{ width:1440, height:1000 }, reducedMotion:'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(URL);
    await page.waitForFunction(() => typeof publishedSignals !== 'undefined' && publishedSignals);
    if (process.env.PAP_CONTENT_BASELINE) {
      const baseline = JSON.parse(fs.readFileSync(path.join(process.env.PAP_CONTENT_BASELINE, 'content.json'), 'utf8'));
      const actual = await page.evaluate(() => ({ sixDs, futures, allocBuckets, chapters, questions,
        simulatorPresets, simulatorOutcomeLabels, bookSource:document.getElementById('bookSource').innerHTML,
        author:document.getElementById('author').textContent.replace(/\s+/g, ' ').trim() }));
      assert.deepEqual(actual, baseline, 'Authored book, strategies, portfolio, planner and author must remain exact');
      for (const file of ['predictions.json', 'author.json']) {
        assert.equal(fs.readFileSync(path.join(__dirname, file), 'utf8'),
          fs.readFileSync(path.join(process.env.PAP_CONTENT_BASELINE, file), 'utf8'), `${file} changed`);
      }
      const evidence = JSON.parse(fs.readFileSync(path.join(__dirname, 'signals.json'), 'utf8'));
      const originalEvidence = JSON.parse(fs.readFileSync(path.join(process.env.PAP_CONTENT_BASELINE, 'signals.json'), 'utf8'));
      if (!originalEvidence.forecastVersion) delete evidence.forecastVersion;
      if (!originalEvidence.capabilities) delete evidence.capabilities;
      assert.deepEqual(evidence, originalEvidence, 'Additive layers must not rewrite observations or their timestamps');
      console.log('[content-preservation] exact baseline match: forecast/author bytes, all book HTML, chapter text, strategies, portfolio and planner assumptions');
    }
    await page.clock.install();
    await page.evaluate(() => { window.sameDataNode = document.querySelector('.event'); });
    const firstPublishedAt = await page.evaluate(() => publishedSignals.updated);
    await page.clock.fastForward(16000);
    await page.locator('#refreshObservations').click();
    await page.waitForFunction(() => !observationController);
    assert.equal(await page.evaluate(() => window.sameDataNode === document.querySelector('.event')), true);
    assert.equal(await page.evaluate(() => publishedSignals.updated), firstPublishedAt);
    await page.clock.fastForward(16000);
    const hiddenState = await page.evaluate(async () => {
      const errorsBefore = observationFailures;
      const request = refreshPublishedObservations();
      const controller = observationController;
      Object.defineProperty(document, 'hidden', { configurable:true, value:true });
      document.dispatchEvent(new Event('visibilitychange'));
      await request;
      const attempt = observationLastAttempt;
      await refreshPublishedObservations();
      const state = { aborted:controller.signal.aborted, reason:controller.signal.reason,
        noHiddenRequest:observationLastAttempt === attempt, noOutage:observationFailures === errorsBefore };
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
      return state;
    });
    assert.deepEqual(hiddenState, { aborted:true, reason:'hidden', noHiddenRequest:true, noOutage:true });
    const ids = await page.evaluate(() => forecastRecords().map(row => row.id));
    assert.equal(ids.length, expectedEvents + expectedHorizon);
    assert.equal(await page.locator('#questProgress').getAttribute('value'), '0');
    assert.equal(await page.locator('#confirmPreparation').isDisabled(), true);
    await page.locator('#observationPrediction').selectOption(ids[0]);
    assert.match(await page.locator('.trajectory-state').textContent(), /not yet assessed/);
    await page.locator('#observationDetail .watch-button').click();
    assert.equal(await page.locator('#watchlist .watch-item').count(), 1);
    await page.locator('#observationDetail .source-inspection summary').click();
    await page.locator('#observationPrediction').selectOption(ids[1]);
    if (!await page.locator('#observationDetail .source-inspection').evaluate(node => node.open)) {
      await page.locator('#observationDetail .source-inspection summary').click();
    }
    await page.waitForFunction(() => !document.getElementById('confirmComparison').disabled);
    assert.equal(await page.locator('[data-quest="evidence-v1"] .quest-state').textContent(), 'To explore');
    await page.locator('#confirmComparison').click();
    await page.locator('[data-sim-preset="fast"]').click();
    await page.locator('#preparationAction').selectOption('first-plan-v1');
    assert.equal(await page.locator('[data-quest="action-v1"] .quest-state').textContent(), 'To explore');
    await page.locator('#confirmPreparation').check();
    await page.locator('[data-readiness="limits-v1"]').check();
    await page.locator('#readBookBtn').click();
    assert.equal(await page.locator('[data-quest="chapter-v1"] .quest-state').textContent(), 'To explore');
    await page.locator('[data-read-chapter]').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#questCount').textContent(), '4 / 4');
    await page.reload();
    await page.waitForFunction(() => publishedSignals);
    assert.equal(await page.locator('#questCount').textContent(), '4 / 4');
    assert.equal(await page.locator('#watchlist .watch-item').count(), 1);
    assert.equal(await page.locator('[data-readiness="limits-v1"]').isChecked(), true);
    assert.equal(await page.locator('#confirmPreparation').isChecked(), true);

    const semantics = await page.evaluate(() => {
      const stale = structuredClone(publishedSignals);
      stale.updated = stale.sourceFetchedAt = new Date(Date.now() - 40 * 3600000).toISOString();
      const outage = structuredClone(publishedSignals);
      outage.sourceStatus.mode = 'unavailable';
      const id = forecastRecords()[0].id;
      const fixture = {
        reviewed:true, reviewedBy:'Synthetic test reviewer', reviewedAt:new Date().toISOString(),
        direction:'supporting', criterion:{ id:'fixture', version:'1', description:'Synthetic criterion, never published' },
        measurement:{ value:1, unit:'fixture units', observedAt:new Date().toISOString() },
        source:{ url:Object.values(publishedSignals.embeds)[0].url, name:'Synthetic fixture',
          publishedAt:new Date().toISOString(), fetchedAt:new Date().toISOString() },
        rationale:'Synthetic test only', limitations:'Not a real observation',
      };
      const bundle = structuredClone(publishedSignals);
      bundle.observations = { schemaVersion:1, forecastSha256:forecastFingerprint,
        items:{ [id]:[fixture, { ...fixture, direction:'challenging' }] } };
      const mixed = trajectoryFor(id, bundle).label;
      bundle.observations.items[id] = [fixture];
      const supporting = trajectoryFor(id, bundle).label;
      bundle.observations.items[id] = [{ ...fixture, direction:'challenging' }];
      const challenging = trajectoryFor(id, bundle).label;
      bundle.observations.forecastSha256 = 'wrong';
      const mismatched = trajectoryFor(id, bundle).label;
      bundle.observations.forecastSha256 = forecastFingerprint;
      delete bundle.observations.items[id][0].measurement;
      const missingMeasurement = trajectoryFor(id, bundle).label;
      return { stale:bundleFreshness(stale), outage:bundleFreshness(outage), mixed, supporting, challenging,
        mismatched, missingMeasurement, unknown:trajectoryFor(id).label };
    });
    assert.match(semantics.stale, /Stale/);
    assert.match(semantics.outage, /outage/);
    assert.match(semantics.mixed, /Mixed/);
    assert.match(semantics.supporting, /Supporting/);
    assert.match(semantics.challenging, /Challenging/);
    for (const name of ['unknown', 'mismatched', 'missingMeasurement']) assert.match(semantics[name], /not yet assessed/);

    const original = await page.evaluate(() => structuredClone(publishedSignals));
    const revised = structuredClone(original);
    revised.updated = new Date().toISOString();
    const changedId = ids[0];
    const changed = revised.embeds[changedId] || revised.context.items[changedId];
    if (changed) changed.mappingRationale += ' Synthetic regression fixture; never published.';
    else revised.uncited.items[changedId].reason += '-synthetic-fixture';
    await page.route('**/signals.json', route => route.fulfill({ json:revised }));
    await page.locator('#observationPrediction').selectOption(changedId);
    await page.evaluate(() => { window.missionEventNode = document.querySelector('.event'); });
    await page.clock.fastForward(16000);
    await page.locator('#refreshObservations').click();
    await page.waitForFunction(updated => publishedSignals.updated === updated, revised.updated);
    assert.equal(await page.evaluate(() => window.missionEventNode === document.querySelector('.event')), true);
    assert.equal(await page.locator('#questCount').textContent(), '4 / 4');
    assert.equal(await page.locator('#confirmPreparation').isChecked(), true);
    assert.match(await page.locator(`[data-watch-status="${changedId}"]`).textContent(), /changed since/);
    const changedField = revised.embeds[changedId] ? 'citation details'
      : revised.context.items[changedId] ? 'dated background' : 'search outcome';
    assert.ok((await page.locator(`[data-watch-status="${changedId}"]`).textContent()).includes(changedField),
      'Watchlist must identify which observation field changed');
    await page.locator(`[data-ack="${changedId}"]`).click();
    assert.match(await page.locator(`[data-watch-status="${changedId}"]`).textContent(), /No observation change/);

    await page.unroute('**/signals.json');
    await page.route('**/signals.json', route => route.fulfill({ status:503, body:'Unavailable' }));
    await page.clock.fastForward(16000);
    await page.locator('#refreshObservations').click();
    await page.waitForFunction(() => observationError.includes('503'));
    assert.match(await page.locator('#observationFreshness').textContent(), /Last good bundle retained/);
    assert.equal(await page.evaluate(() => publishedSignals.updated), revised.updated);
    await page.unroute('**/signals.json');
    await page.route('**/signals.json', route => route.fulfill({ json:{ ...revised, forecastVersion:{ schemaVersion:1, sha256:'wrong' } } }));
    await page.clock.fastForward(16000);
    await page.locator('#refreshObservations').click();
    await page.waitForFunction(() => observationError.includes('versions'));
    assert.equal(await page.evaluate(() => publishedSignals.updated), revised.updated);

    await page.route('**/predictions.json', route => route.fulfill({ json:{ ...predictions, updated:'2026-09-01T00:00:00.000Z' } }));
    await page.clock.fastForward(16000);
    await page.locator('#refreshObservations').click();
    await page.waitForFunction(() => observationError.includes('different forecast revision'));
    assert.equal(await page.evaluate(() => publishedSignals.updated), revised.updated);
    await page.unroute('**/predictions.json');
    await page.unroute('**/signals.json');
    const readerUpdate = { ...revised, updated:new Date(Date.now() + 60000).toISOString() };
    await page.route('**/signals.json', route => route.fulfill({ json:readerUpdate }));
    await page.locator('#readBookBtn').click();
    await page.locator('#rdScroll').evaluate(node => { node.scrollTop = 240; });
    const readerBefore = await page.evaluate(() => ({ scroll:document.getElementById('rdScroll').scrollTop,
      focus:document.activeElement.id, html:document.getElementById('rdBody').innerHTML }));
    await page.clock.fastForward(1860000);
    await page.waitForFunction(() => pendingSignals);
    const readerAfter = await page.evaluate(() => ({ scroll:document.getElementById('rdScroll').scrollTop,
      focus:document.activeElement.id, html:document.getElementById('rdBody').innerHTML }));
    assert.deepEqual(readerAfter, readerBefore);
    await page.keyboard.press('Escape');
    await page.locator('#applyObservations').click();
    assert.equal(await page.evaluate(() => pendingSignals), null);

    const removed = await page.evaluate(() => {
      const id = '2099-999';
      missionState.watchlist[id] = { title:'Synthetic removed forecast', forecast:'{}', seen:'' };
      renderMission();
      return document.querySelector(`[data-watch-status="${id}"]`).textContent;
    });
    assert.match(removed, /No longer/);
    await page.locator('#missionReset').click();
    await page.locator('#cancelMissionReset').click();
    assert.equal(await page.locator('#questCount').textContent(), '4 / 4');
    await page.locator('#missionReset').click();
    await page.locator('#confirmMissionReset').click();
    assert.equal(await page.locator('#questCount').textContent(), '0 / 4');
    assert.equal(await page.locator('#watchlist .watch-item').count(), 0);
    await page.reload();
    await page.waitForFunction(() => publishedSignals);
    assert.equal(await page.locator('#questCount').textContent(), '0 / 4');
    assert.equal(await page.locator('#watchlist .watch-item').count(), 0);
    assert.deepEqual(errors, []);
    console.log('[mission] quests, real actions, persistence/reset, watchlist, reviewed/unknown/mixed/stale/outage/version states and reader-safe refresh passed');
  } finally { await context.close(); }

  for (const mode of ['denied', 'corrupt', 'invalid-snapshot', 'array-snapshot', 'null-snapshot']) {
    const context = await browser.newContext();
    try {
      const raw = mode === 'corrupt' ? '{broken' : JSON.stringify({
        version:1, quests:[], readiness:[], action:'', actionConfirmed:false,
        watchlist:{ '2026-0':{ title:'Synthetic storage fixture', forecast:'{}',
          seen:mode === 'array-snapshot' ? '[]' : mode === 'null-snapshot' ? 'null' : '{broken' } },
      });
      await context.addInitScript(({ mode, raw }) => {
        if (mode === 'denied') Object.defineProperty(window, 'localStorage', { get(){ throw new DOMException('Storage denied', 'SecurityError'); } });
        else localStorage.setItem('pap-mission-control:v1', raw);
      }, { mode, raw });
      const page = await context.newPage();
      await page.goto(URL);
      await page.waitForFunction(() => publishedSignals);
      assert.match(await page.locator('#missionStorage').textContent(), /Session only/);
      await page.locator('[data-readiness="limits-v1"]').check();
      assert.equal(await page.locator('[data-readiness="limits-v1"]').isChecked(), true);
      if (mode !== 'denied') assert.equal(await page.evaluate(() => localStorage.getItem('pap-mission-control:v1')), raw);
    } finally { await context.close(); }
  }
  console.log('[mission-storage] denied and corrupt storage are truthful session-only states');

  for (const theme of ['light', 'dark']) for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport:{ width, height:1000 }, reducedMotion:'reduce' });
    try {
      const page = await context.newPage();
      await page.goto(`${URL}${URL.includes('?') ? '&' : '?'}scoutTheme=${theme}`);
      await page.waitForFunction(() => publishedSignals);
      const geometry = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.mission-card')].map(node => node.getBoundingClientRect());
        return { overflow:document.documentElement.scrollWidth > innerWidth,
          cards:cards.length, within:cards.every(rect => rect.left >= 0 && rect.right <= innerWidth),
          overlapping:cards.some((a, i) => cards.slice(i + 1).some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)) };
      });
      assert.equal(geometry.cards, 4);
      assert.equal(geometry.overflow, false);
      assert.equal(geometry.within, true);
      assert.equal(geometry.overlapping, false);
      if (process.env.PAP_UI_ARTIFACT_DIR && width !== 320) {
        fs.mkdirSync(process.env.PAP_UI_ARTIFACT_DIR, { recursive:true });
        await page.screenshot({ path:path.join(process.env.PAP_UI_ARTIFACT_DIR, `hero-${width}-${theme}.png`) });
        await page.locator('#mission-control').scrollIntoViewIfNeeded();
        await page.screenshot({ path:path.join(process.env.PAP_UI_ARTIFACT_DIR, `dashboard-${width}-${theme}.png`) });
        await page.locator('#observationPrediction').selectOption(await page.locator('#observationPrediction option').nth(1).getAttribute('value'));
        await page.locator('#observations').scrollIntoViewIfNeeded();
        await page.screenshot({ path:path.join(process.env.PAP_UI_ARTIFACT_DIR, `observations-${width}-${theme}.png`) });
      }
    } finally { await context.close(); }
  }
  console.log('[mission-layout] non-overlapping cards and no overflow at 1440, 390 and 320px in both themes');
}

(async () => {
  const malformedStatus = await requestStatus('/%zz');
  const healthyStatus = await requestStatus('/');
  if (malformedStatus !== 400 || healthyStatus !== 200) {
    throw new Error(`Server URL handling failed: malformed=${malformedStatus}, healthy=${healthyStatus}`);
  }
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  let failures = 0;
  try { await verifyMission(browser); }
  catch (error) { await browser.close(); throw error; }
  if (process.argv.includes('--mission-only')) {
    await browser.close();
    console.log('RESULT: PASS - targeted mission-control checks');
    return;
  }

  for (const profile of profiles) {
    const context = await browser.newContext({
      viewport:{ width:profile.width, height:profile.height },
      isMobile:Boolean(profile.mobile),
      hasTouch:Boolean(profile.touch),
      reducedMotion:profile.reduced ? 'reduce' : 'no-preference',
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => consoleErrors.push(error.message));

    const separator = URL.includes('?') ? '&' : '?';
    await page.goto(`${URL}${separator}scoutTheme=${profile.theme}`, {
      waitUntil:'networkidle',
      timeout:45000,
    });
    /* RENDER_SETTLE_MS, not 5s. This wait asserts that the hero count matches the data; the timeout
       only says how long we are willing to wait for the render, and it is NOT part of the assertion.
       MEASURED 2026-08-27: this timed out at 5000ms during a full 17-gate run and passed immediately
       when verify:ui was run alone — the machine was busy, not the page wrong. A gate that fails
       because the host was loaded is a FALSE NEGATIVE, and false negatives are the most corrosive
       kind of gate failure: they block a scheduled publication for no reason and teach whoever is on
       the other end to re-run until green, which is how a real failure eventually gets waved through.
       Being patient costs a slow run nothing and weakens nothing — if the condition never becomes
       true this still fails, just later. */
    await page.waitForFunction(
      count => document.getElementById('heroEventCount')?.textContent.trim() === String(count),
      expectedEvents,
      { timeout:RENDER_SETTLE_MS }
    );

    const state = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
      const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
      const outcomeRows = [...document.querySelectorAll('.simulator-outcome')];
      const chapterBodies = [...document.querySelectorAll('#chapters .ch-body')];
      const simulatorInputs = [...document.querySelectorAll('.simulator-control input')];
      const svgTextNodes = [...document.querySelectorAll('#probabilitySimulatorMap text')];
      // every() over an empty list returns true, so each predicate below is gated on a
      // non-empty list and its size is reported: a selector that stops matching must
      // fail this gate, not silently degrade it to a vacuous pass.
      const outcomesDoNotOverlap = outcomeRows.length > 0 && outcomeRows.every(row => {
        const copy = row.querySelector('.simulator-outcome-copy').getBoundingClientRect();
        const stat = row.querySelector('.simulator-outcome-stat').getBoundingClientRect();
        return copy.right <= stat.left || copy.bottom <= stat.top || stat.bottom <= copy.top;
      });
      const figures = [...document.querySelectorAll('[data-editorial-figure]')];
      const visibleBrandTitles = [...document.querySelectorAll('.brand-text')]
        .map(element => element.childNodes[0]?.textContent.trim());
      return {
        theme:document.documentElement.dataset.theme,
        bodyWidth:document.body.scrollWidth,
        viewportWidth:document.documentElement.clientWidth,
        events:document.querySelectorAll('#timelineBody .event').length,
        years:document.querySelectorAll('.year-block').length,
        turningPoints:[...document.querySelectorAll('#turningPointsRoute .turning-point-link')].map(link => link.getAttribute('href')),
        oldDensityAbsent:!document.getElementById('timelineOverview') && !document.body.textContent.includes('Temporal index / event density'),
        brandTitles:visibleBrandTitles,
        readerBrand:document.querySelector('.reader-brand > span')?.textContent.trim(),
        collapsedYears:document.querySelectorAll('.year-block.is-collapsed').length,
        horizonNodes:document.querySelectorAll('#horizonMap .horizon-node').length,
        horizonCards:document.querySelectorAll('#horizonBody .horizon-item').length,
        reality:document.querySelectorAll('#signalsGrid .observation-card').length,
        chapters:document.querySelectorAll('#chapters .chapter').length,
        evidenceCards:document.querySelectorAll('#timelineBody .tl-signal:not(.tl-currency):not(.tl-context), #horizonBody .tl-signal:not(.tl-currency):not(.tl-context)').length,
        currencyCards:document.querySelectorAll('#timelineBody .tl-signal.tl-currency, #horizonBody .tl-signal.tl-currency').length,
        contextCards:document.querySelectorAll('#timelineBody .tl-signal.tl-context, #horizonBody .tl-signal.tl-context').length,
        contextAged:[...document.querySelectorAll('#timelineBody .tl-signal.tl-context, #horizonBody .tl-signal.tl-context')]
          .filter(card => /\d+\s+days?\s+old|months?\s+old|years?\s+old/i.test(card.textContent || '')).length,
        contextLabelled:[...document.querySelectorAll('#timelineBody .tl-signal.tl-context summary, #horizonBody .tl-signal.tl-context summary')]
          .filter(summary => /Dated background/i.test(summary.textContent || '')).length,
        evidenceUnavailable:document.querySelectorAll('#timelineBody .tl-signal-unavailable, #horizonBody .tl-signal-unavailable').length,
        predictionSearches:document.querySelectorAll('.tl-signal-search').length,
        /* X RETIREMENT 2026-08-13 - INVERTED. This called a search chip INVALID unless its href was
           an x.com/search url carrying from:peterxing, so it failed the build precisely BECAUSE the
           migration succeeded. No search chip is legitimate now, so the measure becomes "does the
           page reach X at all" - counted across every anchor and every script in the document,
           not only inside chips that no longer exist. */
        /* SPLIT 2026-08-27, WHEN X RETURNED AS A SUPPLEMENT. This probe counted EVERY X anchor in
           the document, which was exactly right while X was retired outright. The owner has since
           asked for @peterxing's posts back as a labelled trajectory layer, so a blanket count can
           no longer distinguish the thing that must never come back — an X post used as EVIDENCE —
           from the thing that was deliberately added. Counting them together would force a choice
           between deleting the feature and deleting the assertion.
           So the invariant is SHARPENED rather than relaxed: X links inside the evidence channel
           must still be ZERO, and supplement links are counted separately so their presence is
           measured rather than merely tolerated. */
        xLinksInEvidence:[...document.querySelectorAll('a[href]')].filter(link => {
          if (link.closest('.tl-xsignal')) return false;
          try { return /(?:^|\.)(?:x\.com|twitter\.com)$/i.test(new URL(link.href, location.href).hostname); }
          catch { return false; }
        }).length,
        xSupplementLinks:[...document.querySelectorAll('.tl-xsignal a[href]')].filter(link => {
          try { return /(?:^|\.)(?:x\.com|twitter\.com)$/i.test(new URL(link.href, location.href).hostname); }
          catch { return false; }
        }).length,
        /* Every supplement card must carry its disclaimer and a tier. A card that lost either would
           render as an unlabelled quote beside the evidence, which is the failure mode the whole
           two-channel separation exists to prevent. */
        xSupplementCards:document.querySelectorAll('.tl-xsignal').length,
        xSupplementDisclaimed:[...document.querySelectorAll('.tl-xsignal')]
          .filter(card => /not evidence/i.test(card.textContent)).length,
        xSupplementTiered:[...document.querySelectorAll('.tl-xsignal')]
          .filter(card => ['tracked', 'nearest'].includes(card.getAttribute('data-tier'))).length,
        /* A supplement must never be the ONLY thing under a prediction: it is appended to an
           evidence state, never a replacement for one. */
        xSupplementWithoutEvidence:[...document.querySelectorAll('#timelineBody .tl-xsignal, #horizonBody .tl-xsignal')]
          .filter(card => {
            const host = card.parentElement;
            if (!host) return true;
            return !host.querySelector('.tl-signal, .tl-signal-uncited, .tl-evidence-group, .tl-signal-unavailable');
          }).length,
        xScripts:[...document.querySelectorAll('script[src]')].filter(script =>
          /twitter\.com|x\.com/i.test(script.src)).length,
        uncitedCards:document.querySelectorAll('#timelineBody .tl-signal-uncited, #horizonBody .tl-signal-uncited').length,
        peterEvidence:[...document.querySelectorAll('.tl-signal:not(.tl-currency):not(.tl-context) summary')].filter(summary => /Peter Xing|Peter wrote|Peter reposted/.test(summary.textContent)).length,
        newsEvidence:[...document.querySelectorAll('.tl-signal:not(.tl-currency):not(.tl-context) summary')].filter(summary => /News evidence/.test(summary.textContent)).length,
        externalEvidence:[...document.querySelectorAll('.tl-signal:not(.tl-currency):not(.tl-context) summary')].filter(summary => /External evidence/.test(summary.textContent)).length,
        scenarioEvidence:[...document.querySelectorAll('.tl-signal:not(.tl-currency):not(.tl-context) summary')].filter(summary => /scenario source/i.test(summary.textContent)).length,
        leadingEvidence:[...document.querySelectorAll('.tl-signal:not(.tl-currency):not(.tl-context) summary')].filter(summary => /leading indicator/i.test(summary.textContent)).length,
        evidenceDashboard:{
          cited:document.getElementById('evidenceCitedStat')?.textContent.trim(),
          uncited:document.getElementById('evidenceUncitedStat')?.textContent.trim(),
          articles:document.getElementById('evidenceArticlesStat')?.textContent.trim(),
          publishers:document.getElementById('evidencePublishersStat')?.textContent.trim(),
          window:document.getElementById('evidenceWindowStat')?.textContent.trim(),
          newest:document.getElementById('evidenceNewestStat')?.textContent.trim(),
          typeMix:document.getElementById('evidenceTypeMix')?.textContent.replace(/\s+/g, ' ').trim(),
          source:document.getElementById('evidenceSourceHealth')?.textContent.replace(/\s+/g, ' ').trim(),
        },
        finder:{
          changed:document.querySelectorAll('#forecastChangeLinks .revision-link').length,
          deepLinks:document.querySelectorAll('#timelineBody .deep-link, #horizonBody .deep-link').length,
          allCount:document.querySelector('[data-domain-count="all"]')?.textContent.trim(),
          branchOptions:[...document.querySelectorAll('#branchFilter option')].map(option => option.textContent.trim()),
          probabilityOptions:[...document.querySelectorAll('#probabilityFilter option')].map(option => option.textContent.trim()),
          themeOptions:[...document.querySelectorAll('#themeFilter option')].map(option => option.textContent.trim()),
          resultCount:document.getElementById('filterResultCount')?.textContent.trim(),
          searchRegionRole:document.getElementById('atlasSearchResults')?.getAttribute('role'),
          searchInputRole:document.getElementById('atlasSearch')?.getAttribute('role'),
        },
        chapterBodies:chapterBodies.length,
        collapsedChapters:chapterBodies.length > 0 && chapterBodies.every(element => element.hidden),
        simulator:{
          map:Boolean(document.querySelector('#probabilitySimulatorMap svg')),
          controls:simulatorInputs.length,
          enabled:simulatorInputs.length > 0 && simulatorInputs.every(input => !input.disabled),
          probabilities:[...document.querySelectorAll('.simulator-outcome-stat')].map(element => element.textContent.trim()),
          disclaimer:document.getElementById('simulatorDisclaimer')?.textContent || '',
          labels:outcomeRows.map(row => row.getAttribute('aria-label')),
          noOverlap:outcomesDoNotOverlap,
          svgTextNodes:svgTextNodes.length,
          svgPercentText:svgTextNodes.length > 0 && svgTextNodes.every(element => !element.textContent.includes('%')),
        },
        figures:{
          count:figures.length,
          semantic:figures.every(figure => figure.querySelectorAll('.figure-semantic li, .turning-point-link').length >= 3),
          described:figures.every(figure => figure.querySelector('svg title')?.textContent.trim() && figure.querySelector('svg desc')?.textContent.trim()),
          motionReady:document.documentElement.classList.contains('figure-motion-ready'),
        },
        heroCount:document.getElementById('heroEventCount')?.textContent.trim(),
        coordinate:document.getElementById('heroCoordinate')?.textContent.trim(),
        freshness:document.getElementById('heroSignalFreshness')?.textContent.trim(),
        reducedDuration:getComputedStyle(document.querySelector('.hero-copy h1')).animationDuration,
        /* CROSS-REALM DEPENDENCY, STATED BECAUSE IT IS LOAD-BEARING AND INVISIBLE.
           `htmlText` is not declared in this file. It resolves because this code runs in the PAGE
           realm and app.js L507 `function htmlText(value){` is a top-level function declaration in
           a CLASSIC script (index.html L84 `<script src="app.js" defer>`, zero type="module" in the
           document), so it becomes a property of the page's global object.

           That is three unstated facts in two other files holding up one probe. IIFE-wrap app.js,
           convert it to type="module", or bundle it, and this throws ReferenceError inside the
           page — which, since this evaluate has no try/catch, kills the WHOLE `state` object and
           fails verify:ui at the evaluate's opening line, ~100 lines from the cause.

           Calling the real shipped function is the point: a local copy would test the copy and
           leave the site's actual escaping unverified. So the dependency stays and is made
           self-diagnosing instead — 'MISSING' is reported distinctly from a real escaping failure,
           and the check below names the cause. */
        escapedText:(() => {
          if (typeof htmlText !== 'function') return 'MISSING';
          const probe = document.createElement('div');
          probe.innerHTML = htmlText('&lt;img src=x onerror=alert(1)&gt;');
          return probe.children.length === 0 && probe.textContent === '<img src=x onerror=alert(1)>';
        })(),
        duplicateIds:[...new Set(duplicateIds)],
      };
    });

    const results = [];
    check(results, 'theme applied', state.theme === profile.theme, state.theme);
    check(results, 'no horizontal overflow', state.bodyWidth <= state.viewportWidth + 1, `${state.bodyWidth}/${state.viewportWidth}`);
    check(results, 'all forecast events render', state.events === expectedEvents, `${state.events}/${expectedEvents}`);
    check(results, 'all forecast years render', state.years === expectedYears, `${state.years}/${expectedYears}`);
    check(results, 'density minimap is fully removed', state.oldDensityAbsent);
    check(results, 'seven key turning points navigate to content',
      state.turningPoints.length === 7
      && state.turningPoints.filter(href => /^#event-/.test(href)).length === 6
      && state.turningPoints.includes('#post-superintelligence'),
      JSON.stringify(state.turningPoints));
    check(results, 'visible brand title is exact',
      state.brandTitles.length === 2
      && state.brandTitles.every(title => title === "The Hitchhiker's Guide to the Singularity")
      && state.readerBrand === "The Hitchhiker's Guide to the Singularity",
      JSON.stringify({ brands:state.brandTitles, reader:state.readerBrand }));
    check(results, 'later years compact by default', state.collapsedYears === profile.collapsedYears, `${state.collapsedYears}/${profile.collapsedYears}`);
    check(results, 'horizon map and cards align', state.horizonNodes === expectedHorizon && state.horizonCards === expectedHorizon);
    check(results, 'reality observations render, all of them',
      state.reality === artefactReality && state.reality > 0,
      `${state.reality}/${artefactReality}`);
    check(results, 'all chapters render', state.chapters === 13, String(state.chapters));
    check(results, 'collapsed chapters leave the accessibility tree',
      state.chapterBodies === 13 && state.collapsedChapters,
      JSON.stringify({ bodies:state.chapterBodies }));
    /* X retirement (2026-08-13). A prediction is no longer required to carry a card; it is
       required to be ACCOUNTED FOR. Every population is pinned to the artefact AND to the others,
       so a cited card quietly degrading into an uncited notice still fails.
       THIRD CHANNEL 2026-08-17: context cards are counted separately and excluded from the cited
       selectors, so a citation demoted to dated background is visible here as a change in BOTH
       counts rather than cancelling out inside one. */
    check(results, 'every prediction is accounted for as cited, context or uncited',
      state.evidenceCards === artefactCited
      && state.uncitedCards === artefactUncited
      && state.contextCards === artefactContext
      && state.evidenceCards + state.contextCards + state.uncitedCards === expectedEvents + expectedHorizon
      && state.predictionSearches === 0
      && state.evidenceUnavailable === 0,
      JSON.stringify({ cited:state.evidenceCards, expectedCited:artefactCited,
        context:state.contextCards, expectedContext:artefactContext,
        uncited:state.uncitedCards, expectedUncited:artefactUncited,
        total:expectedEvents + expectedHorizon,
        unavailable:state.evidenceUnavailable, searches:state.predictionSearches }));
    /* A context card that does not SHOW its age is indistinguishable from a current citation. */
    check(results, 'every context card states its age and is labelled dated background',
      state.contextCards === state.contextAged && state.contextCards === state.contextLabelled,
      JSON.stringify({ cards:state.contextCards, aged:state.contextAged, labelled:state.contextLabelled }));
    if (state.evidenceCards > 0) {
      /* X retirement (2026-08-13). Retired labels are asserted ABSENT rather than counted into
         a total: 'peter + external === cards' is satisfied trivially once both are zero and the
         card count is zero too, so it would pass on an empty page. Assert the positive claim
         (every card is labelled news) and the negative one (no X label survives) separately. */
      check(results, 'every cited card is labelled news evidence and no X label survives',
        state.newsEvidence === state.evidenceCards
        && state.peterEvidence === 0
        && state.externalEvidence === 0
        && state.scenarioEvidence === (expectedEvidenceTypes.scenario || 0)
        && state.leadingEvidence === (expectedEvidenceTypes['leading-indicator'] || 0),
        JSON.stringify({
          news:state.newsEvidence,
          cards:state.evidenceCards,
          retiredPeter:state.peterEvidence,
          retiredExternal:state.externalEvidence,
          scenario:state.scenarioEvidence,
          expectedScenario:expectedEvidenceTypes.scenario || 0,
          leading:state.leadingEvidence,
          expectedLeading:expectedEvidenceTypes['leading-indicator'] || 0,
        }));
    }
    /* Every figure is compared against signals.json, never against a literal, so the panel cannot
       drift from the artefact it summarises. Cited and uncited are asserted TOGETHER: publishing one
       without the other is exactly how 7-of-103 gets made to look like 7-of-7. */
    const expectedUncited = artefactUncited;
    const expectedWindow = Number(required(
      signals.uncited && signals.uncited.windowDays, 'uncited.windowDays', isCount));
    const expectedArticles = new Set(Object.values(signals.embeds || {}).map(e => e.id)).size;
    const expectedPublishers = new Set(Object.values(signals.embeds || {})
      .map(e => e.publisherHost).filter(Boolean)).size;
    check(results, 'evidence dashboard reports the cited/uncited accounting from signals.json',
      state.evidenceDashboard.cited === `${signals.coverage.cited} of ${signals.coverage.total}`
      && state.evidenceDashboard.uncited === String(expectedUncited)
      && state.evidenceDashboard.articles === String(expectedArticles)
      && state.evidenceDashboard.publishers === String(expectedPublishers)
      && state.evidenceDashboard.window === `${expectedWindow} days`
      && !/Peter wrote|Peter reposted|Maximum reviewed reuse|unique statuses/i.test(state.evidenceDashboard.typeMix)
      && !/Archive-verified|first-party status|Wayback|archive-discovered/i.test(state.evidenceDashboard.source)
      && /Live-verified sources/i.test(state.evidenceDashboard.source),
      JSON.stringify(state.evidenceDashboard));
    check(results, 'no X link, X script or X-era evidence card survives in the evidence channel',
      state.xLinksInEvidence === 0 && state.xScripts === 0 && state.predictionSearches === 0
      && state.peterEvidence === 0 && state.externalEvidence === 0,
      `xLinksInEvidence=${state.xLinksInEvidence} xScripts=${state.xScripts} `
      + `searches=${state.predictionSearches} peter=${state.peterEvidence} external=${state.externalEvidence}`);
    /* The supplement is asserted POSITIVELY as well as bounded. An artefact carrying trajectory
       signals that render as zero cards is a silent feature outage; every card that does render
       must state that it is not evidence, declare its tier, and sit beside an evidence state rather
       than in place of one. */
    const expectedXSignals = Object.keys((signals.xSignals && signals.xSignals.items) || {}).length;
    check(results, 'the @peterxing supplement renders as a labelled, disclaimed, non-substituting layer',
      state.xSupplementCards === state.xSupplementDisclaimed
      && state.xSupplementCards === state.xSupplementTiered
      && state.xSupplementWithoutEvidence === 0
      && state.xSupplementLinks === state.xSupplementCards
      && (expectedXSignals === 0 || state.xSupplementCards > 0),
      `cards=${state.xSupplementCards} disclaimed=${state.xSupplementDisclaimed} `
      + `tiered=${state.xSupplementTiered} orphaned=${state.xSupplementWithoutEvidence} `
      + `links=${state.xSupplementLinks} artefact=${expectedXSignals}`);
    check(results, 'every uncited prediction states its search instead of a fault',
      state.uncitedCards === expectedUncited && state.evidenceUnavailable === 0,
      `uncitedCards=${state.uncitedCards} expected=${expectedUncited} unavailable=${state.evidenceUnavailable}`);
    check(results, 'forecast finder exposes counts, deep links and latest revisions',
      state.finder.changed === expectedChanged
      && state.finder.deepLinks === expectedEvents + expectedYears + expectedHorizon
      && state.finder.allCount === String(expectedEvents)
      && state.finder.branchOptions.length === 5
      && state.finder.probabilityOptions.length === 6
      && state.finder.themeOptions.length === 8
      && state.finder.branchOptions.every(option => /· \d+$/.test(option))
      && state.finder.probabilityOptions.every(option => /· \d+$/.test(option))
      && state.finder.themeOptions.every(option => /· \d+$/.test(option)),
      JSON.stringify(state.finder));
    check(results, 'search uses a standard live results region rather than a partial combobox',
      state.finder.searchRegionRole === 'region' && state.finder.searchInputRole === null,
      JSON.stringify({ region:state.finder.searchRegionRole, input:state.finder.searchInputRole }));
    /* Reported as three outcomes, not two. `MISSING` means the probe never ran because `htmlText`
       was not a page global — an app.js packaging change, not an escaping failure — and saying so
       here is the difference between a one-line diagnosis and a ReferenceError 100 lines upstream. */
    check(results, 'JSON-derived text is escaped at render time',
      state.escapedText === true,
      state.escapedText === 'MISSING'
        ? 'PROBE DID NOT RUN: htmlText is not a page global — app.js must stay an unwrapped classic '
          + 'script (index.html <script src="app.js" defer>). An IIFE wrap, type="module" or a bundler '
          + 'removes the global this probe calls; re-expose it or move the probe.'
        : String(state.escapedText));
    check(results, 'probability simulator loads published anchors',
      state.simulator.map
      && state.simulator.controls === 3
      && state.simulator.enabled
      && JSON.stringify(state.simulator.probabilities) === JSON.stringify(['70%','18%','45%','42%','28%'])
      && state.simulator.labels.length === 5
      && state.simulator.labels.every(label => /^.+Conditional likelihood: \d+ percent\.$/i.test(label))
      && state.simulator.noOverlap
      && state.simulator.svgTextNodes > 0
      && state.simulator.svgPercentText
      && /Simulation only/i.test(state.simulator.disclaimer),
      JSON.stringify(state.simulator.probabilities));
    check(results, 'five editorial figures have useful semantic equivalents',
      state.figures.count === 5 && state.figures.semantic && state.figures.described,
      JSON.stringify(state.figures));
    check(results, 'hero uses fetched event count', state.heroCount === String(expectedEvents), state.heroCount);
    check(results, 'current coordinate is numeric', /^\d{4}\.\d{2}$/.test(state.coordinate || ''), state.coordinate);
    check(results, 'evidence state is exposed',
      /Evidence ·|Prediction evidence unavailable/.test(state.freshness || ''),
      state.freshness);
    check(results, 'ids are unique', state.duplicateIds.length === 0, state.duplicateIds.join(', '));
    check(results, 'console is clean', consoleErrors.length === 0, consoleErrors.join(' | '));

    await page.keyboard.press('Tab');
    check(results, 'skip link is first keyboard target',
      await page.evaluate(() => document.activeElement?.classList.contains('skip-link')));

    const targetYear = page.locator('.turning-point-link[href^="#event-2040-"]').first();
    await targetYear.click();
    check(results, 'turning-point route expands selected year',
      await page.locator('#year-2040').evaluate(element => !element.classList.contains('is-collapsed')));

    const evidenceToggle = page.locator('#overlayToggle');
    await evidenceToggle.click();
    const evidenceState = await page.evaluate(() => ({
      pressed:document.getElementById('overlayToggle').getAttribute('aria-pressed'),
      signalNodes:document.querySelectorAll('#timelineAtlas .tl-signal, #timelineAtlas .tl-signal-unavailable').length,
      hiddenEvidence:(() => {
        const signals = [...document.querySelectorAll('#timelineAtlas .tl-signal, #timelineAtlas .tl-signal-unavailable')];
        return signals.length > 0 && signals.every(element => getComputedStyle(element).display === 'none');
      })(),
      eventCount:document.querySelectorAll('#timelineBody .event').length,
    }));
    check(results, 'evidence toggle hides evidence only',
      evidenceState.pressed === 'false'
      && evidenceState.signalNodes > 0
      && evidenceState.hiddenEvidence
      && evidenceState.eventCount === expectedEvents,
      JSON.stringify({ signals:evidenceState.signalNodes, events:evidenceState.eventCount }));
    await evidenceToggle.click();

    await page.locator('.chip[data-domain="technology"]').click();
    const visibleTechnology = await page.locator('#timelineBody .event:not([hidden])').count();
    check(results, 'domain filter preserves exact technology count',
      visibleTechnology === expectedTechnology,
      `${visibleTechnology}/${expectedTechnology}`);
    await page.locator('.chip[data-domain="all"]').click();

    if (profile.name === 'desktop-light') {
      await page.locator('#branchFilter').selectOption('managed');
      const managedState = await page.evaluate(() => ({
        visible:document.querySelectorAll('#timelineBody .event:not([hidden])').length,
        query:new URL(location.href).searchParams.get('fb'),
      }));
      check(results, 'branch filter is counted and shareable',
        managedState.visible === expectedManaged && managedState.query === 'managed',
        JSON.stringify(managedState));
      await page.locator('#filterReset').click();

      await page.locator('#changesOnlyToggle').click();
      const changedState = await page.evaluate(() => ({
        visible:document.querySelectorAll('#timelineBody .event:not([hidden])').length,
        query:new URL(location.href).searchParams.get('fc'),
      }));
      check(results, 'latest-change view isolates revised events',
        changedState.visible === expectedChanged && changedState.query === '1',
        JSON.stringify(changedState));
      await page.locator('#filterReset').click();

      await page.locator('#atlasSearch').fill('orbital compute');
      const searchState = await page.evaluate(() => ({
        results:[...document.querySelectorAll('#atlasSearchResults .search-result[href]')].map(link => link.textContent.replace(/\s+/g, ' ').trim()),
        visible:document.querySelectorAll('#timelineBody .event:not([hidden])').length,
        query:new URL(location.href).searchParams.get('fq'),
        resultsVisible:!document.getElementById('atlasSearchResults').hidden,
      }));
      check(results, 'atlas search spans dated and horizon content with URL state',
        searchState.results.some(result => /^Prediction/i.test(result))
        && searchState.results.some(result => /^Horizon/i.test(result))
        && searchState.visible > 0
        && searchState.query === 'orbital compute'
        && searchState.resultsVisible,
        JSON.stringify(searchState));
      await page.locator('#searchClear').click();
    }

    await page.locator('[data-sim-preset="fast"]').click();
    await page.waitForTimeout(profile.reduced ? 20 : 320);
    const simulatedFast = await page.evaluate(() => ({
      cards:[...document.querySelectorAll('.simulator-outcome-stat')].map(element => Number.parseInt(element.textContent, 10)),
      hero:Number.parseInt(document.getElementById('heroAgiProbability').textContent, 10),
      interpretation:document.getElementById('simulatorInterpretation').textContent,
    }));
    check(results, 'simulator changes branch pressure without mutating forecast',
      simulatedFast.cards[0] > 70
      && simulatedFast.cards[2] > 45
      && simulatedFast.cards[3] > 42
      && simulatedFast.hero === 70
      && /strongest simulated pressure/i.test(simulatedFast.interpretation),
      JSON.stringify(simulatedFast));
    /* THE MAP MUST MOVE, NOT JUST THE NUMBERS UNDER IT.
       A reader reported that "changing the assumptions aren't changing the visual, only changes the
       % on the text callout below it", and they were right: the branches encoded probability only
       as stroke width and opacity, so driving a slider to its maximum moved a branch by 0.62px and
       left one branch bit-identical. Every simulator assertion above passed throughout, because all
       of them read TEXT - the cards, the hero, the interpretation. A chart that had silently stopped
       drawing its data would still have passed them all.
       THE MEASUREMENT, recorded here because app.js points at it and must not carry it to the
       browser. Probability was encoded ONLY as stroke width (2 + value/16) and opacity
       (.34 + value/150). Driving the capability slider from baseline to maximum moved the branches:
         managed     3.13px -> 2.94px   (0.19px thinner, opacity 0.46 -> 0.44)
         default     4.81px -> 5.38px   (0.57px thicker, opacity 0.64 -> 0.70)
         ungoverned  4.63px -> 5.25px   (0.62px thicker, opacity 0.62 -> 0.69)
         handoff     3.75px -> 3.75px   (NO CHANGE AT ALL - capability does not feed handoff)
       Stroke width compresses the whole 5-95% range into a few pixels, so a realistic 5-15 point
       move is a fraction of a pixel: the map was live in principle and static to a reader. Drawing
       the value as a proportional fill along the path makes a 9-point move 9% of the path length.
       So this measures the DRAWN GEOMETRY, before and after, and requires a change large enough for
       a human to see. The threshold is in SVG user units on a 720-unit-wide viewBox: 8 units is
       roughly a percentage point of a branch's length and comfortably above the sub-pixel change
       that shipped. */
    const branchGeometry = () => page.evaluate(() => {
      const read = {};
      for (const key of ['managed', 'handoff', 'default', 'ungoverned']) {
        const fill = document.getElementById('sim-path-' + key);
        const group = document.getElementById('sim-branch-' + key);
        if (!fill || !group || typeof fill.getTotalLength !== 'function') return null;
        const total = fill.getTotalLength();
        const drawn = Number.parseFloat(String(fill.style.strokeDasharray || '').split(/[ ,]+/)[0]);
        if (!Number.isFinite(drawn) || !(total > 0)) return null;
        read[key] = {
          drawn,
          share:drawn / total,
          stat:Number.parseInt(document.getElementById('sim-card-' + key).textContent, 10),
          leading:group.classList.contains('is-leading'),
        };
      }
      return read;
    });
    const fastGeometry = await branchGeometry();
    await page.locator('[data-sim-preset="baseline"]').click();
    await page.waitForTimeout(profile.reduced ? 20 : 420);
    const baselineGeometry = await branchGeometry();
    const geometryMoved = fastGeometry && baselineGeometry
      ? Object.keys(baselineGeometry).map(key => Math.abs(fastGeometry[key].drawn - baselineGeometry[key].drawn))
      : [];
    const largestMove = geometryMoved.length ? Math.max(...geometryMoved) : 0;
    /* The drawn length must also BE the number, not merely correlate with it. A fill that moves but
       no longer tracks its own statistic is a chart that lies more convincingly than one that is
       frozen, so every branch is checked against the percentage it claims to draw. */
    const tracksItsOwnNumber = baselineGeometry
      && Object.values(baselineGeometry).every(branch => Math.abs(branch.share * 100 - branch.stat) < 1.5);
    check(results, 'assumption changes move the branch map, not only the text',
      Boolean(fastGeometry) && Boolean(baselineGeometry)
      && largestMove >= 8
      && tracksItsOwnNumber
      && Object.values(baselineGeometry).filter(branch => branch.leading).length === 1,
      fastGeometry && baselineGeometry
        ? `largest drawn-length move ${largestMove.toFixed(1)} SVG units; tracksStat=${tracksItsOwnNumber}`
        : 'PROBE DID NOT RUN: branch fill geometry is missing — the map no longer draws probability '
          + 'as a proportional fill, so a reader cannot see an assumption change at all');

    const firstChapter = page.locator('#chapters .chapter').first();
    const firstChapterToggle = firstChapter.locator('.ch-head');
    await firstChapterToggle.click();
    check(results, 'chapter disclosure exposes content and state together',
      await firstChapterToggle.getAttribute('aria-expanded') === 'true'
      && await firstChapter.locator('.ch-body').evaluate(element => !element.hidden));
    await firstChapterToggle.click();
    check(results, 'chapter disclosure removes collapsed controls from navigation',
      await firstChapterToggle.getAttribute('aria-expanded') === 'false'
      && await firstChapter.locator('.ch-body').evaluate(element => element.hidden));

    const firstHorizonNode = page.locator('#horizonMap .horizon-node').first();
    const horizonId = await firstHorizonNode.getAttribute('data-horizon-target');
    await firstHorizonNode.click();
    const selectedHorizon = page.locator(`#horizon-${horizonId}`);
    check(results, 'horizon node opens and selects evidence ladder',
      await selectedHorizon.evaluate(element =>
        element.classList.contains('is-selected') && !element.classList.contains('is-collapsed')));

    const figureLocator = page.locator('[data-editorial-figure]');
    for (let index = 0; index < await figureLocator.count(); index++) {
      const figure = figureLocator.nth(index);
      await figure.scrollIntoViewIfNeeded();
      await page.waitForFunction(
        element => element.classList.contains('is-visible'),
        await figure.elementHandle(),
        { timeout:RENDER_SETTLE_MS }
      );
    }
    const figureMotion = await page.evaluate(() => ({
      motionReady:document.documentElement.classList.contains('figure-motion-ready'),
      figures:[...document.querySelectorAll('[data-editorial-figure]')].map(figure => {
        const draw = figure.querySelector('.figure-draw:not(.ruliad-branch)');
        const reveal = figure.querySelector('.figure-reveal');
        const drawStyle = getComputedStyle(draw);
        return {
          visible:figure.classList.contains('is-visible'),
          animationName:drawStyle.animationName,
          animationDuration:drawStyle.animationDuration,
          dashOffset:drawStyle.strokeDashoffset,
          revealOpacity:getComputedStyle(reveal).opacity,
        };
      }),
    }));
    if (profile.reduced) {
      check(results, 'reduced motion renders static editorial figures',
        !figureMotion.motionReady
        && figureMotion.figures.length === 5
        && figureMotion.figures.every(figure => figure.visible && figure.animationName === 'none' && Number(figure.revealOpacity) === 1),
        JSON.stringify(figureMotion));
    } else {
      check(results, 'normal motion visibly activates every editorial figure',
        figureMotion.motionReady
        && figureMotion.figures.length === 5
        && figureMotion.figures.every(figure =>
          figure.visible
          && figure.animationName.includes('editorial-path-draw')
          && !['0s','0.00001s','1e-05s'].includes(figure.animationDuration)),
        JSON.stringify(figureMotion));
    }

    /* The subject is EVERY element, not a remembered selector list, because the failure being
       hunted is "a keyframe escaped its @media (prefers-reduced-motion: no-preference) block" and
       that failure arrives on whatever element the new rule happens to target. Threshold 0.05s:
       the global `* { animation-duration:.01ms !important }` sweep at styles.css L1827 neutralises
       any keyframe authored OUTSIDE a no-preference block (currently `fade`) without changing its
       computed animation-name, so name alone would report a false positive. Duration is what the
       user experiences. */
    const motionAudit = await page.evaluate(() => {
      const animating = [];
      const names = new Set();
      for (const element of document.querySelectorAll('*')) {
        const style = getComputedStyle(element);
        const name = style.animationName;
        if (!name || name === 'none') continue;
        const longest = Math.max(...style.animationDuration.split(',').map(v => parseFloat(v) || 0));
        name.split(',').map(part => part.trim()).forEach(part => names.add(part));
        if (longest > 0.05) {
          const raw = element.className;
          animating.push({
            tag:element.tagName.toLowerCase(),
            cls:String(raw && raw.baseVal !== undefined ? raw.baseVal : (raw || '')).slice(0, 60),
            name,
            duration:style.animationDuration,
          });
        }
      }
      return { animating:animating.slice(0, 10), animatingCount:animating.length, names:[...names] };
    });
    motionAudit.names.forEach(name => observedAnimating.add(name));
    const undeclared = motionAudit.names.filter(name => !declaredKeyframes.includes(name));
    check(results, 'every animation running on the page is declared in styles.css',
      undeclared.length === 0, JSON.stringify(undeclared));
    if (profile.reduced) {
      check(results, 'reduced motion leaves NO element animating, site-wide',
        motionAudit.animatingCount === 0,
        JSON.stringify({ count:motionAudit.animatingCount, sample:motionAudit.animating }));
    } else {
      /* PAIRED POSITIVE CONTROL. Without this, the assertion above is satisfied by a page that
         animates nothing anywhere — a build that lost its motion layer entirely would report
         reduced-motion compliance. This is the same non-empty-subject rule the DOM quantifiers
         in this file already carry. */
      check(results, 'normal motion DOES animate (control: the reduced-motion assertion has a subject)',
        motionAudit.animatingCount > 0,
        JSON.stringify({ count:motionAudit.animatingCount, names:motionAudit.names }));
    }

    if (profile.mobile || profile.compactNav) {
      const menu = page.locator('#navToggle');
      await menu.click();
      check(results, 'mobile menu exposes expanded state', await menu.getAttribute('aria-expanded') === 'true');
      await menu.click();
    }

    const firstPlannerOption = page.locator('#plannerBody .opt').first();
    await firstPlannerOption.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      document.querySelector('#plannerBody .opt')?.getAttribute('aria-checked') === 'true'
      && document.activeElement?.classList.contains('opt'),
    null, { timeout:RENDER_SETTLE_MS });
    check(results, 'planner options are keyboard-operable radios',
      await page.locator('#plannerBody .opt').first().getAttribute('aria-checked') === 'true'
      && await page.evaluate(() => document.activeElement?.classList.contains('opt')));

    await page.locator('#readBookBtn').click();
    const readerState = await page.evaluate(() => ({
      open:!document.getElementById('reader').hidden,
      toc:document.querySelectorAll('#rdToc .rd-toc-item').length,
      inertSiblings:document.querySelectorAll('.content > :not(#reader)').length,
      inert:(() => {
        const siblings = [...document.querySelectorAll('.content > :not(#reader)')];
        return siblings.length > 0 && siblings.every(element => element.inert);
      })(),
      active:document.activeElement?.id,
    }));
    check(results, 'reader opens with complete route navigation',
      readerState.open && readerState.toc === 13 && readerState.inertSiblings > 0 && readerState.inert && readerState.active === 'rdClose');
    await page.keyboard.press('Escape');
    check(results, 'reader restores trigger focus',
      await page.evaluate(() => document.activeElement?.id === 'readBookBtn' && document.getElementById('reader').hidden));

    if (profile.reduced) {
      check(results, 'reduced motion removes staged animation',
        state.reducedDuration === '0.00001s' || state.reducedDuration === '1e-05s' || state.reducedDuration === '0s',
        state.reducedDuration);
    }

    const failed = results.filter(result => !result.ok);
    failures += failed.length;
    console.log(`[${profile.name}] ${results.length - failed.length}/${results.length} checks passed`);
    failed.forEach(result => console.log(`  FAIL ${result.label}${result.detail ? ` · ${result.detail}` : ''}`));
    await context.close();
  }

  /* Reported, NOT asserted. `sim-node-response` fires only on .simulator-map.is-updating and
     `fade` only on .fut-panel.active/.q-block/.result, so a declared keyframe can be legitimately
     unobserved across these profiles. Asserting "every declared keyframe was seen" would fail for
     correct code; asserting nothing would hide a keyframe that became dead. So it prints. */
  const unobserved = declaredKeyframes.filter(name => !observedAnimating.has(name));
  console.log(`[reduced-motion] ${declaredKeyframes.length} @keyframes declared in styles.css; `
    + `${observedAnimating.size} observed live`
    + (unobserved.length ? `; not exercised by these profiles: ${unobserved.join(', ')}` : ''));

  const restoreContext = await browser.newContext({ viewport:{ width:1280, height:900 } });
  const restorePage = await restoreContext.newPage();
  await restorePage.route('**/signals.json', async route => {
    await new Promise(resolve => setTimeout(resolve, 600));
    await route.continue();
  });
  const restoreSeparator = URL.includes('?') ? '&' : '?';
  await restorePage.goto(`${URL}${restoreSeparator}scoutTheme=light&fd=governance&fp=high#${restoreTargetId}`, {
    waitUntil:'networkidle',
    timeout:45000,
  });
  await restorePage.waitForFunction(
    count => document.querySelectorAll('#timelineBody .event').length === count,
    expectedEvents,
    { timeout:RENDER_SETTLE_MS }
  );
  await restorePage.waitForTimeout(700);
  const restored = await restorePage.evaluate(targetId => ({
    domain:document.querySelector('[data-domain][aria-pressed="true"]')?.dataset.domain,
    probability:document.getElementById('probabilityFilter')?.value,
    visible:document.querySelectorAll('#timelineBody .event:not([hidden])').length,
    targetVisible:!document.getElementById(targetId)?.hidden,
    yearExpanded:!document.getElementById('year-' + targetId.split('-')[1])?.classList.contains('is-collapsed'),
    activeId:document.activeElement?.id,
    scrollY:window.scrollY,
  }), restoreTargetId);
  if (restored.domain !== 'governance'
      || restored.probability !== 'high'
      || restored.visible !== expectedRestored
      || !restored.targetVisible
      || !restored.yearExpanded
      || restored.activeId !== restoreTargetId
      || restored.scrollY < 500) {
    failures++;
    console.log(`  FAIL filter and deep-link state restores on load · target=${restoreTargetId} `
      + `expectedVisible=${expectedRestored} · ${JSON.stringify(restored)}`);
  } else {
    console.log(`[restore-state] 1/1 checks passed (target ${restoreTargetId}, ${expectedRestored} in band)`);
  }
  await restoreContext.close();

  /* Every date on this site is a captured UTC instant. Formatting one in the reader's own zone
     makes a cited source's publication date depend on who is reading it — an article captured at
     2026-07-31T20:39:14Z renders "Aug 1, 2026" east of UTC+4 while the publisher's own page says
     July 31 — which contradicts a source the reader can check in one click. Two guards, because
     the static one alone would pass on a helper that was written correctly and then never called.
     The rendered one loads the real page at the two extremes of the inhabited offset range and
     requires byte-identical output, which is the property that actually matters: the same page
     must not assert two different publication dates for the same citation. */
  const appSource = require('fs').readFileSync(require('path').join(__dirname, 'app.js'), 'utf8');
  const bareFormatters = appSource.split('\n')
    .map((line, index) => ({ line:line.trim(), n:index + 1 }))
    .filter(row => /\.toLocale(Date|Time)?String\(/.test(row.line)
      && !/timeZone:'UTC'/.test(row.line)
      && !/Math\.round\(n\)/.test(row.line));
  if (bareFormatters.length) {
    failures++;
    console.log(`  FAIL app.js formats ${bareFormatters.length} date(s) in the reader's local zone · ${bareFormatters.map(r => `L${r.n}`).join(', ')}`);
  } else {
    console.log('[utc-dates] 1/1 static checks passed');
  }

  const zoneRenders = [];
  for (const timezoneId of ['Pacific/Kiritimati', 'Pacific/Midway']) {
    const zoneContext = await browser.newContext({ viewport:{ width:1280, height:900 }, timezoneId });
    const zonePage = await zoneContext.newPage();
    await zonePage.goto(`${URL}${URL.includes('?') ? '&' : '?'}scoutTheme=light`, { waitUntil:'networkidle' });
    await zonePage.waitForFunction(() => document.querySelectorAll('#timelineBody .event').length > 0);
    zoneRenders.push(await zonePage.evaluate(() => Array.from(
      document.querySelectorAll('.tl-currency[data-published-utc]'),
      node => ({
        utc:node.dataset.publishedUtc,
        rendered:node.querySelector('.tl-signal-date time')?.textContent?.trim() || '',
      }),
    )));
    await zoneContext.close();
  }
  const [east, west] = zoneRenders;
  const expectedCurrencyCards = Object.values(signals.currency || {}).reduce((sum, list) => sum + list.length, 0);
  const zoneMismatch = east.filter((row, index) => row.rendered !== west[index]?.rendered);
  const utcMismatch = east.filter(row => {
    const parsed = new Date(`${row.rendered} UTC`);
    return isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== row.utc;
  });
  /* The DOM is pinned to the artefact in BOTH directions: rows declared but not rendered
     fail, and rows rendered but not declared fail. An artefact that declares zero is
     reported as inert below rather than skipped, so 'no rows' can never read as 'passed'. */
  if (east.length !== expectedCurrencyCards || zoneMismatch.length || utcMismatch.length) {
    failures++;
    console.log(`  FAIL currency dates are reader-location dependent · cards ${east.length}/${expectedCurrencyCards} · zone mismatches ${zoneMismatch.length} · UTC mismatches ${utcMismatch.length}${utcMismatch.length ? ` · ${JSON.stringify(utcMismatch.slice(0, 3))}` : ''}`);
  } else {
    console.log(expectedCurrencyCards === 0
      ? '[utc-dates] currency layer is INERT: signals.currency declares 0 rows and the DOM renders 0. Nothing to compare; the artefact pin still holds in both directions.'
      : `[utc-dates] ${east.length}/${expectedCurrencyCards} currency dates identical at UTC+14 and UTC-11 and equal to the captured date`);
  }

  await browser.close();
  if (failures) {
    console.log(`RESULT: FAIL (${failures} observatory check${failures === 1 ? '' : 's'})`);
    process.exit(1);
  }
  console.log('RESULT: PASS — responsive observatory interactions, accessibility state and data encodings are coherent.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
