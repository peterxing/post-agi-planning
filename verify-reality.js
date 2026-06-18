const { chromium } = require('playwright');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const SHOT = process.argv[3] || null;
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  let pass = true;
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
    await page.goto(URL + '?scoutTheme=' + theme, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    const stats = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('#signalsGrid .card'));
      const links = document.querySelectorAll('#signalsGrid a.signal-src-link');
      const tags = cards.map(c => (c.querySelector('.card-num') || {}).textContent || '');
      const srcs = Array.from(links).map(a => a.textContent.trim().slice(0, 40));
      const hrefs = Array.from(links).map(a => a.getAttribute('href'));
      const badHref = hrefs.filter(h => !/^https:\/\/x\.com\/[^/]+\/status\/\d+$/.test(h));
      return { count: cards.length, links: links.length, tags, srcs, badHref };
    });
    const ok = errors.length === 0 && stats.count >= 3 && stats.links >= 3 && stats.badHref.length === 0;
    console.log(`[${theme}] cards=${stats.count} links=${stats.links} badHref=${stats.badHref.length} errs=${errors.length} -> ${ok ? 'OK' : 'FAIL'}`);
    console.log('   tags:', JSON.stringify(stats.tags));
    console.log('   srcs:', JSON.stringify(stats.srcs.slice(0, 3)));
    if (errors.length) console.log('   ERRORS:', errors.slice(0, 4).join(' | '));
    if (SHOT) {
      const sec = await page.$('#signals');
      await sec.scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
      await sec.screenshot({ path: SHOT.replace('THEME', theme) });
    }
    if (!ok) pass = false;
    await ctx.close();
  }
  await browser.close();
  console.log('RESULT: ' + (pass ? 'PASS' : 'FAIL'));
  process.exit(pass ? 0 : 1);
})();
