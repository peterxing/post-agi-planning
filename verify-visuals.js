'use strict';
if (require.main === module) require('./pipeline-lock').guard('verify:visuals');

/*
 * verify-visuals.js — headline cards, openly licensed report photos, X snippet cards and original
 * illustrations.
 *
 * Proves, fail-closed:
 *   - No publisher page is captured or reproduced: no screenshot file, capture tool or embedded image.
 *     Headline cards are drawn from the reviewed record and say they are not screenshots.
 *   - Every report photo is a small self-hosted WebP, pinned by size and SHA-256, under an allowed
 *     licence (public domain, CC0, CC BY or CC BY-SA) from its recorded Wikimedia Commons page, with
 *     its author, licence link, retrieval date and changes shown beside it. Its caption says it
 *     illustrates the topic unless it truly shows the event. Every photo is bound to current reports,
 *     is served and mirrored explicitly, and loads only after a reader opens a report.
 *   - X cards come from the retained supplement only: the handle, a display name only where the page
 *     itself knows it, the original timestamp linking to the post, and the stale badge exactly when
 *     the dossier shows the stale-snapshot warning. No X request and no image.
 *   - Every story, forecast, living signal and companion checkpoint/event/source carries one
 *     original illustration from the shared sprite, and both pages use identical rules and sprite.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { once } = require('node:events');
const { chromium } = require('playwright');
const { createPreviewServer, ALLOW_FILES } = require('./server');

const DIR = __dirname;
const SITE = process.env.PAP_SITE_CONFIG_DIR || 'C:\\Users\\peterxing\\pap-site';
const read = name => fs.readFileSync(path.join(DIR, name), 'utf8');
const SYMBOLS = ['agent', 'code', 'robot', 'chip', 'power', 'datacenter', 'orbit', 'market', 'work', 'governance', 'shield', 'globe',
  'health', 'brain', 'science', 'abundance', 'society', 'person', 'spark'];
const PHOTO_LIMITS = Object.freeze({ maxBytes: 32000, width: 480, height: 270, maxAlt: 200 });
const LICENCES = [
  { name: /^Public domain$/, url: null },
  { name: /^CC0 1\.0$/, url: /^https:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/$/ },
  { name: /^CC BY (\d\.\d)$/, url: version => new RegExp('^https:\\/\\/creativecommons\\.org\\/licenses\\/by\\/' + version.replace('.', '\\.') + '\\/$') },
  { name: /^CC BY-SA (\d\.\d)$/, url: version => new RegExp('^https:\\/\\/creativecommons\\.org\\/licenses\\/by-sa\\/' + version.replace('.', '\\.') + '\\/$') },
];

function identity(value) {
  const url = new URL(value);
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.href;
}

function photoLibrary(source = read('app.js')) {
  const start = source.indexOf('const PHOTO_LIBRARY = Object.freeze([');
  const end = source.indexOf(']);', start);
  assert.ok(start >= 0 && end > start, 'app.js declares PHOTO_LIBRARY');
  // Round-tripped so the records are plain objects of this realm, not of the sandbox.
  return JSON.parse(JSON.stringify(vm.runInNewContext(`(${source.slice(start + 'const PHOTO_LIBRARY = Object.freeze('.length, end + 1)})`, Object.create(null), { timeout: 1000 })));
}

function webpSize(bytes) {
  assert.equal(bytes.subarray(0, 4).toString('latin1'), 'RIFF');
  assert.equal(bytes.subarray(8, 12).toString('latin1'), 'WEBP');
  const chunk = bytes.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') { const bits = bytes.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
  throw new Error(`unknown WebP chunk ${chunk}`);
}

/* The single photo validator: the static gate, the tamper fixtures and (for bindings) the browser
   checks all use it. `reports` is the set of current NEWS article identities. */
