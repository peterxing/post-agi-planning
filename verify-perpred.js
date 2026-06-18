const { chromium } = require('playwright');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const SHOT = process.argv[3] || null;
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  let pass = true;
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
    await page.goto(URL + '?scoutTheme=' + theme, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1200);
    // Default state already has the live overlay ON (signal predictions visible).
    const stats = await page.evaluate(() => {
      const events = document.querySelectorAll('#timelineBody .event').length;
      const cards = document.querySelectorAll('#timelineBody .event-body .tl-signal').length;
      const chips = document.querySelectorAll('#timelineBody .event-body .tl-signal-search').length;
      const strayCards = document.querySelectorAll('#timelineBody .year-row > div > .tl-signal').length;
      // collect any visible dates that look ancient (2010-2023)
      const dates = Array.from(document.querySelectorAll('.tl-signal-date')).map(d => d.textContent.trim());
      const ancient = dates.filter(t => /\b20(1\d|2[0-3])\b/.test(t));
      const badges = Array.from(document.querySelectorAll('.tl-signal-badge')).slice(0, 3).map(b => b.textContent.trim());
      return { events, cards, chips, strayCards, ancient, badges, sample: dates.slice(0, 3) };
    });
    const ok = errors.length === 0 && stats.cards > 20 && stats.strayCards === 0 && stats.ancient.length === 0 && (stats.cards + stats.chips) >= stats.events - 2;
    console.log(`[${theme}] events=${stats.events} cards=${stats.cards} chips=${stats.chips} stray=${stats.strayCards} ancient=${stats.ancient.length} errs=${errors.length} badges=${JSON.stringify(stats.badges)} -> ${ok ? 'OK' : 'FAIL'}`);
    if (errors.length) console.log('   ERRORS:', errors.slice(0, 4).join(' | '));
    if (stats.ancient.length) console.log('   ANCIENT:', stats.ancient.slice(0, 4).join(' | '));
    if (SHOT) await page.screenshot({ path: SHOT.replace('THEME', theme), fullPage: false });
    if (!ok) pass = false;
    await ctx.close();
  }
  await browser.close();
  console.log('RESULT: ' + (pass ? 'PASS' : 'FAIL'));
  process.exit(pass ? 0 : 1);
})();
