'use strict';
if (require.main === module) require('./pipeline-lock').guard('verify:ai-timeline');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const acorn = require('acorn');
const { chromium } = require('playwright');
const { createPreviewServer, ALLOW_FILES } = require('./server');
const { createHash } = require('node:crypto');
const { applyReview, contentIdentity, actualsMetadata, serializePage, SourceCheckError } = require('./refresh-timeline-actuals');
const sha = value => createHash('sha256').update(value).digest('hex');

async function verifyDailyControls(data, html) {
  const key = 'fixture-reviewed-source', now = new Date(Math.max(Date.now(), Date.parse(data.actualsCheck.checkedAt || data.reviewedAt)) + 3600000).toISOString();
  const later = new Date(Date.parse(now) + 3600000).toISOString();
  const source = { publisher:'Fixture publisher', headline:'Explicit test article, never fetched', resolvedUrl:'https://example.org/monthly-fixture',
    publishedAt:'2026-01-15T00:00:00.000Z', textSha256:'a'.repeat(64) };
  const check = { now, sources:{[key]:source}, verify:async (id, row, options) => {
    assert.equal(options.requireStableText, true);
    return { problems:[], fetched:{ ok:true }, extracted:{ textSha256:row.textSha256 } };
  } };
  const base = { schemaVersion:1, reviewedBy:'Owner-authorized editorial review',
    checkpointSha256:sha(JSON.stringify(data.checkpoints)), checkedSources:[key],
    windowStart:new Date(Date.parse(now) - 6 * 86400000).toISOString().slice(0, 10), windowEnd:now.slice(0, 10),
    summary:'Fixture-only review of a selected canonical source; no live collection is claimed.', entries:[] };
  const unchanged = await applyReview(data, base, check);
  assert.equal(contentIdentity(unchanged), contentIdentity(data));
  assert.equal(unchanged.actualsCheck.status, 'checked');
  assert.equal(unchanged.actualsCheck.contentChangedAt, data.actualsCheck.contentChangedAt);
  assert.deepEqual(unchanged.events, data.events);
  const entry = { action:'add', id:'fixture-new-event', sourceKey:key,
    title:'Fixture headline, not a published fact', summary:'A deliberately synthetic test of reviewed additions.',
    limitation:'This fixture is never written or published as real evidence.', topics:['capabilities'],
    maps:[{ checkpoint:'agents', note:'Fixture connection only, to prove independent mapping validation.' }] };
  const added = await applyReview(data, { ...base, entries:[entry] }, check);
  assert.equal(added.events.length, data.events.length + 1);
  assert.equal(added.events.at(-1).date, source.publishedAt.slice(0, 10));
  assert.equal(added.actualsCheck.contentChangedAt, now);
  assert.deepEqual(added.checkpoints, data.checkpoints);
  assert.deepEqual(added.branches, data.branches);
  const again = await applyReview(added, base, { ...check, now:later });
  assert.equal(again.actualsCheck.contentChangedAt, now);
  assert.equal(again.actualsCheck.checkedAt, later);
  assert.equal(again.sources.find(source => source.canonicalNewsSource === key).reviewedAt, now.slice(0, 10));
  await assert.rejects(applyReview(added, { ...base, entries:[{ ...entry, id:'duplicate-article' }] }, check), /duplicate article/);
  await assert.rejects(applyReview(data, { ...base, checkedSources:[] }, check), /1-12/);
  await assert.rejects(applyReview(data, { ...base, checkpointSha256:'0'.repeat(64) }, check), /identity/);
  await assert.rejects(applyReview(data, { ...base, entries:[{ ...entry, date:'2030-01-01' }] }, check), /verified publication date/);
  await assert.rejects(applyReview(data, { ...base, entries:[{ ...entry, maps:[] }] }, check), /independently/);
  await assert.rejects(applyReview(data, base, { ...check, verify:async () => ({ problems:['HTTP unavailable'], fetched:{ok:false} }) }), SourceCheckError);
  assert.deepEqual(data, JSON.parse(html.match(/<script type="application\/json" id="timelineData">([\s\S]*?)<\/script>/)[1]), 'Failed controls never mutate original data');
  const injected = structuredClone(data);
  injected.events[0].summary = '</script><script>throw new Error("injected")</script>';
  assert.ok(serializePage(html, injected).includes('\\u003c/script>'), 'Embedded JSON cannot break out into HTML');
  const row = { url:data.sources[0].url, headline:'Original article', publisher:'Fixture',
    articleDate:'2026-01-15', quote:'A meaningful original statement.', mappingRationale:'A limited connection.', evidenceType:'leading-indicator' };
  const original = { embeds:{one:row}, context:{items:{}}, actualsRefresh:{contentChangedAt:now} };
  const aged = { embeds:{}, context:{items:{one:{...row,lastVerifiedAt:'2026-09-23T00:00:00.000Z'}}}, sourceFresh:true };
  assert.equal(actualsMetadata(original, aged, '2026-09-23T00:00:00.000Z').contentChangedAt, now, 'Window aging and check time are not new facts');
  assert.equal(actualsMetadata(original, { ...aged, context:{items:{one:{...row,quote:'A corrected statement.'}}} }, now).note.startsWith('Reviewed NEWS content changed'), true);
}

