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

/* BUDGET RE-BASELINE — 11 Aug 2026, stated openly rather than quietly relaxed.
 *
 * Two deliberately-added features grew the page: estimated-month timing on all 96 dated
 * predictions (plus an undated rationale on the 7 horizon items), and the additive currency
 * evidence layer. Genuine waste was removed first — the timing markup was cut from 915 to
 * 531 nodes by merging fragmented spans, which also improved screen-reader phrasing — but
 * roughly 700 nodes and 3 KB are irreducible feature content, not slack.
 *
 * These two are PROXY budgets. The OUTCOME budgets they stand in for — DOM-interactive,
 * evidence-UI readiness and compressed first load — are all measured below, printed on every
 * run, and hold with wide margin. Their values are deliberately NOT quoted here; see the note
 * on re-quoted figures at the end of this block. There is no minification step, so explanatory
 * comments are charged against the byte ceiling at full weight, and the honest choice was to
 * keep the reasoning in the file rather than delete documentation to satisfy a byte count.
 * That trade is larger than this block used to claim, and the figure that serves the decision is
 * not "how much of the file is comments" but "how much deleting them would recover". MEASURED
 * 2026-08-13 UTC — the basis is named because this tree writes machine dates in UTC
 * (`new Date().toISOString()` in verify-news-evidence.js), the host runs at UTC+10, and a
 * hand-written date with no basis is one clock away from being a different day. The rule below
 * says an uncomputed figure must carry the date it was measured; a date that does not say which
 * clock it came from only half-carries it. In the on-disk BYTES this gate weighs — statSync, not
 * string length; the two differ here by 219 b of multi-byte characters, and quoting the char count
 * against a byte ceiling was the first version of this sentence — deleting every comment recovers
 * 13,072 b, 9.69% of the file: the comment spans occupy 12,922 b and a further 150 b is the
 * indentation and line terminators of the 149 lines that cease to exist with them.
 *
 * THIS FIGURE HAS BEEN WRONG TWICE AND THE SECOND WAY IS THE INSTRUCTIVE ONE. It was first
 * published as 13,063 b. Re-measuring it by CONSTRUCTION — build the file with every comment
 * deleted, then weigh it — gave 13,069 b, which matched the reviewer's independent figure exactly.
 * That agreement was worthless: the reconstruction joined lines with '\n', silently normalising
 * this file's CRLF, and the artefact happened to be the same size as the disagreement under
 * examination. AN INSTRUMENT ARTEFACT THAT COINCIDENTALLY REPRODUCES THE OTHER PARTY'S NUMBER IS
 * INDISTINGUISHABLE FROM INDEPENDENT CONFIRMATION, and is more dangerous than a plain error
 * because it arrives wearing corroboration. Settled by never joining at all: walk the original
 * characters, carry each line's own terminator, emit or drop whole lines. Confirmed by a second
 * decomposition that shares no code with the first (span bytes + the uncovered bytes on vanishing
 * lines = 12,922 + 150). Do not "correct" this back without rebuilding the file and weighing it.
 *
 * So a re-baseline has an option other than raising the ceiling, and it belongs in writing here
 * rather than being discovered under pressure.
 *
 * They stay tight on purpose — ~2% headroom each — so unbounded growth is still caught.
 * Raising either again requires the same explicit justification.
 *
 * MARGIN REPORTING added 2026-08-13. The paragraph above states a DESIGN margin of ~2%. app.js has
 * been running far below it, and nothing said so until the ceiling was crossed. A budget that
 * reports only at the moment it fails converts a slow drift into a surprise, and the surprise
 * arrives worded as "app.js exceeds 135 KB budget", which invites the next reader to raise the
 * number rather than to ask what grew. So every budget now prints its margin on every run, a
 * budget below its own declared design margin WARNS without failing, and the failure text carries
 * the overage and names itself a proxy. No ceiling moved: the pass/fail predicate is byte-for-byte
 * the one it replaced.
 *
 * STALE FIGURES REMOVED 2026-08-14. This block previously quoted app.js's headroom as "0.20%
 * (274 b of 135,000)" and its comment weight as "4.9 KB", alongside three outcome figures. Each
 * was a measurement of a moving quantity written without the window it was taken in, and the two
 * that were checked had both drifted: the headroom by 2.9x, and the comment weight by 2.6x in the
 * OTHER direction. Both failed in the way that costs most — the sentence whose whole job was to
 * warn how little slack remained under-reported the tightness, and the sentence justifying kept
 * documentation under-reported what that documentation costs. The rule this file now follows:
 *   - a figure describing a PAST event inside a dated block is a record, and stays (the 915 -> 531
 *     node reduction above);
 *   - a figure describing CURRENT state that this file recomputes and prints on every run is never
 *     quoted in prose — name the mechanism instead, because the print cannot go stale;
 *   - a figure describing current state this file does NOT compute must carry the date it was
 *     measured, so its age is legible without re-deriving it.
 * Four figures here were the second kind. They are gone, and the runs print them instead.
 */