function validatePhotos(library, { reports, files = name => fs.readFileSync(path.join(DIR, name)), today = new Date().toISOString().slice(0, 10) }) {
  const problems = [], bound = new Map();
  if (!Array.isArray(library) || !library.length) return ['PHOTO_LIBRARY must be a non-empty list'];
  for (const photo of library) {
    const where = `photo ${photo && photo.file}`;
    if (!photo || !/^photo-[a-z0-9-]+\.webp$/.test(photo.file)) { problems.push(`${where}: file name must be photo-<slug>.webp`); continue; }
    let bytes;
    try { bytes = files(photo.file); } catch { problems.push(`${where}: file is missing`); continue; }
    if (bytes.length > PHOTO_LIMITS.maxBytes || bytes.length !== photo.bytes) problems.push(`${where}: ${bytes.length} bytes is over the cap or differs from the recorded size`);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== photo.sha256) problems.push(`${where}: sha256 differs from the reviewed file`);
    try {
      const size = webpSize(bytes);
      if (size.width !== photo.width || size.height !== photo.height || photo.width !== PHOTO_LIMITS.width || photo.height !== PHOTO_LIMITS.height)
        problems.push(`${where}: dimensions ${size.width}x${size.height} differ from the recorded 480x270`);
    } catch (error) { problems.push(`${where}: not a valid WebP (${error.message})`); }
    const licence = LICENCES.find(rule => rule.name.test(photo.licence || ''));
    if (!licence) problems.push(`${where}: licence "${photo.licence}" is not public domain, CC0, CC BY or CC BY-SA`);
    else {
      const version = (photo.licence.match(/(\d\.\d)$/) || [])[1];
      const urlRule = typeof licence.url === 'function' ? licence.url(version) : licence.url;
      if (urlRule ? !(typeof photo.licenceUrl === 'string' && urlRule.test(photo.licenceUrl)) : photo.licenceUrl !== null)
        problems.push(`${where}: licence link does not match ${photo.licence}`);
      if (/-SA /.test(photo.licence) && !/shared under CC BY-SA/.test(photo.changes || '')) problems.push(`${where}: a CC BY-SA adaptation must say it is shared under the same licence`);
    }
    if (/\b(NC|ND)\b|non-?commercial|no ?deriv|fair use/i.test(`${photo.licence} ${photo.licenceUrl} ${photo.licenceNote || ''}`)) problems.push(`${where}: NC, ND and fair-use material is refused`);
    if (photo.licenceNote != null && (typeof photo.licenceNote !== 'string' || !photo.licenceNote.trim() || photo.licenceNote.length > 80)) problems.push(`${where}: licence note must be a short string`);
    if (!/^https:\/\/commons\.wikimedia\.org\/wiki\/File:[^\s/]+$/.test(photo.sourcePage || '')) problems.push(`${where}: source page must be its Wikimedia Commons file page`);
    if (typeof photo.author !== 'string' || !photo.author.trim()) problems.push(`${where}: author is not recorded`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(photo.retrieved || '') || photo.retrieved > today) problems.push(`${where}: retrieval date missing or in the future`);
    if (!/resized/i.test(photo.changes || '') || !/WebP/.test(photo.changes || '')) problems.push(`${where}: changes must record the resize and WebP conversion`);
    if (typeof photo.alt !== 'string' || !photo.alt.trim() || photo.alt.length > PHOTO_LIMITS.maxAlt) problems.push(`${where}: alt text missing or too long`);
    if (typeof photo.showsEvent !== 'boolean') problems.push(`${where}: showsEvent must be recorded`);
    else if (!photo.showsEvent && !/\bIllustrative\b/.test(photo.caption || '')) problems.push(`${where}: caption must say the photo is illustrative`);
    if (!Array.isArray(photo.reports) || !photo.reports.length) problems.push(`${where}: bound to no report`);
    for (const report of photo.reports || []) {
      let key;
      try { key = identity(report); } catch { problems.push(`${where}: report ${report} is not a URL`); continue; }
      if (!reports.has(key)) problems.push(`${where}: ${report} is not a current NEWS report`);
      if (bound.has(key)) problems.push(`${where}: ${report} already carries ${bound.get(key)}`);
      bound.set(key, photo.file);
    }
  }
  return problems;
}

function currentReports(signals) {
  return new Set([...Object.values(signals.embeds || {}), ...Object.values(signals.context?.items || {})]
    .map(record => identity(record.sourceKey || record.url)));
}

