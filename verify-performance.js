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
 * 13,069 b, 9.69% of the file. CONVENTION, because the figure is meaningless without one: comment
 * spans are removed, and a line left holding nothing but whitespace vanishes with its indentation
 * and terminator (149 lines do). Whitespace stranded before a comment on a line that SURVIVES is
 * not counted, because deletion alone does not reclaim it; tidying those lines too would give
 * 13,093 b. The smaller figure is published deliberately — this sentence exists to say a
 * re-baseline has headroom available, and understating available headroom is the safe direction.
 *
 * THIS FIGURE HAS BEEN WRONG TWICE AND THE SECOND WAY IS THE INSTRUCTIVE ONE. It was first
 * published as 13,063 b, then as 13,072 b. The 13,072 came from SUMMING TERMS — 12,922 b of
 * comment span plus 150 b of furniture on the vanishing lines — and summing is what made it wrong:
 * that span total credits one byte of line terminator per line comment, but 3 of this file's 4
 * line comments trail code, so those lines survive, still need their terminator, and never give
 * those 3 bytes back. A sum cannot see that; only a rebuild can.
 *
 * AND TWO INDEPENDENT DECOMPOSITIONS AGREED ON 13,072, WHICH IS WHY IT WAS PUBLISHED. They shared
 * no code and concurred, and concurrence was treated as settling it — one paragraph after this
 * same comment block warned that an artefact reproducing another party's figure is
 * indistinguishable from confirmation. Agreement between two of one's OWN constructions is weaker
 * evidence than agreement across parties, not stronger, and it was read as stronger.
 *
 * WHAT SETTLES IT IS A CONTROL, NOT A SECOND OPINION. Rebuild with an EMPTY comment set: the
 * output must equal the input byte-for-byte, which condemns any construction that rejoins lines
 * (this file is pure CRLF, and `split(/\r?\n/).join('\n')` fires that control by 2,324 b — the
 * exact defect that made an earlier attempt agree with the reviewer while both were wrong). Then
 * require the rebuild to contain 0 bare LF, as the source does. Do not "correct" this figure back
 * without rebuilding the file, weighing it, and running both controls.
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
/*
 * RE-BASELINE 2026-08-17 — app.js 135,000 -> 143,000. This is the explicit justification the
 * paragraph above requires, and it is a re-baseline for a NAMED FEATURE rather than for drift.
 *
 * WHAT GREW AND WHY: the evidence layer gained a third published channel. Until today a prediction
 * was either CITED or UNCITED, and a reviewed citation that aged past the 14-day currency window
 * silently stayed cited — the only age check on the cited channel was `newestItemAt`, which reads
 * the MOST RECENT citation and is therefore structurally incapable of detecting an aged-out one.
 * Two were found live at 15d and 17d. Such an article is neither current evidence nor nothing, so it
 * is now published as CONTEXT: dated background carrying its true publishedAt, age in days and age
 * bucket, rendered so a reader can tell a 200-day-old source from a 3-day-old one without clicking.
 * That is contextCard(), the shared qualityLabel(), and the third arm of hasCompleteSignalCoverage()
 * — approximately 5.6 KB of function bodies, not of commentary. It was trimmed first: the long-form
 * rationale for the channel lives in refresh-signals.js and verify-direct-coverage.js, which do not
 * ship to the browser, and the QUALITY map duplicated in currencyCard() was folded into
 * qualityLabel() (which also fixed two ledger values that rendered as the generic "Verified
 * publication"). What remains is the feature itself.
 *
 * WHY NOT HOLD THE LINE: app.js entered this run at 134,726 b — 274 b of headroom, 0.20%, an order
 * of magnitude below the ~2% DESIGN margin this block declares. The budget was already outside its
 * own stated design, so ANY real feature would have crossed it. Holding 135,000 would not have
 * bounded growth; it would have blocked a correctness fix and left aged-out citations published as
 * current. 143,000 restores a real margin (currently ~1.8%) rather than clearing today's number by a
 * hair and failing again tomorrow.
 *
 * WHAT STILL BOUNDS GROWTH: the 'static shell' ceiling is UNCHANGED at 375,000 and remains the
 * binding constraint on the sum — index 150,000 + app 143,000 + styles 95,000 = 388,000 exceeds it,
 * so the three per-file ceilings cannot all be spent. The OUTCOME budgets this proxy stands in for
 * were all measured healthy on the run that triggered this: first load 127,043/300,000, evidence UI
 * 746/3,000 ms, DOM interactive 61/1,000 ms, rendered DOM 4,690/6,550. Per this file's own rule
 * those are dated measurements of a moving quantity, recorded here as a record of this decision;
 * every run recomputes and prints them, so do not read them as current state.
 */
/*
 * RE-BASELINE 2026-08-24 — app.js 143,000 -> 145,000. Explicit justification, for a NAMED FEATURE
 * rather than for drift, following the 2026-08-17 precedent immediately above.
 *
 * WHAT GREW AND WHY: a reader reported that "changing the assumptions aren't changing the visual,
 * only changes the % on the text callout below it". They were right, and it was a real defect, not a
 * taste complaint: the branch map encoded probability ONLY as stroke width and opacity, so driving a
 * slider from baseline to maximum moved a branch by at most 0.62px and left the handoff branch
 * bit-identical. The chart was live in principle and static to a human. Probability is now drawn as a
 * proportional fill ALONG each branch, so a 9-point move is 9% of the path length, with endpoint
 * nodes that scale and a categorical highlight on the leading branch. That is shared geometry, a
 * fill path per branch, node scaling and the leader mark — function bodies and SVG structure.
 *
 * TRIMMED FIRST, per the precedent's own rule that what remains must be the feature. The change
 * landed at 144,714 b. The long-form measured rationale was moved to verify-observatory.js, which
 * holds the probe that guards this behaviour and does NOT ship to the browser; three shipped comment
 * blocks were condensed to their operative sentence; and the retired medium's logo constant was
 * DELETED — it had been dead code since the X retirement, referenced nowhere in the tree, and
 * shipping it kept retired vocabulary in the published payload. Those recovered 1,768 b and brought
 * the file to 142,946 b, which is UNDER the old ceiling.
 *
 * SO WHY MOVE THE CEILING AT ALL: because 142,946 clears 143,000 by 54 b — 0.04%, two orders of
 * magnitude below the ~2% design margin this file declares, and precisely the "clears today's number
 * by a hair and fails again tomorrow" state the 2026-08-17 block set the ceiling to escape. Holding
 * 143,000 would not bound growth; it would guarantee that the next one-line edit fails the gate and
 * invites exactly the reflexive number-raising this file exists to prevent. 145,000 restores a real
 * margin. It is deliberately +2,000 and not more: the feature is already paid for by the trim.
 *
 * WHAT STILL BOUNDS GROWTH: the 'static shell' ceiling is UNCHANGED at 375,000 and remains the
 * binding constraint on the sum — index 150,000 + app 145,000 + styles 95,000 = 390,000 exceeds it,
 * so the three per-file ceilings still cannot all be spent. The OUTCOME budgets this proxy stands in
 * for were all measured healthy on the run that triggered this: first load 134,356/300,000, evidence
 * UI 752/3,000 ms, DOM interactive 60/1,000 ms. Per this file's own rule those are dated measurements
 * of a moving quantity, recorded as a record of this decision; every run recomputes and prints them,
 * so do not read them as current state.
 */
const BUDGETS = [
  { name: 'index.html', bytes: sizes.index, ceiling: 150000 },
  { name: 'app.js', bytes: sizes.app, ceiling: 145000 },
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
