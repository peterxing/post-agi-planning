'use strict';

// Concurrency interlock: claim the tree before reading predictions/signals/approvals/floors.
if (require.main === module) require('./pipeline-lock').guard('verify:performance');

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const predictions = require('./predictions.json');

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const files = {
  index: path.join(__dirname, 'index.html'),
  app: path.join(__dirname, 'app.js'),
  styles: path.join(__dirname, 'styles.css'),
};
const sizes = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, fs.statSync(file).size]));
const html = fs.readFileSync(files.index, 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const publisherSource = fs.readFileSync(path.join(__dirname, 'publish-github.ps1'), 'utf8');
const deployHelperPath = 'C:\\Users\\peterxing\\pap-site\\deploy.ps1';
const deployHelper = fs.existsSync(deployHelperPath) ? fs.readFileSync(deployHelperPath, 'utf8') : '';
const problems = [];
const expectedCards = predictions.years.reduce((sum, year) => sum + year.events.length, 0)
  + predictions.postSuperintelligence.items.length;

if (sizes.index > 150000) problems.push(`index.html exceeds 150 KB budget: ${sizes.index}`);
if (sizes.app > 130000) problems.push(`app.js exceeds 130 KB budget: ${sizes.app}`);
if (sizes.styles > 95000) problems.push(`styles.css exceeds 95 KB budget: ${sizes.styles}`);
if (sizes.index + sizes.app + sizes.styles > 370000) {
  problems.push(`static shell exceeds 370 KB budget: ${sizes.index + sizes.app + sizes.styles}`);
}
if (!/<script src="app\.js" defer><\/script>/.test(html)
    || !/<link rel="stylesheet" href="styles\.css"\s*\/>/.test(html)) {
  problems.push('index.html must load local cacheable app.js and styles.css assets');
}
if (/AR glasses reach mainstream adoption|verified inline baseline/.test(html)) {
  problems.push('index.html still contains the stale inline forecast duplicate');
}
for (const asset of ['app.js', 'styles.css']) {
  if (!serverSource.includes(`'${asset}'`)) problems.push(`server.js does not allow ${asset}`);
  if (!publisherSource.includes(`'${asset}'`)) problems.push(`publish-github.ps1 does not mirror ${asset}`);
  if (!deployHelper.includes(`'${asset}'`)) problems.push(`pap-site deploy helper does not sync ${asset}`);
}
if (!/Get-FileHash/.test(deployHelper) || !/Production mirror hash mismatch/.test(deployHelper)) {
  problems.push('pap-site deploy helper does not hash-verify the runtime mirror');
}
if (/git add -A/.test(publisherSource)
    || !/git add -- \$copiedAllowlist/.test(publisherSource)
    || !/unexpectedUntracked/.test(publisherSource)
    || !/unexpectedIgnored/.test(publisherSource)
    || !/unexpectedTracked/.test(publisherSource)) {
  problems.push('GitHub publisher does not stage and audit the explicit public allow-list');
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const started = Date.now();
  await page.goto(`${URL}${URL.includes('?') ? '&' : '?'}scoutTheme=light`, {
    waitUntil: 'load',
    timeout: 45000,
  });
  await page.waitForFunction(
    expected => document.querySelectorAll('.tl-signal').length === expected,
    expectedCards,
    { timeout: 15000 }
  );
  const appReadyMs = Date.now() - started;
  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    return {
      domInteractive: navigation?.domInteractive || 0,
      loadEventEnd: navigation?.loadEventEnd || 0,
      transferredBytes: (navigation?.transferSize || 0)
        + resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
      decodedBytes: (navigation?.decodedBodySize || 0)
        + resources.reduce((sum, entry) => sum + (entry.decodedBodySize || 0), 0),
      domNodes: document.querySelectorAll('*').length,
      cssRules: [...document.styleSheets].reduce((sum, sheet) => {
        try { return sum + sheet.cssRules.length; } catch { return sum; }
      }, 0),
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  await context.close();
  await browser.close();

  if (metrics.domInteractive > 1000) problems.push(`DOM interactive exceeds 1 s budget: ${metrics.domInteractive.toFixed(1)} ms`);
  if (appReadyMs > 3000) problems.push(`complete evidence UI exceeds 3 s budget: ${appReadyMs} ms`);
  if (metrics.transferredBytes > 300000) problems.push(`compressed first load exceeds 300 KB budget: ${metrics.transferredBytes}`);
  if (metrics.domNodes > 6200) problems.push(`rendered DOM exceeds 6200-node budget: ${metrics.domNodes}`);
  if (metrics.cssRules > 750) problems.push(`CSS exceeds 750-rule budget: ${metrics.cssRules}`);
  if (metrics.overflowX) problems.push('mobile document has horizontal overflow');

  console.log(`Static bytes: index=${sizes.index}; app=${sizes.app}; css=${sizes.styles}; shell=${sizes.index + sizes.app + sizes.styles}`);
  console.log(`Mobile load: transfer=${metrics.transferredBytes}; decoded=${metrics.decodedBytes}; interactive=${metrics.domInteractive.toFixed(1)}ms; appReady=${appReadyMs}ms; DOM=${metrics.domNodes}; CSS=${metrics.cssRules}`);
  if (problems.length) {
    console.log(`RESULT: FAIL (${problems.length} problem(s))`);
    problems.forEach(problem => console.log(`  - ${problem}`));
    process.exit(1);
  }
  console.log('RESULT: PASS — split assets, static budgets, compressed transfer, render readiness and mobile overflow are within limits.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
