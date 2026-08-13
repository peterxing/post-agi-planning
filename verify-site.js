// verify-site.js — load the site in Microsoft Edge (both themes), assert zero console errors,
// complete EVIDENCE ACCOUNTING, and honest labeling of evergreen historical evidence.
// X retirement (2026-08-13): a prediction is no longer required to carry a card. It must be
// either CITED by a reviewed news source or explicitly recorded as UNCITED with a reason.
// The gate is the TOTALITY cited + uncited === total, so a prediction can never go missing.
//   npm install, then: node verify-site.js [url]
// Concurrency interlock: claim the tree before reading predictions/signals/approvals/floors.
if (require.main === module) require('./pipeline-lock').guard('verify');

const { chromium } = require('playwright');
const signals = require('./signals.json');

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
    const cards = await page.$$eval('.tl-signal:not(.tl-currency)', els => els.length).catch(() => 0);
    const currencyCards = await page.$$eval('.tl-signal.tl-currency', els => els.length).catch(() => 0);
    const searches = await page.$$eval('.tl-signal-search', els => els.length).catch(() => 0);
    const unavailable = await page.$$eval('.tl-signal-unavailable', els => els.length).catch(() => 0);
    const uncitedCards = await page.$$eval('.tl-signal-uncited', els => els.length).catch(() => 0);
    const expected = await page.$$eval('#timelineBody .event, #horizonBody .horizon-item', els => els.length).catch(() => 0);
    const stamp = await page.$eval('#sigStamp', el => (el.hidden ? '' : el.textContent.trim())).catch(() => '');
    const dashboard = await page.$eval('#evidenceDashboard', element => element.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
    const splitAssets = await page.evaluate(() => ({
      app:!!document.querySelector('script[src="app.js"]'),
      styles:!!document.querySelector('link[href="styles.css"]'),
    })).catch(() => ({ app:false, styles:false }));
    const dates = await page.$$eval('.tl-signal:not(.tl-currency) .tl-signal-date', els => els.map(e => e.textContent.trim())).catch(() => []);
    const mislabelledHistorical = await page.$$eval('.tl-signal:not(.tl-currency)', els => els.filter(card => {
      const date = card.querySelector('.tl-signal-date')?.textContent.trim() || '';
      const label = card.querySelector('summary')?.textContent || '';
      return /\b20(1\d|2[0-3])$/.test(date)
        && !/\b(?:Historical|Scenario source|Leading indicator|External evidence)\b/i.test(label);
    }).map(card => card.querySelector('.tl-signal-date')?.textContent.trim() || '')).catch(() => []);
    /* INVERTED 2026-08-13. Every clause required the stamp to ADVERTISE an X corpus - Peter wrote,
       Peter reposted, external, max reuse, archive-verified, first-party hydrated - so an honest news
       stamp would have failed here. The stamp must now carry the cited/uncited accounting, and must
       not resurrect any X-era phrase. */
    const uncitedCount = Number(signals.uncited && signals.uncited.count) || 0;
    const sourceHonest = stamp.includes(`${signals.coverage.direct} of ${signals.coverage.total} cited`)
      && stamp.includes(`${uncitedCount} searched with no qualifying source`)
      && /live-verified news and research/i.test(stamp)
      && !/Peter wrote|Peter reposted|max reuse|archive-verified|first-party hydrated/i.test(stamp)
      && /Live-verified sources/i.test(dashboard)
      && !/Archive-verified source chain|first-party status JSON/i.test(dashboard);
    const assetsValid = splitAssets.app && splitAssets.styles;
    /* The currency layer is ADDITIVE. The currency cards must be exactly the reviewed
       mappings — never more (a fabricated card) and never fewer (a card lost in rendering). */
    const expectedCurrency = Object.values(signals.currency || {}).reduce((n, list) => n + list.length, 0);
    const currencyExact = currencyCards === expectedCurrency;
    /* EVIDENCE ACCOUNTING. Rendered cited cards and rendered uncited notices must each match
       the artefact exactly, and together they must account for EVERY rendered prediction.
       Checking only the total would let a cited card silently become an uncited notice. */
    const citedExact = cards === Number(signals.coverage.direct);
    const uncitedExact = uncitedCards === uncitedCount;
    const totalityExact = (cards + uncitedCards) === expected;
    console.log(`[${th}] consoleErrors=${errs.length} cited=${cards}/${signals.coverage.direct} uncited=${uncitedCards}/${uncitedCount} totality=${cards + uncitedCards}/${expected} currency=${currencyCards}/${expectedCurrency} searches=${searches} unavailable=${unavailable} sourceHonest=${sourceHonest} splitAssets=${assetsValid} mislabelledHistorical=${JSON.stringify(mislabelledHistorical)}`);
    console.log(`[${th}] cardDates=${JSON.stringify(dates)}`);
    console.log(`[${th}] stamp="${stamp}"`);
    if (errs.length) errs.forEach(e => console.log('   ' + e));
    issues += errs.length + searches + unavailable
      + Number(!citedExact) + Number(!uncitedExact) + Number(!totalityExact)
      + mislabelledHistorical.length + Number(!sourceHonest) + Number(!assetsValid) + Number(!currencyExact);
    await ctx.close();
  }
  await browser.close();
  if (issues > 0) { console.log(`RESULT: FAIL (${issues} issue(s))`); process.exit(1); }
  console.log('RESULT: PASS — zero console errors, complete evidence accounting (cited + uncited = every prediction), zero searches, and honest historical labels.');
})();