async function verify() {
  const html = fs.readFileSync(path.join(__dirname, 'ai-timeline.html'), 'utf8');
  const { parse } = await import('parse5');
  const parseErrors = [];
  const document = parse(html, { onParseError: error => parseErrors.push(error.code) });
  assert.deepEqual(parseErrors, [], 'HTML must parse without recovery errors');
  const nodes = [];
  function visit(node) {
    nodes.push(node);
    for (const child of node.childNodes || []) visit(child);
  }
  visit(document);
  const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
  const scripts = nodes.filter(node => node.tagName === 'script');
  assert.equal(scripts.length, 3, 'Only the theme, data, and application scripts are needed');
  assert.match(scripts[0].childNodes[0].value, /scoutTheme/);
  for (const script of scripts.filter(node => attr(node, 'type') !== 'application/json')) {
    assert.equal(attr(script, 'src'), undefined, 'No external runtime');
    acorn.parse(script.childNodes.map(node => node.value || '').join(''), { ecmaVersion:'latest' });
  }
  const dataScript = scripts.find(node => attr(node, 'id') === 'timelineData');
  const dataText = dataScript.childNodes.map(node => node.value || '').join('');
  const data = JSON.parse(dataText);
  await verifyDailyControls(data, html);
  const validDate = value => /^\d{4}-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/.test(value)
    && (value.length === 7 || new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value);
  assert.equal(data.schemaVersion, 1);
  assert.ok(validDate(data.reviewedAt) && data.reviewedAt.length === 10);
  assert.ok(data.reviewedAt <= new Date().toISOString().slice(0, 10), 'Review date cannot be in the future');
  const sources = new Map(data.sources.map(source => [source.id, source]));
  const checkpoints = new Map(data.checkpoints.map(checkpoint => [checkpoint.id, checkpoint]));
  for (const list of [data.sources, data.events, data.checkpoints]) {
    assert.ok(list.length > 0);
    assert.equal(new Set(list.map(item => item.id)).size, list.length);
  }
  assert.equal(new Set(data.sources.map(source => source.url)).size, data.sources.length, 'No duplicate sources');
  for (const source of data.sources) {
    const url = new URL(source.url);
    assert.equal(url.protocol, 'https:');
    assert.ok(!url.username && !url.password && source.dateNote && source.kind && source.publisher && source.title);
    assert.ok(source.published === null || (validDate(source.published) && source.published <= data.reviewedAt.slice(0, source.published.length)));
    assert.ok(data.events.some(event => event.source === source.id));
  }
  for (const event of data.events) {
    assert.ok(validDate(event.date) && event.date <= data.reviewedAt.slice(0, event.date.length), event.id + ': event is beyond cutoff');
    assert.ok(sources.has(event.source) && event.summary && event.limitation && event.maps.length);
    assert.equal(new Set(event.maps.map(mapping => mapping.checkpoint)).size, event.maps.length);
    for (const mapping of event.maps) assert.ok(checkpoints.has(mapping.checkpoint) && mapping.note);
  }
  assert.ok(data.events.some(event => event.date.length === 7), 'Month-only date fixture remains represented');
  assert.ok(data.sources.some(source => source.published === null), 'Undated guidance remains represented');
  assert.ok(data.events.some(event => event.date !== sources.get(event.source).published), 'Event and publication dates must not be conflated');
  assert.match(data.events.find(event => event.id === 'early-developer-study').limitation, /historical|early.2025/i);
  assert.match(data.events.find(event => event.id === 'developer-follow-up').limitation, /precise|reliable/i);
  assert.match(data.events.find(event => event.id === 'aisi-detection').limitation, /not a sandbox escape/i);
  assert.match(data.events.find(event => event.id === 'stanford-revision').limitation, /not a causal/i);
  assert.match(data.events.find(event => event.id === 'embedded-evaluators').limitation, /fund|independen/i);
  assert.ok(ALLOW_FILES.has('ai-timeline.html'));
  assert.ok(!ALLOW_FILES.has('verify-ai-timeline.js'));
  assert.match(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), /href="ai-timeline\.html"/);
  const publisher = fs.readFileSync(path.join(__dirname, 'publish-github.ps1'), 'utf8');
  assert.match(publisher, /'ai-timeline\.html'/);
  assert.match(publisher, /'verify-ai-timeline\.js'/);
  const ids = nodes.map(node => attr(node, 'id')).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, 'Static IDs are unique');
  assert.ok(Buffer.byteLength(html) < 180000, 'Keep the self-contained page under 180 KB uncompressed');
  for (const node of nodes) {
    assert.ok(!(node.attrs || []).some(attribute => /^on/i.test(attribute.name)), 'Use listeners, not inline event handlers');
    if (node.tagName === 'link') assert.ok(attr(node, 'href').startsWith('data:'), 'No fetched styles, fonts, or icons');
  }
  const application = scripts.at(-1).childNodes.map(node => node.value || '').join('');
  assert.doesNotMatch(application, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage|indexedDB)\b/, 'Snapshot must not fetch or use storage');

  const server = createPreviewServer();
  let browser;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const pageUrl = base + '/ai-timeline';
  try {
    for (const route of ['/ai-timeline', '/ai-timeline.html']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.equal(await response.text(), html);
      assert.equal((await fetch(base + route, { method:'HEAD' })).status, 200);
    }
    for (const route of ['/verify-ai-timeline.js', '/nested/ai-timeline.html', '/timeline-baseline.json']) {
      assert.equal((await fetch(base + route)).status, 404, route + ' must not be served');
    }
    browser = await chromium.launch({ channel:'msedge', headless:true });
    const context = await browser.newContext({ viewport:{ width:1440, height:1000 }, reducedMotion:'reduce' });
    const page = await context.newPage();
    const errors = [], network = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => network.push(request.url()));
    await page.goto(pageUrl + '?scoutTheme=light', { waitUntil:'networkidle' });
    assert.equal(await page.locator('#pageError').isVisible(), false);
    assert.equal(await page.locator('.checkpoint').count(), data.checkpoints.length);
    assert.equal(await page.locator('#eventCount').textContent(), String(data.events.length).padStart(2, '0'));
    assert.equal(await page.locator('.boundary').count(), 1);
    assert.equal(await page.locator('#checkpointList .scenario-card').count(), data.checkpoints.length * 2);
    const expectedMonths = [];
    for (let date = new Date('2026-01-01T12:00:00Z'); date.toISOString().slice(0, 7) <= data.reviewedAt.slice(0, 7); date.setUTCMonth(date.getUTCMonth() + 1))
      expectedMonths.push(new Intl.DateTimeFormat('en-GB', { month:'long', year:'numeric', timeZone:'UTC' }).format(date));
    assert.deepEqual(await page.locator('#monthlyComparison > .month-block > h3').allTextContents(), expectedMonths);
    assert.equal(await page.locator('#monthlyComparison > .month-block [data-event-id]').count(),
      data.events.filter(event=>event.date>='2026-01').length);
    assert.equal(await page.locator('#monthlyComparison .earlier-record [data-event-id]').count(),
      data.events.filter(event=>event.date<'2026-01').length);
    assert.ok(network.every(url => url.startsWith(base)), 'No upstream network requests from the artifact');
    await page.locator('#scenarioReferences > summary').click();
    await page.locator('#includeFuture').uncheck();
    assert.equal(await page.locator('.checkpoint[data-phase="future"]').count(), 0);
    await page.locator('#includeFuture').check();
    await page.locator('[data-topic="work"]').click();
    assert.equal(await page.locator('.checkpoint').count(), data.checkpoints.filter(checkpoint => checkpoint.topics.includes('work')).length);
    assert.equal(await page.locator('#monthlyComparison > .month-block [data-event-id]').count(), data.events.filter(event=>event.date>='2026-01'&&event.topics.includes('work')).length);
    await page.locator('#tab-reality').click();
    assert.equal(await page.locator('.event-row').count(), data.events.filter(event => event.topics.includes('work')).length);
    await page.locator('[data-topic="all"]').click();
    await page.locator('#monthFilter').selectOption('2024-10');
    assert.equal(await page.locator('.event-row').count(), data.events.filter(event => event.date.startsWith('2024')).length);
    await page.locator('#monthFilter').selectOption('all');
    await page.locator('#sortOrder').selectOption('oldest');
    const firstDate = [...data.events].filter(event=>event.date>='2026-01').sort((a, b) => a.date.localeCompare(b.date))[0].date;
    assert.equal(await page.locator('#panel-reality .event-date time').first().getAttribute('datetime'), firstDate);
    await page.locator('#sortOrder').selectOption('newest');
    const latest = data.events.filter(event => event.date.length === 10).map(event => event.date).sort().at(-1);
    assert.equal(await page.locator('#panel-reality .event-date time').first().getAttribute('datetime'), latest);
    await page.locator('#searchInput').fill('Stanford');
    assert.equal(await page.locator('.event-row').count(), 1);
    await page.locator('#tab-sources').click();
    assert.equal(await page.locator('.source-card').count(), 1);
    await page.locator('#searchInput').fill('"><img src=x onerror=alert(1)>');
    assert.equal(await page.locator('#panel-sources .empty-state').count(), 1);
    assert.equal(await page.locator('img[src="x"]').count(), 0);
    await page.locator('#panel-sources [data-reset]').click();
    assert.equal(await page.locator('.source-card').count(), data.sources.length);
    await page.locator('#tab-reality').click();
    await page.locator('#panel-reality [data-evidence="aisi-detection"]').click();
    assert.equal(await page.locator('#evidenceDialog').isVisible(), true);
    const detail = await page.locator('#dialogContent').textContent();
    assert.match(detail, /28 Jul 2026/);
    assert.match(detail, /4 Aug 2026/);
    assert.match(detail, /not a sandbox escape/i);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#evidenceDialog').isVisible(), false);
    assert.equal(await page.locator('#panel-reality [data-evidence="aisi-detection"]').evaluate(element => element === document.activeElement), true);
    await page.locator('#panel-reality [data-evidence="fable-release"]').click();
    assert.match(await page.locator('#dialogContent').textContent(), /day not specified/);
    await page.locator('#dialogContent [data-jump="expert"]').click();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#evidenceDialog').isVisible(), false);
    assert.equal(await page.locator('#panel-compare').isVisible(), true);
    assert.equal(await page.locator('#checkpoint-expert').isVisible(), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'checkpoint-expert');
    await page.locator('[data-branch="slowdown"]').click();
    assert.match(await page.locator('#branch2027').textContent(), /committee/);
    for (const [key, branch] of Object.entries(data.branches['2040'])) {
      await page.locator(`[data-branch-family="2040"][data-branch="${key}"]`).click();
      assert.ok((await page.locator('#branch2040').textContent()).includes(branch.title));
    }
    await page.locator('#tab-compare').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#tab-reality').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#tab-reality').evaluate(element => element === document.activeElement), true);
    await page.locator('#themeToggle').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.reload({ waitUntil:'networkidle' });
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(await page.locator('#tab-reality').getAttribute('aria-selected'), 'true');
    await page.goto(pageUrl + '?view=reality&topic=safety&year=2026&q=AISI&event=aisi-detection&scoutTheme=light', { waitUntil:'networkidle' });
    assert.equal(await page.locator('#evidenceDialog').isVisible(), true);
    assert.equal(await page.locator('#dialogTitle').textContent(), data.events.find(event => event.id === 'aisi-detection').title);
    await page.locator('#closeDialog').click();
    await page.waitForFunction(() => !new URL(location.href).searchParams.has('event'));
    assert.equal(await page.locator('#searchInput').inputValue(), 'AISI');
    assert.equal(await page.locator('#yearFilter').inputValue(), '2026');
    assert.equal(new URL(page.url()).searchParams.has('event'), false);
    await page.goto(pageUrl + '?view=missing&event=unknown', { waitUntil:'networkidle' });
    assert.equal(await page.locator('#pageError').isVisible(), true);
    assert.match(await page.locator('#pageError').textContent(), /invalid|unavailable/);
    await page.goto(pageUrl + '?scoutTheme=light', { waitUntil:'networkidle' });
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{ writeText:() => Promise.reject(new Error('Denied for test')) } }));
    await page.locator('#shareButton').click();
    assert.equal(await page.locator('#shareUrl').isVisible(), true);
    assert.equal(await page.locator('#shareUrl').inputValue(), page.url());

    const artifactDir = process.env.PAP_UI_ARTIFACT_DIR;
    if (artifactDir) fs.mkdirSync(artifactDir, { recursive:true });
    for (const theme of ['light', 'dark']) {
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height:width >= 768 ? 1000 : 844 });
        await page.goto(pageUrl + '?scoutTheme=' + theme, { waitUntil:'networkidle' });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${theme}/${width}: no horizontal overflow`);
        assert.equal(await page.locator('.checkpoint').count(), data.checkpoints.length);
        if (artifactDir && [1440, 390].includes(width)) {
          await page.screenshot({ path:path.join(artifactDir, `ai-timeline-${theme}-${width}.png`), fullPage:false });
          if (theme === 'light') {
            await page.locator('#checkpoint-research').scrollIntoViewIfNeeded();
            await page.screenshot({ path:path.join(artifactDir, `ai-timeline-comparison-${width}.png`), fullPage:false });
          }
        }
        await page.locator('#tab-reality').click();
        assert.equal(await page.locator('.event-row').count(), data.events.length);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Event view fits');
        if (artifactDir && width === 1440 && theme === 'light') {
          await page.locator('.event-row').first().scrollIntoViewIfNeeded();
          await page.screenshot({ path:path.join(artifactDir, 'ai-timeline-events.png'), fullPage:false });
        }
        await page.locator('#panel-reality [data-evidence="embedded-evaluators"]').click();
        assert.ok(await page.locator('#evidenceDialog').evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Dialog fits');
        await page.keyboard.press('Escape');
        await page.locator('#tab-sources').click();
        assert.equal(await page.locator('.source-card').count(), data.sources.length);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Source view fits');
      }
    }
    const links = await page.locator('a[href^="https:"]').evaluateAll(elements => elements.map(element => ({
      url:element.href, target:element.target, rel:element.rel
    })));
    assert.ok(links.length >= data.sources.length);
    assert.ok(links.every(link => link.target === '_blank' && link.rel.includes('noopener') && link.rel.includes('noreferrer')));
    assert.deepEqual(errors, [], 'No browser errors in either theme or any view');
    await context.close();

    const offline = await browser.newContext({ viewport:{ width:1280, height:900 } });
    const local = await offline.newPage();
    const { pathToFileURL } = require('node:url');
    await local.goto(pathToFileURL(path.join(__dirname, 'ai-timeline.html')).href, { waitUntil:'load' });
    assert.equal(await local.locator('.checkpoint').count(), data.checkpoints.length, 'Works directly from disk');
    await local.locator('#tab-reality').click();
    assert.equal(await local.locator('.event-row').count(), data.events.length);
    await local.locator('#panel-reality [data-evidence="embedded-evaluators"]').click();
    assert.equal(await local.locator('#evidenceDialog').isVisible(), true);
    await offline.close();

    const badContext = await browser.newContext();
    const badPage = await badContext.newPage();
    const broken = structuredClone(data);
    broken.events[0].date = '2099-01-01';
    const brokenHtml = html.replace(/(<script type="application\/json" id="timelineData">)[\s\S]*?(<\/script>)/,
      (match, opening, closing) => opening + JSON.stringify(broken) + closing);
    assert.notEqual(brokenHtml, html, 'The negative fixture must actually alter the payload');
    await badPage.route('**/ai-timeline', route => route.fulfill({ contentType:'text/html', body:brokenHtml }));
    await badPage.goto(pageUrl, { waitUntil:'load' });
    assert.equal(await badPage.locator('#pageError').isVisible(), true, 'Invalid evidence is not rendered as successful data');
    assert.equal(await badPage.locator('#explore').isVisible(), false);
    assert.equal(await badPage.locator('.checkpoint').count(), 0);
    await badContext.close();
    for (const timezoneId of ['Pacific/Honolulu','Pacific/Auckland']) {
      const calendarContext = await browser.newContext({ timezoneId });
      try {
        const calendarPage = await calendarContext.newPage();
        await calendarPage.clock.setFixedTime(new Date('2027-02-01T12:00:00Z'));
        const fixture = structuredClone(data);
        fixture.reviewedAt = '2027-01-15';
        const template = fixture.events[0];
        fixture.events.push({ ...template, id:'calendar-december', date:'2026-12-31', title:'December boundary fixture' },
          { ...template, id:'calendar-january', date:'2027-01-01', title:'January boundary fixture' },
          { ...template, id:'calendar-month-only', date:'2027-01', title:'Month precision fixture' });
        await calendarPage.route('**/ai-timeline', route => route.fulfill({ contentType:'text/html', body:serializePage(html, fixture) }));
        await calendarPage.goto(pageUrl);
        const labels = await calendarPage.locator('#monthlyComparison > .month-block > h3').allTextContents();
        assert.deepEqual(labels.slice(-2), ['December 2026','January 2027']);
        const january = await calendarPage.locator('#compare-month-2027-01 [data-event-id]').evaluateAll(rows=>rows.map(row=>row.dataset.eventId));
        assert.deepEqual(january, ['calendar-january','calendar-month-only'], 'Month-only is an undated bucket within the month, never invented January 1');
        await calendarPage.locator('#sortOrder').selectOption('newest');
        assert.deepEqual(await calendarPage.locator('#compare-month-2027-01 [data-event-id]').evaluateAll(rows=>rows.map(row=>row.dataset.eventId)), january);
        assert.equal(await calendarPage.locator('#pageError').isVisible(), false);
      } finally { await calendarContext.close(); }
    }
    const healthContext = await browser.newContext();
    try {
      const healthPage = await healthContext.newPage();
      const fixture = structuredClone(data), now = new Date().toISOString();
      fixture.actualsCheck = { status:'failed', attemptedAt:now, checkedAt:'2026-01-15T12:00:00.000Z',
        contentChangedAt:null, checkedSourceIds:['fixture-source'], summary:'Source unavailable; previously reviewed facts are retained.' };
      await healthPage.route('**/ai-timeline', route=>route.fulfill({contentType:'text/html',body:serializePage(html, fixture)}));
      await healthPage.goto(pageUrl);
      assert.match(await healthPage.locator('#actualsStatus').textContent(), /failed; last good facts retained/);
      assert.equal(await healthPage.locator('#eventCount').textContent(),String(data.events.length).padStart(2,'0'));
    } finally { await healthContext.close(); }
    console.log(`PASS: ${data.events.length} sourced events, ${data.checkpoints.length} checkpoints; complete mappings, date precision, filters, branches, deep links, keyboard/dialog behavior, both themes at four widths, local-file use, and fail-closed serving.`);
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

verify().catch(error => { console.error(error.stack); process.exitCode = 1; });
