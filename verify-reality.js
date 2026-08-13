// Concurrency interlock: claim the tree before reading predictions/signals/approvals/floors.
if (require.main === module) require('./pipeline-lock').guard('verify:reality');

const { chromium } = require('playwright');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const SHOT = process.argv[3] || null;

// X retirement (2026-08-13): Reality Signals link to reviewed news articles, never to x.com.
// The allow-list is DERIVED from the declared news ledger so a new publisher cannot be
// forgotten here, and an undeclared host fails closed rather than passing by default.
const { NEWS_SOURCES } = require('./news-evidence.js');
const RETIRED_LINK_HOSTS = [
  'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com',
  'cdn.syndication.twimg.com', 'publish.twitter.com', 'platform.twitter.com'
];
const ALLOWED_LINK_HOSTS = [...new Set(
  Object.values(NEWS_SOURCES || {})
    .map(s => { try { return new global.URL(s.url).host; } catch (e) { return null; } })
    .filter(Boolean)
)];
if (!ALLOWED_LINK_HOSTS.length) {
  console.error('FATAL: no declared news publisher hosts; refusing to verify against an empty allow-list.');
  process.exit(1);
}
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
    const stats = await page.evaluate(({ allowedHosts, retiredHosts }) => {
      const cards = Array.from(document.querySelectorAll('#signalsGrid .card'));
      const links = document.querySelectorAll('#signalsGrid a.signal-src-link');
      const tags = cards.map(c => (c.querySelector('.card-num') || {}).textContent || '');
      const srcs = Array.from(links).map(a => a.textContent.trim().slice(0, 40));
      const hrefs = Array.from(links).map(a => a.getAttribute('href'));
      // Default-deny: every signal link must resolve to a DECLARED news publisher over https.
      const badHref = hrefs.map(h => {
        let u = null;
        try { u = new URL(h); } catch (e) { return h + ' -> unparseable href'; }
        if (u.protocol !== 'https:') return h + ' -> not https';
        if (retiredHosts.includes(u.host)) return h + ' -> RETIRED X host (' + u.host + ')';
        if (!allowedHosts.includes(u.host)) return h + ' -> undeclared publisher host (' + u.host + ')';
        return null;
      }).filter(Boolean);
      return { count: cards.length, links: links.length, tags, srcs, badHref };
    }, { allowedHosts: ALLOWED_LINK_HOSTS, retiredHosts: RETIRED_LINK_HOSTS });
    const ok = errors.length === 0 && stats.count >= 3 && stats.links >= 3 && stats.badHref.length === 0;
    console.log(`[${theme}] cards=${stats.count} links=${stats.links} badHref=${stats.badHref.length} errs=${errors.length} -> ${ok ? 'OK' : 'FAIL'}`);
    console.log('   tags:', JSON.stringify(stats.tags));
    console.log('   srcs:', JSON.stringify(stats.srcs.slice(0, 3)));
    if (stats.badHref.length) console.log('   BAD LINKS:', stats.badHref.slice(0, 5).join(' | '));
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