const BUDGETS = [
  { name: 'index.html', bytes: sizes.index, ceiling: 150000 },
  { name: 'app.js', bytes: sizes.app, ceiling: 135000 },
  { name: 'styles.css', bytes: sizes.styles, ceiling: 95000 },
  { name: 'static shell', bytes: sizes.index + sizes.app + sizes.styles, ceiling: 375000 },
];
const DESIGN_MARGIN = 0.02;
const budgetReport = BUDGETS.map(budget => {
  const headroom = budget.ceiling - budget.bytes;
  return { ...budget, headroom, fraction: headroom / budget.ceiling };
});
for (const budget of budgetReport) {
  if (budget.headroom < 0) {
    problems.push(`${budget.name} exceeds its ${Math.round(budget.ceiling / 1000)} KB budget by `
      + `${-budget.headroom} b (${budget.bytes} of ${budget.ceiling}). This is a PROXY budget: read `
      + 'the outcome budgets printed below before considering a re-baseline, and raise the ceiling '
      + 'only with the explicit justification the block above requires.');
  }
}
const tightBudgets = budgetReport.filter(budget => budget.headroom >= 0 && budget.fraction < DESIGN_MARGIN);
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
    // Readiness means every prediction is ACCOUNTED FOR (X retirement 2026-08-13): it has
    // rendered either its cited origin card or its explicit uncited notice. Additive currency
    // cards are counted separately and never satisfy readiness for a prediction.
    expected => (document.querySelectorAll('.tl-signal:not(.tl-currency)').length
      + document.querySelectorAll('.tl-signal-uncited').length) === expected,
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
  if (metrics.domNodes > 6550) problems.push(`rendered DOM exceeds 6550-node budget: ${metrics.domNodes}`);
  if (metrics.cssRules > 750) problems.push(`CSS exceeds 750-rule budget: ${metrics.cssRules}`);
  if (metrics.overflowX) problems.push('mobile document has horizontal overflow');

  /* The OUTCOME budgets get the same treatment as the proxy ones. Reporting margins for the byte
     ceilings while leaving these to announce themselves at the moment they fail would reproduce the
     defect one layer down — and the CSS-rule ceiling in particular has run tighter than every static
     budget except app.js, invisibly, because nothing printed it. Its margin is not quoted here: this
     block computes it three lines below and prints it on every run, and a comment restating a value
     its own file recomputes is the stale-figure defect this gate was just cleaned of. Units differ
     per row, so the margin is carried as a fraction and the raw values are printed beside it. */
  const outcomeReport = [
    { name: 'DOM interactive', value: metrics.domInteractive, ceiling: 1000, unit: 'ms' },
    { name: 'evidence UI', value: appReadyMs, ceiling: 3000, unit: 'ms' },
    { name: 'first load', value: metrics.transferredBytes, ceiling: 300000, unit: 'b' },
    { name: 'rendered DOM', value: metrics.domNodes, ceiling: 6550, unit: 'nodes' },
    { name: 'CSS rules', value: metrics.cssRules, ceiling: 750, unit: 'rules' },
  ].map(budget => {
    const headroom = budget.ceiling - budget.value;
    return { ...budget, headroom, fraction: headroom / budget.ceiling };
  });
  const tightOutcomes = outcomeReport.filter(budget => budget.headroom >= 0 && budget.fraction < DESIGN_MARGIN);

  console.log(`Static bytes: index=${sizes.index}; app=${sizes.app}; css=${sizes.styles}; shell=${sizes.index + sizes.app + sizes.styles}`);
  console.log('Budget margins — PROXY (static bytes):');
  budgetReport
    .slice()
    .sort((a, b) => a.fraction - b.fraction)
    .forEach(budget => console.log(`  ${budget.headroom < 0 ? 'OVER' : budget.fraction < DESIGN_MARGIN ? 'TIGHT' : 'ok  '} `
      + `${budget.name.padEnd(15)} ${String(budget.bytes).padStart(7)} / ${String(budget.ceiling).padEnd(7)} `
      + `headroom ${String(budget.headroom).padStart(7)} b (${(budget.fraction * 100).toFixed(2)}%)`));
  console.log('Budget margins — OUTCOME (what the proxies stand in for):');
  outcomeReport
    .slice()
    .sort((a, b) => a.fraction - b.fraction)
    .forEach(budget => console.log(`  ${budget.headroom < 0 ? 'OVER' : budget.fraction < DESIGN_MARGIN ? 'TIGHT' : 'ok  '} `
      + `${budget.name.padEnd(15)} ${String(Math.round(budget.value)).padStart(7)} / ${String(budget.ceiling).padEnd(7)} `
      + `headroom ${String(Math.round(budget.headroom)).padStart(7)} ${budget.unit} (${(budget.fraction * 100).toFixed(2)}%)`));
  const allTight = [...tightBudgets, ...tightOutcomes];
  if (allTight.length) {
    console.log(`WARNING — ${allTight.length} budget(s) below the ~${DESIGN_MARGIN * 100}% design margin this file `
      + `declares: ${allTight.map(budget => `${budget.name} ${Math.round(budget.headroom)} ${budget.unit || 'b'}`).join('; ')}. `
      + 'Not a failure and not a reason to raise a ceiling — it is the notice that the next edit to '
      + 'that file may fail this gate, so the growth can be examined before it blocks a publish.');
  }
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
