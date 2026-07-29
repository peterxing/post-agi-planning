// verify-site.js — load the site in Microsoft Edge (both themes), assert zero console errors,
// complete direct prediction evidence, and honest labeling of evergreen historical evidence.
//   npm install, then: node verify-site.js [url]
// Concurrency interlock: claim the tree before reading predictions/signals/approvals/floors.
if (require.main === module) require('./pipeline-lock').guard('verify');

const { chromium } = require('playwright');
const signals = require('./signals.json');
const expectedAuthorship = signals.coverage.byPeterAuthorship || { authored:0, reposted:0 };

(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8787/';
  const themes = ['dark', 'light'];
  let issues = 0;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const th of themes) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    const sep = url.includes('?') ? '&' : '?';
    await page.goto(url + sep + 'scoutTheme=' + th, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(2800);
    const cards = await page.$$eval('.tl-signal', els => els.length).catch(() => 0);
    const searches = await page.$$eval('.tl-signal-search', els => els.length).catch(() => 0);
    const unavailable = await page.$$eval('.tl-signal-unavailable', els => els.length).catch(() => 0);
    const expected = await page.$$eval('#timelineBody .event, #horizonBody .horizon-item', els => els.length).catch(() => 0);
    const stamp = await page.$eval('#sigStamp', el => (el.hidden ? '' : el.textContent.trim())).catch(() => '');
    const dashboard = await page.$eval('#evidenceDashboard', element => element.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
    const splitAssets = await page.evaluate(() => ({
      app:!!document.querySelector('script[src="app.js"]'),
      styles:!!document.querySelector('link[href="styles.css"]'),
    })).catch(() => ({ app:false, styles:false }));
    const dates = await page.$$eval('.tl-signal-date', els => els.map(e => e.textContent.trim())).catch(() => []);
    const mislabelledHistorical = await page.$$eval('.tl-signal', els => els.filter(card => {
      const date = card.querySelector('.tl-signal-date')?.textContent.trim() || '';
      const label = card.querySelector('summary')?.textContent || '';
      return /\b20(1\d|2[0-3])$/.test(date)
        && !/\b(?:Historical|Scenario source|Leading indicator|External evidence)\b/i.test(label);
    }).map(card => card.querySelector('.tl-signal-date')?.textContent.trim() || '')).catch(() => []);
    const sourceHonest = stamp.includes(`${expectedAuthorship.authored} Peter wrote`)
      && stamp.includes(`${expectedAuthorship.reposted} Peter reposted`)
      && stamp.includes(`${signals.coverage.byEvidenceOwner.external} external`)
      && stamp.includes(`max reuse ${signals.coverage.maxReuse}`)
      && /archive-verified/i.test(stamp)
      && /first-party hydrated/i.test(stamp)
      && /Archive-verified source chain/i.test(dashboard)
      && /first-party status JSON/i.test(dashboard);
    const assetsValid = splitAssets.app && splitAssets.styles;
    console.log(`[${th}] consoleErrors=${errs.length} cards=${cards}/${expected} searches=${searches} unavailable=${unavailable} sourceHonest=${sourceHonest} splitAssets=${assetsValid} mislabelledHistorical=${JSON.stringify(mislabelledHistorical)}`);
    console.log(`[${th}] cardDates=${JSON.stringify(dates)}`);
    console.log(`[${th}] stamp="${stamp}"`);
    if (errs.length) errs.forEach(e => console.log('   ' + e));
    issues += errs.length + searches + unavailable + Math.abs(cards - expected)
      + mislabelledHistorical.length + Number(!sourceHonest) + Number(!assetsValid);
    await ctx.close();
  }
  await browser.close();
  if (issues > 0) { console.log(`RESULT: FAIL (${issues} issue(s))`); process.exit(1); }
  console.log('RESULT: PASS — zero console errors, complete direct evidence, zero searches, and honest historical labels.');
})();
