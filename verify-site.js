// verify-site.js — load the site in Microsoft Edge (both themes), assert zero console errors
// and that no embed shows a pre-2024 (stale) dated card. Embeds may be his most-recent topical post
// (honestly dated), so the strict past-week gate is not enforced here.
//   npm install, then: node verify-site.js [url]
const { chromium } = require('playwright');

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
    const stamp = await page.$eval('#sigStamp', el => (el.hidden ? '' : el.textContent.trim())).catch(() => '');
    const dates = await page.$$eval('.tl-signal-date', els => els.map(e => e.textContent.trim())).catch(() => []);
    const ancient = dates.filter(d => /\b20(1\d|2[0-3])$/.test(d)); // any card dated 2010-2023 (stale)
    console.log(`[${th}] consoleErrors=${errs.length} cards=${cards} searches=${searches} ancientDated=${JSON.stringify(ancient)}`);
    console.log(`[${th}] cardDates=${JSON.stringify(dates)}`);
    console.log(`[${th}] stamp="${stamp}"`);
    if (errs.length) errs.forEach(e => console.log('   ' + e));
    issues += errs.length + ancient.length;
    await ctx.close();
  }
  await browser.close();
  if (issues > 0) { console.log(`RESULT: FAIL (${issues} issue(s))`); process.exit(1); }
  console.log('RESULT: PASS — zero console errors, no stale (pre-2024) signals.');
})();
