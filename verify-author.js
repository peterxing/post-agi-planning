// Verifies the "About the Author" section renders + author.json overrides cleanly, 0 console errors.
const { chromium } = require(require('path').join(process.env.TEMP, 'pap-explore', 'node_modules', 'playwright'));

const BASE = process.argv[2] || 'http://127.0.0.1:8787';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  let failures = 0;
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    await page.goto(`${BASE}/?scoutTheme=${theme}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200); // allow author.json fetch+render

    const r = await page.evaluate(() => {
      const sec = document.getElementById('author');
      const name = document.getElementById('authorName');
      const headline = document.getElementById('authorHeadline');
      const bio = document.getElementById('authorBio');
      const roles = document.querySelectorAll('#authorRoles li');
      const talks = document.querySelectorAll('#authorTalks a.author-talk');
      const link = document.getElementById('authorLink');
      const talkTitles = Array.from(talks).map(a => (a.querySelector('h5') || {}).textContent || '');
      const talkHrefs = Array.from(talks).map(a => a.getAttribute('href'));
      // Is the section above the footer in document order?
      const footer = document.querySelector('footer.footer');
      const order = sec && footer ? (sec.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING) > 0 : false;
      return {
        hasSection: !!sec,
        name: name && name.textContent.trim(),
        headlineLen: headline ? headline.textContent.trim().length : 0,
        bioParas: bio ? bio.querySelectorAll('p').length : 0,
        roles: roles.length,
        talks: talks.length,
        talkTitles, talkHrefs,
        linkHref: link && link.getAttribute('href'),
        sectionBeforeFooter: order,
        accentOnVenue: (() => { const v = document.querySelector('.author-talk .talk-venue'); if(!v) return null; return getComputedStyle(v).color; })(),
      };
    });

    const checks = [
      ['section present', r.hasSection],
      ['name = Peter Xing', r.name === 'Peter Xing'],
      ['headline non-empty', r.headlineLen > 20],
      ['>=2 bio paragraphs', r.bioParas >= 2],
      ['4 roles', r.roles === 4],
      ['>=3 talks', r.talks >= 3],
      ['talk titles non-empty', r.talkTitles.every(t => t && t.length > 3)],
      ['talk hrefs http', r.talkHrefs.every(h => h && h.startsWith('http'))],
      ['linkedin link', (r.linkHref || '').includes('linkedin.com/in/peter-xing')],
      ['section before footer', r.sectionBeforeFooter === true],
      ['no console errors', errors.length === 0],
    ];
    console.log(`\n=== theme: ${theme} ===`);
    for (const [label, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; }
    if (errors.length) console.log('  console errors:', JSON.stringify(errors, null, 2));
    console.log('  talkTitles:', JSON.stringify(r.talkTitles));
    console.log('  venue color:', r.accentOnVenue);
    await page.screenshot({ path: `${process.env.TEMP}\\author-${theme}.png`, fullPage: false });
    await ctx.close();
  }
  await browser.close();
  console.log(`\nTOTAL FAILURES: ${failures}`);
  console.log(failures ? 'RESULT: FAIL' : 'RESULT: PASS');
  process.exit(failures ? 1 : 0);
})();