function staticChecks() {
  for (const gone of ['news-captures.json', 'capture-news-headlines.js']) assert.ok(!fs.existsSync(path.join(DIR, gone)), `${gone} is retired`);
  for (const name of ['app.js', 'index.html', 'ai-timeline.html', 'styles.css']) {
    assert.doesNotMatch(read(name), /news-captures|captureFigure|headline-capture|data:image\/(?:png|jpe?g|webp|gif|avif)/, `${name} embeds no screenshot or raster image data`);
  }
  const signals = JSON.parse(read('signals.json'));
  const reports = currentReports(signals);
  const library = photoLibrary();
  assert.deepEqual(validatePhotos(library, { reports }), [], 'PHOTO_LIBRARY is valid');
  const onDisk = fs.readdirSync(DIR).filter(name => /^photo-.*\.webp$/.test(name)).sort();
  assert.deepEqual(onDisk, library.map(photo => photo.file).sort(), 'Every photo on disk is reviewed, and every reviewed photo exists');

  const sample = library.find(photo => photo.licenceUrl) || library[0];
  const reject = (mutate, pattern, label) => {
    const copy = structuredClone(library), target = copy.find(photo => photo.file === sample.file);
    const files = mutate(copy, target) || (name => fs.readFileSync(path.join(DIR, name)));
    const problems = validatePhotos(copy, { reports, files });
    assert.ok(problems.some(problem => pattern.test(problem)), `${label}: ${JSON.stringify(problems.slice(0, 3))}`);
  };
  reject((_, photo) => { photo.licence = 'CC BY-NC 2.0'; }, /not public domain|NC, ND/, 'Non-commercial licence');
  reject((_, photo) => { photo.licence = 'CC BY-ND 4.0'; }, /not public domain|NC, ND/, 'No-derivatives licence');
  reject((_, photo) => { photo.licence = 'Fair use'; }, /not public domain|fair-use/, 'Fair use');
  reject((_, photo) => { photo.licenceUrl = 'https://creativecommons.org/licenses/by-nc/2.0/'; }, /licence link|NC, ND/, 'Mismatched licence link');
  reject((_, photo) => { photo.sourcePage = 'https://www.theverge.com/og-image.jpg'; }, /Wikimedia Commons file page/, 'Publisher or og:image source');
  reject((_, photo) => { photo.author = ' '; }, /author is not recorded/, 'Missing author');
  reject((_, photo) => { photo.retrieved = '2999-01-01'; }, /future/, 'Future retrieval date');
  reject((_, photo) => { photo.changes = 'none'; }, /resize/, 'Unrecorded changes');
  reject((_, photo) => { photo.caption = 'The robot in this report.'; }, /illustrative/, 'Caption implying the event');
  reject((_, photo) => { photo.reports = ['https://arstechnica.com/not-a-reviewed-report']; }, /not a current NEWS report/, 'Photo bound to a removed report');
  reject((copy, photo) => { copy.find(other => other !== photo).reports.push(photo.reports[0]); }, /already carries/, 'Two photos on one report');
  reject((_, photo) => { photo.sha256 = '0'.repeat(64); }, /sha256/, 'Replaced photo bytes');
  reject((_, photo) => { photo.file = 'photo-missing.webp'; }, /missing/, 'Missing file');
  reject(() => name => { const bytes = Buffer.from(fs.readFileSync(path.join(DIR, name))); bytes[bytes.length >> 1] ^= 1; return bytes; }, /sha256/, 'Altered photo bytes');
  reject(() => () => Buffer.alloc(PHOTO_LIMITS.maxBytes + 1), /over the cap|not a valid WebP/, 'Oversized or non-WebP file');

  const rules = name => {
    const text = read(name), start = text.indexOf('const ILLUSTRATION_RULES = ['), end = text.indexOf('];', start);
    assert.ok(start > 0 && end > start, `${name} declares ILLUSTRATION_RULES`);
    return text.slice(start, end).replace(/\s+/g, ' ');
  };
  assert.equal(rules('app.js'), rules('ai-timeline.html'), 'Main guide and companion use identical illustration rules');
  const ruleNames = [...rules('app.js').matchAll(/\['([a-z]+)', \//g)].map(match => match[1]);
  const sprite = name => {
    const match = read(name).match(/<svg id="illustrationSprite"[\s\S]*?<\/svg>/);
    assert.ok(match, `${name} embeds the illustration sprite`);
    return match[0];
  };
  const main = sprite('index.html');
  assert.equal(main, sprite('ai-timeline.html'), 'Both pages embed the identical sprite');
  assert.deepEqual([...main.matchAll(/<symbol id="ill-([a-z]+)"/g)].map(match => match[1]).sort(), [...SYMBOLS].sort());
  for (const name of [...ruleNames, 'spark', 'person']) assert.ok(SYMBOLS.includes(name), `Illustration ${name} exists in the sprite`);
  assert.match(main, /data-illustrations="original"/);
  assert.doesNotMatch(main, /<(image|script|foreignObject|a)\b|\shref=|xlink:|url\(|\son[a-z]+=/i, 'The sprite is self-contained original vector art');

  const publisher = read('publish-github.ps1'), surface = read('verify-deploy-surface.js'), server = read('server.js');
  const ignore = fs.readFileSync(path.join(SITE, '.vercelignore'), 'utf8'), deploy = fs.readFileSync(path.join(SITE, 'deploy.ps1'), 'utf8');
  assert.match(server, /'\.webp':'image\/webp'/, 'The preview serves WebP with its media type');
  for (const photo of library) {
    assert.ok(ALLOW_FILES.has(photo.file), `server.js serves ${photo.file}`);
    assert.ok(publisher.includes(`'${photo.file}'`), `publish-github.ps1 mirrors ${photo.file}`);
    assert.ok(surface.includes(`'${photo.file}'`), `PUBLIC_SURFACE lists ${photo.file}`);
    assert.ok(ignore.split(/\r?\n/).includes(`!${photo.file}`), `.vercelignore re-includes ${photo.file}`);
    assert.ok(deploy.includes(`'${photo.file}'`), `deploy.ps1 syncs ${photo.file}`);
  }
  assert.ok(!ALLOW_FILES.has('verify-visuals.js') && publisher.includes("'verify-visuals.js'"), 'verify-visuals.js is mirrored as tooling and never served');
  assert.equal(JSON.parse(read('package.json')).scripts['verify:visuals'], 'node verify-visuals.js');
  assert.doesNotMatch(read('ai-timeline.html'), /photo-[a-z0-9-]+\.webp|<img\b/, 'The self-contained companion loads no photo');
  return { photos: library.length, bytes: library.reduce((sum, photo) => sum + photo.bytes, 0), reports: library.reduce((sum, photo) => sum + photo.reports.length, 0) };
}

async function openStory(page, key) {
  const id = `article-${encodeURIComponent(key)}`;
  await page.evaluate(hash => { history.pushState(null, '', hash); revealHash(); }, `#${id}`);
  await page.waitForFunction(value => document.getElementById(value), id);
  if (!await page.locator(`[id="${id}"] .headline-card`).count()) await page.locator(`[id="${id}"] > details > summary`).click();
  await page.waitForFunction(value => document.querySelector(`[id="${value}"] .headline-card`), id);
  return page.locator(`[id="${id}"] .headline-card`).first();
}

async function browserChecks(base, summary) {
  const signals = JSON.parse(read('signals.json'));
  const predictions = JSON.parse(read('predictions.json'));
  const library = photoLibrary();
  const records = [...Object.entries(signals.embeds || {}), ...Object.entries(signals.context?.items || {})];
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const photoTypes = new Map();
    page.on('request', request => requests.push(request.url()));
    page.on('response', response => { if (/\/photo-[a-z0-9-]+\.webp$/.test(new URL(response.url()).pathname)) photoTypes.set(new URL(response.url()).pathname.slice(1), response.headers()['content-type']); });
    await page.goto(`${base}/?scoutTheme=light#timeline`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('yearContent')?.dataset.loaded === 'true');
    assert.ok(!requests.some(url => /photo-[a-z0-9-]+\.webp/.test(url)), 'No photo is fetched before a report is opened');
    assert.match(await page.locator('#timeline .section-heading .visual-note').textContent(),
      /^Icons are original topic illustrations\. .*not a screenshot.*Photos illustrate the topic, not the reported event\.$/, 'The timeline states what the images are, once');
    const coverage = await page.evaluate(() => {
      const uses = [...document.querySelectorAll('svg.ill')];
      return {
        stories: [...document.querySelectorAll('#yearContent .story')].map(story => !!story.querySelector(':scope > svg.ill')),
        forecasts: [...document.querySelectorAll('#yearContent .forecast-card')].map(card => !!card.querySelector(':scope > summary > svg.ill')),
        unresolved: uses.filter(svg => !document.getElementById(svg.querySelector('use')?.getAttribute('href')?.slice(1) || '-')).length,
        hidden: uses.filter(svg => { const box = svg.getBoundingClientRect(); return svg.checkVisibility() && !(box.width >= 30 && box.height >= 30); }).length,
        aria: uses.every(svg => svg.getAttribute('aria-hidden') === 'true'),
      };
    });
    assert.ok(coverage.stories.length > 0 && coverage.stories.every(Boolean), 'Every story carries an illustration');
    assert.ok(coverage.forecasts.length > 0 && coverage.forecasts.every(Boolean), 'Every forecast carries an illustration');
    assert.equal(coverage.unresolved, 0, 'Every illustration resolves to a sprite symbol');
    assert.equal(coverage.hidden, 0, 'Visible illustrations render at their intended size');
    assert.ok(coverage.aria, 'Illustrations are decorative to assistive technology');

    const articles = await page.evaluate(() => model.articles.map(article => ({ key: article.key, url: article.url, title: article.title,
      publisher: article.publisher, date: article.date.label, lastGood: article.connections.some(connection => connection.health?.status === 'last-good'),
      first: article.connections[0]?.id })));
    const quoteOf = article => (signals.embeds[article.first] || signals.context.items[article.first])?.quote;
    const photoOf = key => library.find(photo => photo.reports.some(report => identity(report) === key));
    const checkCard = async (card, article) => {
      assert.equal(await card.getAttribute('data-headline-card'), article.key);
      const title = card.locator('.headline-card-title a');
      assert.equal(await title.textContent(), article.title, 'The card shows the reviewed headline');
      assert.equal(identity(await title.getAttribute('href')), identity(article.url), 'The card headline links to the original');
      assert.equal(await card.locator('.headline-card-kind').textContent(), 'Headline card · not a screenshot');
      assert.equal(await card.locator('.headline-card-publisher').textContent(), article.publisher);
      assert.equal(await card.locator('.headline-card-dateline').textContent(), `Published ${article.date}`, 'Original date and its precision');
      assert.match(await card.locator('.headline-card-link a').textContent(), /^Read the original at /);
      const status = card.locator('.headline-card-status');
      if (article.lastGood) assert.match(await status.textContent(), /^Couldn't recheck today · last verified \d{1,2} [A-Z][a-z]+ \d{4}(?: \(date only\))? · publisher bot protection$/);
      else assert.equal(await status.count(), 0, 'No recheck label without a last-good record');
    };

    const withPhoto = articles.find(article => photoOf(article.key) && !article.lastGood);
    assert.ok(withPhoto, 'A report with a mapped photo exists');
    let card = await openStory(page, withPhoto.key);
    await checkCard(card, withPhoto);
    const quote = quoteOf(withPhoto), excerpt = await card.locator('.headline-card-quote').textContent();
    assert.ok(quote.startsWith(excerpt.replace(/…$/, '')), 'The short quote is an exact prefix of the reviewed quote');
    const photo = photoOf(withPhoto.key), figure = card.locator('.report-photo');
    const image = figure.locator('img');
    await image.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => { const img = document.querySelector('.report-photo img'); return img && img.complete && img.naturalWidth > 0; });
    assert.equal(await image.getAttribute('src'), photo.file, 'The photo is self-hosted');
    assert.equal(await image.getAttribute('loading'), 'lazy');
    assert.equal(await image.getAttribute('alt'), photo.alt);
    assert.equal(await image.evaluate(element => element.naturalWidth), photo.width);
    const caption = await figure.locator('figcaption').textContent();
    assert.ok(caption.includes(photo.caption) && caption.includes(`Photo: ${photo.author}`) && caption.includes(photo.licence)
      && caption.includes(`retrieved ${photo.retrieved}`) && caption.includes(photo.changes) && (!photo.licenceNote || caption.includes(`(${photo.licenceNote})`)), 'Visible credit, licence, retrieval date and changes');
    const creditLinks = await figure.locator('figcaption a').evaluateAll(links => links.map(element => element.href));
    assert.ok(creditLinks.includes(photo.sourcePage.replace(/\(/g, '%28').replace(/\)/g, '%29')) || creditLinks.includes(photo.sourcePage), 'The Commons source page is linked');
    if (photo.licenceUrl) assert.ok(creditLinks.includes(photo.licenceUrl), 'The licence is linked');
    assert.ok(requests.some(url => url === `${base}/${photo.file}`), 'The photo is requested from this origin only');
    assert.equal(photoTypes.get(photo.file), 'image/webp', 'The photo is served as image/webp');

    const lastGood = articles.find(article => article.lastGood);
    if (lastGood) await checkCard(await openStory(page, lastGood.key), lastGood);
    const plain = articles.find(article => !photoOf(article.key));
    card = await openStory(page, plain.key);
    await checkCard(card, plain);
    assert.equal(await card.locator('.report-photo').count(), 0, 'Reports without a genuinely relevant photo carry none');

    // Dossier: the card carries the headline link; the full reviewed quote stays below it.
    const [rowId, record] = records.find(([, value]) => photoOf(identity(value.sourceKey || value.url)));
    const row = predictions.years.flatMap(year => year.events.map((_, index) => `${year.year}-${index}`)).includes(rowId) ? `event-${rowId}` : rowId;
    await page.evaluate(hash => { history.pushState(null, '', hash); revealHash(); }, `#${row}`);
    await page.waitForFunction(value => document.getElementById(value)?.querySelector('.forecast-facts'), row);
    await page.locator(`#${row} > .forecast-facts > .forecast-dossier > summary`).click();
    await page.waitForFunction(value => document.querySelector(`[data-news-forecast="${value}"] .headline-card`), rowId);
    const news = page.locator(`[data-news-forecast="${rowId}"]`);
    assert.equal(identity(await news.locator('a[target="_blank"]').first().getAttribute('href')), identity(record.url), 'First external link in the NEWS dossier is the original');
    assert.equal(await news.locator('.headline-card-quote').count(), 0, 'The dossier card does not repeat the quote');
    assert.ok((await news.textContent()).includes(record.quote), 'The full reviewed quote remains in the dossier');

    // X snippet cards: retained supplement only.
    const xRows = predictions.years.flatMap(year => year.events.map((_, index) => `${year.year}-${index}`)).filter(id => signals.xSignals?.items?.[id]);
    const pickX = authorship => xRows.find(id => signals.xSignals.items[id].authorship === authorship);
    for (const id of [pickX('authored'), pickX('reposted')].filter(Boolean)) {
      const item = signals.xSignals.items[id];
      await page.evaluate(hash => { history.pushState(null, '', hash); revealHash(); }, `#event-${id}`);
      await page.waitForFunction(value => document.getElementById(value)?.querySelector('.forecast-facts'), `event-${id}`);
      if (!await page.locator(`[data-forecast-dossier="${id}"]`).count()) await page.locator(`#event-${id} > .forecast-facts > .forecast-dossier > summary`).click();
      await page.waitForFunction(value => document.querySelector(`[data-forecast-dossier="${value}"] .x-card`), id);
      const dossier = page.locator(`[data-forecast-dossier="${id}"]`), xcard = dossier.locator('.x-card');
      const stale = await dossier.locator('.x-stale').count() === 1;
      assert.equal(await xcard.getAttribute('data-x-stale'), String(stale));
      assert.equal(await xcard.locator('.x-stale-badge').count(), stale ? 1 : 0, 'The card badge mirrors the visible stale warning');
      if (item.authorship === 'authored') {
        assert.equal(await xcard.locator('.x-name').textContent(), await page.locator('#author h2').textContent(), "The site's own author name");
        assert.equal(await xcard.locator('.x-handle').textContent(), '@peterxing');
      } else {
        assert.equal(await xcard.locator('.x-name').textContent(), `@${item.author}`, 'An unknown display name is not invented');
        assert.equal(await xcard.locator('.x-name').getAttribute('title'), 'Display name not stored in this snapshot');
      }
      const time = xcard.locator('.x-time');
      assert.equal(await time.getAttribute('href'), new URL(item.url).href, 'The original timestamp links to the post');
      assert.equal(await time.getAttribute('target'), '_blank');
      assert.ok((await xcard.textContent()).includes(item.text), 'Card shows the retained post text');
      assert.equal(await xcard.locator('img').count(), 0, 'No X images or avatars are loaded');
    }
    assert.ok(!requests.some(url => /(^|\.)(x|twitter|twimg)\.com$/i.test(new URL(url).hostname)), 'No X network request');
    assert.ok(requests.every(url => url.startsWith(base) || url.startsWith('data:')), 'No third-party request from the reader');
    await page.evaluate(() => openExplore('#signals'));
    await page.waitForFunction(() => document.querySelectorAll('#signalsGrid .living-signal').length);
    assert.ok(await page.$$eval('#signalsGrid .living-signal', nodes => nodes.every(node => node.querySelector(':scope > svg.ill'))), 'Every living signal carries an illustration');
    assert.deepEqual(errors, [], 'No browser errors in the reader');
    await context.close();

    // Companion: illustrations on every data point, still fully self-contained and photo-free.
    const companion = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const cPage = await companion.newPage(), cRequests = [], cErrors = [];
    cPage.on('request', request => cRequests.push(request.url()));
    cPage.on('pageerror', error => cErrors.push(error.message));
    await cPage.goto(`${base}/ai-timeline?scoutTheme=dark`, { waitUntil: 'networkidle' });
    const every = selector => cPage.$$eval(selector, nodes => nodes.length > 0 && nodes.every(node => node.querySelector(':scope > svg.ill')));
    assert.ok(await every('.checkpoint-head'), 'Every checkpoint carries an illustration');
    assert.ok(await every('.event-card'), 'Every companion event carries an illustration');
    await cPage.locator('#tab-sources').click();
    assert.ok(await every('.source-card'), 'Every source carries an illustration');
    assert.ok(cRequests.every(url => url.startsWith(base)), 'Companion stays same-origin');
    assert.ok(!cRequests.some(url => /\.webp|\.jpe?g|\.png/.test(url)), 'Companion loads no photo');
    assert.deepEqual(cErrors, []);
    await companion.close();
  } finally {
    await browser.close();
  }
  return summary;
}

async function main() {
  const summary = staticChecks();
  // A live gate: an explicit base (the suite's owned preview or a production domain) is tested as served.
  const external = process.env.PAP_SITE_URL || process.argv.find(value => /^https?:\/\//.test(value));
  if (external) {
    await browserChecks(external.replace(/\/+$/, ''), summary);
    console.log(`verify:visuals PASS on ${external} ${String.fromCharCode(0x2014)} ${summary.photos} photos, headline cards, X cards and illustrations as served.`);
    return;
  }
  const server = createPreviewServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await browserChecks(`http://127.0.0.1:${server.address().port}`, summary);
  } finally {
    server.close();
  }
  console.log(`verify:visuals PASS — ${summary.photos} openly licensed photos (${summary.bytes} B) on ${summary.reports} reports; headline cards from the reviewed record; X cards from the retained supplement only; illustrations on every data point.`);
}

module.exports = { photoLibrary, validatePhotos };
if (require.main === module) main().catch(error => { console.error(error); process.exit(1); });
