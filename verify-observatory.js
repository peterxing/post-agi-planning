// Concurrency interlock: claim the tree before reading predictions/signals/approvals/floors.
if (require.main === module) require('./pipeline-lock').guard('verify:ui');

const { chromium } = require('playwright');
const http = require('http');
const https = require('https');
const predictions = require('./predictions.json');
const signals = require('./signals.json');

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
/* A12 CLASS (GC seq-115, 2026-08-13). An expectation coerced out of a MISSING field is not an
   expectation: `Number(x) || 0` turns a renamed or deleted operand into a comparison against 0,
   which the DOM then satisfies trivially, and the arm goes on to print the conclusion of a
   measurement it never made. Absence is therefore a REFUSAL here, taken before any arm runs, and
   the message NAMES the field so the failure can never be read as a data regression.
   Proven by mutation: renaming or deleting coverage.cited must abort this file, not pass it. */
function required(value, fieldPath, predicate) {
  if (value === undefined || value === null || !predicate(value)) {
    console.error(`[verify:ui] REFUSED — signals.json ${fieldPath} is missing or unusable `
      + `(got ${JSON.stringify(value)}). No expectation can be derived from an absent field.`);
    process.exit(1);
  }
  return value;
}
const isCount = value => Number.isFinite(Number(value)) && Number(value) >= 0;
const expectedEvents = predictions.years.reduce((sum, year) => sum + year.events.length, 0);
const expectedTechnology = predictions.years.reduce(
  (sum, year) => sum + year.events.filter(event => event.d === 'technology').length,
  0
);
const expectedYears = predictions.years.length;
const expectedHorizon = predictions.postSuperintelligence.items.length;
/* X retirement (2026-08-13). The evidence mix is derived from signals.json rather than
   asserted as '> 0', which was an X-era portfolio expectation that says nothing about
   whether the rendered label matches the record it came from. */
const expectedEvidenceTypes = Object.values(signals.embeds || {})
  .reduce((acc, embed) => {
    const key = embed.evidenceType || 'direct';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
const artefactCited = Number(required(
  signals.coverage && signals.coverage.cited, 'coverage.cited', isCount));
const artefactUncited = Number(required(
  signals.uncited && signals.uncited.count, 'uncited.count', isCount));
const artefactReality = required(signals.reality, 'reality', Array.isArray).length;
const expectedChanged = predictions.years.reduce(
  (sum, year) => sum + year.events.filter(event => event.revisedAt === predictions.updated.slice(0, 10)).length,
  0
);
const expectedOwners = signals.coverage.byEvidenceOwner;
const expectedAuthorship = required(
  signals.coverage.byPeterAuthorship, 'coverage.byPeterAuthorship',
  value => isCount(value.authored) && isCount(value.reposted));
const expectedPeterStatuses = new Set(
  Object.values(signals.embeds).filter(embed => embed.evidenceOwner === 'peterxing').map(embed => embed.id)
).size;
const expectedExternalStatuses = new Set(
  Object.values(signals.embeds).filter(embed => embed.evidenceOwner === 'external').map(embed => embed.id)
).size;
const expectedManaged = predictions.years.reduce(
  (sum, year) => sum + year.events.filter(event => /^managed branch:/i.test(event.t)).length,
  0
);
const expectedRestored = predictions.years.reduce(
  (sum, year) => sum + year.events.filter(event =>
    event.d === 'governance' && Number.isFinite(event.prob) && event.prob >= 60 && event.prob < 80).length,
  0
);

const profiles = [
  { name:'desktop-dark', theme:'dark', width:1440, height:1000, collapsedYears:10 },
  { name:'desktop-light', theme:'light', width:1440, height:1000, collapsedYears:10 },
  { name:'tablet-dark', theme:'dark', width:820, height:1180, collapsedYears:10, touch:true },
  { name:'mobile-light', theme:'light', width:390, height:844, collapsedYears:12, mobile:true, touch:true },
  { name:'narrow-320', theme:'dark', width:320, height:800, collapsedYears:12, mobile:true, touch:true },
  { name:'high-zoom-layout', theme:'light', width:640, height:900, collapsedYears:12, compactNav:true },
  { name:'reduced-motion', theme:'dark', width:1280, height:900, collapsedYears:10, reduced:true },
];

function check(results, label, condition, detail = '') {
  results.push({ label, ok:Boolean(condition), detail });
}
function requestStatus(pathname) {
  const target = new globalThis.URL(URL);
  return new Promise((resolve, reject) => {
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.request({
      hostname:target.hostname,
      port:target.port || (target.protocol === 'https:' ? 443 : 80),
      path:pathname,
      method:'GET',
    }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end();
  });
}

(async () => {
  const malformedStatus = await requestStatus('/%zz');
  const healthyStatus = await requestStatus('/');
  if (malformedStatus !== 400 || healthyStatus !== 200) {
    throw new Error(`Server URL handling failed: malformed=${malformedStatus}, healthy=${healthyStatus}`);
  }
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  let failures = 0;

  for (const profile of profiles) {
    const context = await browser.newContext({
      viewport:{ width:profile.width, height:profile.height },
      isMobile:Boolean(profile.mobile),
      hasTouch:Boolean(profile.touch),
      reducedMotion:profile.reduced ? 'reduce' : 'no-preference',
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => consoleErrors.push(error.message));

    const separator = URL.includes('?') ? '&' : '?';
    await page.goto(`${URL}${separator}scoutTheme=${profile.theme}`, {
      waitUntil:'networkidle',
      timeout:45000,
    });
    await page.waitForFunction(
      count => document.getElementById('heroEventCount')?.textContent.trim() === String(count),
      expectedEvents,
      { timeout:5000 }
    );

    const state = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
      const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
      const outcomeRows = [...document.querySelectorAll('.simulator-outcome')];
      const chapterBodies = [...document.querySelectorAll('#chapters .ch-body')];
      const simulatorInputs = [...document.querySelectorAll('.simulator-control input')];
      const svgTextNodes = [...document.querySelectorAll('#probabilitySimulatorMap text')];
      // every() over an empty list returns true, so each predicate below is gated on a
      // non-empty list and its size is reported: a selector that stops matching must
      // fail this gate, not silently degrade it to a vacuous pass.
      const outcomesDoNotOverlap = outcomeRows.length > 0 && outcomeRows.every(row => {
        const copy = row.querySelector('.simulator-outcome-copy').getBoundingClientRect();
        const stat = row.querySelector('.simulator-outcome-stat').getBoundingClientRect();
        return copy.right <= stat.left || copy.bottom <= stat.top || stat.bottom <= copy.top;
      });
      const figures = [...document.querySelectorAll('[data-editorial-figure]')];
      const visibleBrandTitles = [...document.querySelectorAll('.brand-text')]
        .map(element => element.childNodes[0]?.textContent.trim());
      return {
        theme:document.documentElement.dataset.theme,
        bodyWidth:document.body.scrollWidth,
        viewportWidth:document.documentElement.clientWidth,
        events:document.querySelectorAll('#timelineBody .event').length,
        years:document.querySelectorAll('.year-block').length,
        turningPoints:[...document.querySelectorAll('#turningPointsRoute .turning-point-link')].map(link => link.getAttribute('href')),
        oldDensityAbsent:!document.getElementById('timelineOverview') && !document.body.textContent.includes('Temporal index / event density'),
        brandTitles:visibleBrandTitles,
        readerBrand:document.querySelector('.reader-brand > span')?.textContent.trim(),
        collapsedYears:document.querySelectorAll('.year-block.is-collapsed').length,
        horizonNodes:document.querySelectorAll('#horizonMap .horizon-node').length,
        horizonCards:document.querySelectorAll('#horizonBody .horizon-item').length,
        reality:document.querySelectorAll('#signalsGrid .observation-card').length,
        chapters:document.querySelectorAll('#chapters .chapter').length,
        evidenceCards:document.querySelectorAll('#timelineBody .tl-signal:not(.tl-currency), #horizonBody .tl-signal:not(.tl-currency)').length,
        currencyCards:document.querySelectorAll('#timelineBody .tl-signal.tl-currency, #horizonBody .tl-signal.tl-currency').length,
        evidenceUnavailable:document.querySelectorAll('#timelineBody .tl-signal-unavailable, #horizonBody .tl-signal-unavailable').length,
        predictionSearches:document.querySelectorAll('.tl-signal-search').length,
        /* X RETIREMENT 2026-08-13 - INVERTED. This called a search chip INVALID unless its href was
           an x.com/search url carrying from:peterxing, so it failed the build precisely BECAUSE the
           migration succeeded. No search chip is legitimate now, so the measure becomes "does the
           page reach X at all" - counted across every anchor and every script in the document,
           not only inside chips that no longer exist. */
        xLinks:[...document.querySelectorAll('a[href]')].filter(link => {
          try { return /(?:^|\.)(?:x\.com|twitter\.com)$/i.test(new URL(link.href, location.href).hostname); }
          catch { return false; }
        }).length,
        xScripts:[...document.querySelectorAll('script[src]')].filter(script =>
          /twitter\.com|x\.com/i.test(script.src)).length,
        uncitedCards:document.querySelectorAll('#timelineBody .tl-signal-uncited, #horizonBody .tl-signal-uncited').length,
        peterEvidence:[...document.querySelectorAll('.tl-signal:not(.tl-currency) summary')].filter(summary => /Peter Xing|Peter wrote|Peter reposted/.test(summary.textContent)).length,
        newsEvidence:[...document.querySelectorAll('.tl-signal:not(.tl-currency) summary')].filter(summary => /News evidence/.test(summary.textContent)).length,
        externalEvidence:[...document.querySelectorAll('.tl-signal:not(.tl-currency) summary')].filter(summary => /External evidence/.test(summary.textContent)).length,
        scenarioEvidence:[...document.querySelectorAll('.tl-signal:not(.tl-currency) summary')].filter(summary => /scenario source/i.test(summary.textContent)).length,
        leadingEvidence:[...document.querySelectorAll('.tl-signal:not(.tl-currency) summary')].filter(summary => /leading indicator/i.test(summary.textContent)).length,
        evidenceDashboard:{
          cited:document.getElementById('evidenceCitedStat')?.textContent.trim(),
          uncited:document.getElementById('evidenceUncitedStat')?.textContent.trim(),
          articles:document.getElementById('evidenceArticlesStat')?.textContent.trim(),
          publishers:document.getElementById('evidencePublishersStat')?.textContent.trim(),
          window:document.getElementById('evidenceWindowStat')?.textContent.trim(),
          newest:document.getElementById('evidenceNewestStat')?.textContent.trim(),
          typeMix:document.getElementById('evidenceTypeMix')?.textContent.replace(/\s+/g, ' ').trim(),
          source:document.getElementById('evidenceSourceHealth')?.textContent.replace(/\s+/g, ' ').trim(),
        },
        finder:{
          changed:document.querySelectorAll('#forecastChangeLinks .revision-link').length,
          deepLinks:document.querySelectorAll('#timelineBody .deep-link, #horizonBody .deep-link').length,
          allCount:document.querySelector('[data-domain-count="all"]')?.textContent.trim(),
          branchOptions:[...document.querySelectorAll('#branchFilter option')].map(option => option.textContent.trim()),
          probabilityOptions:[...document.querySelectorAll('#probabilityFilter option')].map(option => option.textContent.trim()),
          themeOptions:[...document.querySelectorAll('#themeFilter option')].map(option => option.textContent.trim()),
          resultCount:document.getElementById('filterResultCount')?.textContent.trim(),
          searchRegionRole:document.getElementById('atlasSearchResults')?.getAttribute('role'),
          searchInputRole:document.getElementById('atlasSearch')?.getAttribute('role'),
        },
        chapterBodies:chapterBodies.length,
        collapsedChapters:chapterBodies.length > 0 && chapterBodies.every(element => element.hidden),
        simulator:{
          map:Boolean(document.querySelector('#probabilitySimulatorMap svg')),
          controls:simulatorInputs.length,
          enabled:simulatorInputs.length > 0 && simulatorInputs.every(input => !input.disabled),
          probabilities:[...document.querySelectorAll('.simulator-outcome-stat')].map(element => element.textContent.trim()),
          disclaimer:document.getElementById('simulatorDisclaimer')?.textContent || '',
          labels:outcomeRows.map(row => row.getAttribute('aria-label')),
          noOverlap:outcomesDoNotOverlap,
          svgTextNodes:svgTextNodes.length,
          svgPercentText:svgTextNodes.length > 0 && svgTextNodes.every(element => !element.textContent.includes('%')),
        },
        figures:{
          count:figures.length,
          semantic:figures.every(figure => figure.querySelectorAll('.figure-semantic li, .turning-point-link').length >= 3),
          described:figures.every(figure => figure.querySelector('svg title')?.textContent.trim() && figure.querySelector('svg desc')?.textContent.trim()),
          motionReady:document.documentElement.classList.contains('figure-motion-ready'),
        },
        heroCount:document.getElementById('heroEventCount')?.textContent.trim(),
        coordinate:document.getElementById('heroCoordinate')?.textContent.trim(),
        freshness:document.getElementById('heroSignalFreshness')?.textContent.trim(),
        reducedDuration:getComputedStyle(document.querySelector('.hero-copy h1')).animationDuration,
        /* CROSS-REALM DEPENDENCY, STATED BECAUSE IT IS LOAD-BEARING AND INVISIBLE.
           `htmlText` is not declared in this file. It resolves because this code runs in the PAGE
           realm and app.js L507 `function htmlText(value){` is a top-level function declaration in
           a CLASSIC script (index.html L84 `<script src="app.js" defer>`, zero type="module" in the
           document), so it becomes a property of the page's global object.

           That is three unstated facts in two other files holding up one probe. IIFE-wrap app.js,
           convert it to type="module", or bundle it, and this throws ReferenceError inside the
           page — which, since this evaluate has no try/catch, kills the WHOLE `state` object and
           fails verify:ui at the evaluate's opening line, ~100 lines from the cause.

           Calling the real shipped function is the point: a local copy would test the copy and
           leave the site's actual escaping unverified. So the dependency stays and is made
           self-diagnosing instead — 'MISSING' is reported distinctly from a real escaping failure,
           and the check below names the cause. */
        escapedText:(() => {
          if (typeof htmlText !== 'function') return 'MISSING';
          const probe = document.createElement('div');
          probe.innerHTML = htmlText('&lt;img src=x onerror=alert(1)&gt;');
          return probe.children.length === 0 && probe.textContent === '<img src=x onerror=alert(1)>';
        })(),
        duplicateIds:[...new Set(duplicateIds)],
      };
    });

    const results = [];
    check(results, 'theme applied', state.theme === profile.theme, state.theme);
    check(results, 'no horizontal overflow', state.bodyWidth <= state.viewportWidth + 1, `${state.bodyWidth}/${state.viewportWidth}`);
    check(results, 'all forecast events render', state.events === expectedEvents, `${state.events}/${expectedEvents}`);
    check(results, 'all forecast years render', state.years === expectedYears, `${state.years}/${expectedYears}`);
    check(results, 'density minimap is fully removed', state.oldDensityAbsent);
    check(results, 'seven key turning points navigate to content',
      state.turningPoints.length === 7
      && state.turningPoints.filter(href => /^#event-/.test(href)).length === 6
      && state.turningPoints.includes('#post-superintelligence'),
      JSON.stringify(state.turningPoints));
    check(results, 'visible brand title is exact',
      state.brandTitles.length === 2
      && state.brandTitles.every(title => title === "The Hitchhiker's Guide to the Singularity")
      && state.readerBrand === "The Hitchhiker's Guide to the Singularity",
      JSON.stringify({ brands:state.brandTitles, reader:state.readerBrand }));
    check(results, 'later years compact by default', state.collapsedYears === profile.collapsedYears, `${state.collapsedYears}/${profile.collapsedYears}`);
    check(results, 'horizon map and cards align', state.horizonNodes === expectedHorizon && state.horizonCards === expectedHorizon);
    check(results, 'reality observations render, all of them',
      state.reality === artefactReality && state.reality > 0,
      `${state.reality}/${artefactReality}`);
    check(results, 'all chapters render', state.chapters === 13, String(state.chapters));
    check(results, 'collapsed chapters leave the accessibility tree',
      state.chapterBodies === 13 && state.collapsedChapters,
      JSON.stringify({ bodies:state.chapterBodies }));
    /* X retirement (2026-08-13). A prediction is no longer required to carry a card; it is
       required to be ACCOUNTED FOR. Both populations are pinned to the artefact AND to each
       other, so a cited card quietly degrading into an uncited notice still fails. */
    check(results, 'every prediction is accounted for as cited or uncited',
      state.evidenceCards === artefactCited
      && state.uncitedCards === artefactUncited
      && state.evidenceCards + state.uncitedCards === expectedEvents + expectedHorizon
      && state.predictionSearches === 0
      && state.evidenceUnavailable === 0,
      JSON.stringify({ cited:state.evidenceCards, expectedCited:artefactCited,
        uncited:state.uncitedCards, expectedUncited:artefactUncited,
        total:expectedEvents + expectedHorizon,
        unavailable:state.evidenceUnavailable, searches:state.predictionSearches }));
    if (state.evidenceCards > 0) {
      /* X retirement (2026-08-13). Retired labels are asserted ABSENT rather than counted into
         a total: 'peter + external === cards' is satisfied trivially once both are zero and the
         card count is zero too, so it would pass on an empty page. Assert the positive claim
         (every card is labelled news) and the negative one (no X label survives) separately. */
      check(results, 'every cited card is labelled news evidence and no X label survives',
        state.newsEvidence === state.evidenceCards
        && state.peterEvidence === 0
        && state.externalEvidence === 0
        && state.scenarioEvidence === (expectedEvidenceTypes.scenario || 0)
        && state.leadingEvidence === (expectedEvidenceTypes['leading-indicator'] || 0),
        JSON.stringify({
          news:state.newsEvidence,
          cards:state.evidenceCards,
          retiredPeter:state.peterEvidence,
          retiredExternal:state.externalEvidence,
          scenario:state.scenarioEvidence,
          expectedScenario:expectedEvidenceTypes.scenario || 0,
          leading:state.leadingEvidence,
          expectedLeading:expectedEvidenceTypes['leading-indicator'] || 0,
        }));
    }
    /* Every figure is compared against signals.json, never against a literal, so the panel cannot
       drift from the artefact it summarises. Cited and uncited are asserted TOGETHER: publishing one
       without the other is exactly how 7-of-103 gets made to look like 7-of-7. */
    const expectedUncited = artefactUncited;
    const expectedWindow = Number(required(
      signals.uncited && signals.uncited.windowDays, 'uncited.windowDays', isCount));
    const expectedArticles = new Set(Object.values(signals.embeds || {}).map(e => e.id)).size;
    const expectedPublishers = new Set(Object.values(signals.embeds || {})
      .map(e => e.publisherHost).filter(Boolean)).size;
    check(results, 'evidence dashboard reports the cited/uncited accounting from signals.json',
      state.evidenceDashboard.cited === `${signals.coverage.cited} of ${signals.coverage.total}`
      && state.evidenceDashboard.uncited === String(expectedUncited)
      && state.evidenceDashboard.articles === String(expectedArticles)
      && state.evidenceDashboard.publishers === String(expectedPublishers)
      && state.evidenceDashboard.window === `${expectedWindow} days`
      && !/Peter wrote|Peter reposted|Maximum reviewed reuse|unique statuses/i.test(state.evidenceDashboard.typeMix)
      && !/Archive-verified|first-party status|Wayback|archive-discovered/i.test(state.evidenceDashboard.source)
      && /Live-verified sources/i.test(state.evidenceDashboard.source),
      JSON.stringify(state.evidenceDashboard));
    check(results, 'no X link, X script or X-era evidence card survives on the page',
      state.xLinks === 0 && state.xScripts === 0 && state.predictionSearches === 0
      && state.peterEvidence === 0 && state.externalEvidence === 0,
      `xLinks=${state.xLinks} xScripts=${state.xScripts} searches=${state.predictionSearches} `
      + `peter=${state.peterEvidence} external=${state.externalEvidence}`);
    check(results, 'every uncited prediction states its search instead of a fault',
      state.uncitedCards === expectedUncited && state.evidenceUnavailable === 0,
      `uncitedCards=${state.uncitedCards} expected=${expectedUncited} unavailable=${state.evidenceUnavailable}`);
    check(results, 'forecast finder exposes counts, deep links and latest revisions',
      state.finder.changed === expectedChanged
      && state.finder.deepLinks === expectedEvents + expectedYears + expectedHorizon
      && state.finder.allCount === String(expectedEvents)
      && state.finder.branchOptions.length === 5
      && state.finder.probabilityOptions.length === 6
      && state.finder.themeOptions.length === 8
      && state.finder.branchOptions.every(option => /· \d+$/.test(option))
      && state.finder.probabilityOptions.every(option => /· \d+$/.test(option))
      && state.finder.themeOptions.every(option => /· \d+$/.test(option)),
      JSON.stringify(state.finder));
    check(results, 'search uses a standard live results region rather than a partial combobox',
      state.finder.searchRegionRole === 'region' && state.finder.searchInputRole === null,
      JSON.stringify({ region:state.finder.searchRegionRole, input:state.finder.searchInputRole }));
    /* Reported as three outcomes, not two. `MISSING` means the probe never ran because `htmlText`
       was not a page global — an app.js packaging change, not an escaping failure — and saying so
       here is the difference between a one-line diagnosis and a ReferenceError 100 lines upstream. */
    check(results, 'JSON-derived text is escaped at render time',
      state.escapedText === true,
      state.escapedText === 'MISSING'
        ? 'PROBE DID NOT RUN: htmlText is not a page global — app.js must stay an unwrapped classic '
          + 'script (index.html <script src="app.js" defer>). An IIFE wrap, type="module" or a bundler '
          + 'removes the global this probe calls; re-expose it or move the probe.'
        : String(state.escapedText));
    check(results, 'probability simulator loads published anchors',
      state.simulator.map
      && state.simulator.controls === 3
      && state.simulator.enabled
      && JSON.stringify(state.simulator.probabilities) === JSON.stringify(['70%','18%','45%','42%','28%'])
      && state.simulator.labels.length === 5
      && state.simulator.labels.every(label => /^.+Conditional likelihood: \d+ percent\.$/i.test(label))
      && state.simulator.noOverlap
      && state.simulator.svgTextNodes > 0
      && state.simulator.svgPercentText
      && /Simulation only/i.test(state.simulator.disclaimer),
      JSON.stringify(state.simulator.probabilities));
    check(results, 'five editorial figures have useful semantic equivalents',
      state.figures.count === 5 && state.figures.semantic && state.figures.described,
      JSON.stringify(state.figures));
    check(results, 'hero uses fetched event count', state.heroCount === String(expectedEvents), state.heroCount);
    check(results, 'current coordinate is numeric', /^\d{4}\.\d{2}$/.test(state.coordinate || ''), state.coordinate);
    check(results, 'evidence state is exposed',
      /Evidence ·|Prediction evidence unavailable/.test(state.freshness || ''),
      state.freshness);
    check(results, 'ids are unique', state.duplicateIds.length === 0, state.duplicateIds.join(', '));
    check(results, 'console is clean', consoleErrors.length === 0, consoleErrors.join(' | '));

    await page.keyboard.press('Tab');
    check(results, 'skip link is first keyboard target',
      await page.evaluate(() => document.activeElement?.classList.contains('skip-link')));

    const targetYear = page.locator('.turning-point-link[href^="#event-2040-"]').first();
    await targetYear.click();
    check(results, 'turning-point route expands selected year',
      await page.locator('#year-2040').evaluate(element => !element.classList.contains('is-collapsed')));

    const evidenceToggle = page.locator('#overlayToggle');
    await evidenceToggle.click();
    const evidenceState = await page.evaluate(() => ({
      pressed:document.getElementById('overlayToggle').getAttribute('aria-pressed'),
      signalNodes:document.querySelectorAll('#timelineAtlas .tl-signal, #timelineAtlas .tl-signal-unavailable').length,
      hiddenEvidence:(() => {
        const signals = [...document.querySelectorAll('#timelineAtlas .tl-signal, #timelineAtlas .tl-signal-unavailable')];
        return signals.length > 0 && signals.every(element => getComputedStyle(element).display === 'none');
      })(),
      eventCount:document.querySelectorAll('#timelineBody .event').length,
    }));
    check(results, 'evidence toggle hides evidence only',
      evidenceState.pressed === 'false'
      && evidenceState.signalNodes > 0
      && evidenceState.hiddenEvidence
      && evidenceState.eventCount === expectedEvents,
      JSON.stringify({ signals:evidenceState.signalNodes, events:evidenceState.eventCount }));
    await evidenceToggle.click();

    await page.locator('.chip[data-domain="technology"]').click();
    const visibleTechnology = await page.locator('#timelineBody .event:not([hidden])').count();
    check(results, 'domain filter preserves exact technology count',
      visibleTechnology === expectedTechnology,
      `${visibleTechnology}/${expectedTechnology}`);
    await page.locator('.chip[data-domain="all"]').click();

    if (profile.name === 'desktop-light') {
      await page.locator('#branchFilter').selectOption('managed');
      const managedState = await page.evaluate(() => ({
        visible:document.querySelectorAll('#timelineBody .event:not([hidden])').length,
        query:new URL(location.href).searchParams.get('fb'),
      }));
      check(results, 'branch filter is counted and shareable',
        managedState.visible === expectedManaged && managedState.query === 'managed',
        JSON.stringify(managedState));
      await page.locator('#filterReset').click();

      await page.locator('#changesOnlyToggle').click();
      const changedState = await page.evaluate(() => ({
        visible:document.querySelectorAll('#timelineBody .event:not([hidden])').length,
        query:new URL(location.href).searchParams.get('fc'),
      }));
      check(results, 'latest-change view isolates revised events',
        changedState.visible === expectedChanged && changedState.query === '1',
        JSON.stringify(changedState));
      await page.locator('#filterReset').click();

      await page.locator('#atlasSearch').fill('orbital compute');
      const searchState = await page.evaluate(() => ({
        results:[...document.querySelectorAll('#atlasSearchResults .search-result[href]')].map(link => link.textContent.replace(/\s+/g, ' ').trim()),
        visible:document.querySelectorAll('#timelineBody .event:not([hidden])').length,
        query:new URL(location.href).searchParams.get('fq'),
        resultsVisible:!document.getElementById('atlasSearchResults').hidden,
      }));
      check(results, 'atlas search spans dated and horizon content with URL state',
        searchState.results.some(result => /^Prediction/i.test(result))
        && searchState.results.some(result => /^Horizon/i.test(result))
        && searchState.visible > 0
        && searchState.query === 'orbital compute'
        && searchState.resultsVisible,
        JSON.stringify(searchState));
      await page.locator('#searchClear').click();
    }

    await page.locator('[data-sim-preset="fast"]').click();
    await page.waitForTimeout(profile.reduced ? 20 : 320);
    const simulatedFast = await page.evaluate(() => ({
      cards:[...document.querySelectorAll('.simulator-outcome-stat')].map(element => Number.parseInt(element.textContent, 10)),
      hero:Number.parseInt(document.getElementById('heroAgiProbability').textContent, 10),
      interpretation:document.getElementById('simulatorInterpretation').textContent,
    }));
    check(results, 'simulator changes branch pressure without mutating forecast',
      simulatedFast.cards[0] > 70
      && simulatedFast.cards[2] > 45
      && simulatedFast.cards[3] > 42
      && simulatedFast.hero === 70
      && /strongest simulated pressure/i.test(simulatedFast.interpretation),
      JSON.stringify(simulatedFast));
    await page.locator('[data-sim-preset="baseline"]').click();

    const firstChapter = page.locator('#chapters .chapter').first();
    const firstChapterToggle = firstChapter.locator('.ch-head');
    await firstChapterToggle.click();
    check(results, 'chapter disclosure exposes content and state together',
      await firstChapterToggle.getAttribute('aria-expanded') === 'true'
      && await firstChapter.locator('.ch-body').evaluate(element => !element.hidden));
    await firstChapterToggle.click();
    check(results, 'chapter disclosure removes collapsed controls from navigation',
      await firstChapterToggle.getAttribute('aria-expanded') === 'false'
      && await firstChapter.locator('.ch-body').evaluate(element => element.hidden));

    const firstHorizonNode = page.locator('#horizonMap .horizon-node').first();
    const horizonId = await firstHorizonNode.getAttribute('data-horizon-target');
    await firstHorizonNode.click();
    const selectedHorizon = page.locator(`#horizon-${horizonId}`);
    check(results, 'horizon node opens and selects evidence ladder',
      await selectedHorizon.evaluate(element =>
        element.classList.contains('is-selected') && !element.classList.contains('is-collapsed')));

    const figureLocator = page.locator('[data-editorial-figure]');
    for (let index = 0; index < await figureLocator.count(); index++) {
      const figure = figureLocator.nth(index);
      await figure.scrollIntoViewIfNeeded();
      await page.waitForFunction(
        element => element.classList.contains('is-visible'),
        await figure.elementHandle(),
        { timeout:2000 }
      );
    }
    const figureMotion = await page.evaluate(() => ({
      motionReady:document.documentElement.classList.contains('figure-motion-ready'),
      figures:[...document.querySelectorAll('[data-editorial-figure]')].map(figure => {
        const draw = figure.querySelector('.figure-draw:not(.ruliad-branch)');
        const reveal = figure.querySelector('.figure-reveal');
        const drawStyle = getComputedStyle(draw);
        return {
          visible:figure.classList.contains('is-visible'),
          animationName:drawStyle.animationName,
          animationDuration:drawStyle.animationDuration,
          dashOffset:drawStyle.strokeDashoffset,
          revealOpacity:getComputedStyle(reveal).opacity,
        };
      }),
    }));
    if (profile.reduced) {
      check(results, 'reduced motion renders static editorial figures',
        !figureMotion.motionReady
        && figureMotion.figures.length === 5
        && figureMotion.figures.every(figure => figure.visible && figure.animationName === 'none' && Number(figure.revealOpacity) === 1),
        JSON.stringify(figureMotion));
    } else {
      check(results, 'normal motion visibly activates every editorial figure',
        figureMotion.motionReady
        && figureMotion.figures.length === 5
        && figureMotion.figures.every(figure =>
          figure.visible
          && figure.animationName.includes('editorial-path-draw')
          && !['0s','0.00001s','1e-05s'].includes(figure.animationDuration)),
        JSON.stringify(figureMotion));
    }

    if (profile.mobile || profile.compactNav) {
      const menu = page.locator('#navToggle');
      await menu.click();
      check(results, 'mobile menu exposes expanded state', await menu.getAttribute('aria-expanded') === 'true');
      await menu.click();
    }

    const firstPlannerOption = page.locator('#plannerBody .opt').first();
    await firstPlannerOption.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      document.querySelector('#plannerBody .opt')?.getAttribute('aria-checked') === 'true'
      && document.activeElement?.classList.contains('opt'),
    null, { timeout:1000 });
    check(results, 'planner options are keyboard-operable radios',
      await page.locator('#plannerBody .opt').first().getAttribute('aria-checked') === 'true'
      && await page.evaluate(() => document.activeElement?.classList.contains('opt')));

    await page.locator('#readBookBtn').click();
    const readerState = await page.evaluate(() => ({
      open:!document.getElementById('reader').hidden,
      toc:document.querySelectorAll('#rdToc .rd-toc-item').length,
      inertSiblings:document.querySelectorAll('.content > :not(#reader)').length,
      inert:(() => {
        const siblings = [...document.querySelectorAll('.content > :not(#reader)')];
        return siblings.length > 0 && siblings.every(element => element.inert);
      })(),
      active:document.activeElement?.id,
    }));
    check(results, 'reader opens with complete route navigation',
      readerState.open && readerState.toc === 13 && readerState.inertSiblings > 0 && readerState.inert && readerState.active === 'rdClose');
    await page.keyboard.press('Escape');
    check(results, 'reader restores trigger focus',
      await page.evaluate(() => document.activeElement?.id === 'readBookBtn' && document.getElementById('reader').hidden));

    if (profile.reduced) {
      check(results, 'reduced motion removes staged animation',
        state.reducedDuration === '0.00001s' || state.reducedDuration === '1e-05s' || state.reducedDuration === '0s',
        state.reducedDuration);
    }

    const failed = results.filter(result => !result.ok);
    failures += failed.length;
    console.log(`[${profile.name}] ${results.length - failed.length}/${results.length} checks passed`);
    failed.forEach(result => console.log(`  FAIL ${result.label}${result.detail ? ` · ${result.detail}` : ''}`));
    await context.close();
  }

  const restoreContext = await browser.newContext({ viewport:{ width:1280, height:900 } });
  const restorePage = await restoreContext.newPage();
  await restorePage.route('**/signals.json', async route => {
    await new Promise(resolve => setTimeout(resolve, 600));
    await route.continue();
  });
  const restoreSeparator = URL.includes('?') ? '&' : '?';
  await restorePage.goto(`${URL}${restoreSeparator}scoutTheme=light&fd=governance&fp=high#event-2031-4`, {
    waitUntil:'networkidle',
    timeout:45000,
  });
  await restorePage.waitForFunction(
    count => document.querySelectorAll('#timelineBody .event').length === count,
    expectedEvents,
    { timeout:5000 }
  );
  await restorePage.waitForTimeout(700);
  const restored = await restorePage.evaluate(() => ({
    domain:document.querySelector('[data-domain][aria-pressed="true"]')?.dataset.domain,
    probability:document.getElementById('probabilityFilter')?.value,
    visible:document.querySelectorAll('#timelineBody .event:not([hidden])').length,
    targetVisible:!document.getElementById('event-2031-4')?.hidden,
    yearExpanded:!document.getElementById('year-2031')?.classList.contains('is-collapsed'),
    activeId:document.activeElement?.id,
    scrollY:window.scrollY,
  }));
  if (restored.domain !== 'governance'
      || restored.probability !== 'high'
      || restored.visible !== expectedRestored
      || !restored.targetVisible
      || !restored.yearExpanded
      || restored.activeId !== 'event-2031-4'
      || restored.scrollY < 500) {
    failures++;
    console.log(`  FAIL filter and deep-link state restores on load · ${JSON.stringify(restored)}`);
  } else {
    console.log('[restore-state] 1/1 checks passed');
  }
  await restoreContext.close();

  /* Every date on this site is a captured UTC instant. Formatting one in the reader's own zone
     makes a cited source's publication date depend on who is reading it — an article captured at
     2026-07-31T20:39:14Z renders "Aug 1, 2026" east of UTC+4 while the publisher's own page says
     July 31 — which contradicts a source the reader can check in one click. Two guards, because
     the static one alone would pass on a helper that was written correctly and then never called.
     The rendered one loads the real page at the two extremes of the inhabited offset range and
     requires byte-identical output, which is the property that actually matters: the same page
     must not assert two different publication dates for the same citation. */
  const appSource = require('fs').readFileSync(require('path').join(__dirname, 'app.js'), 'utf8');
  const bareFormatters = appSource.split('\n')
    .map((line, index) => ({ line:line.trim(), n:index + 1 }))
    .filter(row => /\.toLocale(Date|Time)?String\(/.test(row.line)
      && !/timeZone:'UTC'/.test(row.line)
      && !/Math\.round\(n\)/.test(row.line));
  if (bareFormatters.length) {
    failures++;
    console.log(`  FAIL app.js formats ${bareFormatters.length} date(s) in the reader's local zone · ${bareFormatters.map(r => `L${r.n}`).join(', ')}`);
  } else {
    console.log('[utc-dates] 1/1 static checks passed');
  }

  const zoneRenders = [];
  for (const timezoneId of ['Pacific/Kiritimati', 'Pacific/Midway']) {
    const zoneContext = await browser.newContext({ viewport:{ width:1280, height:900 }, timezoneId });
    const zonePage = await zoneContext.newPage();
    await zonePage.goto(`${URL}${URL.includes('?') ? '&' : '?'}scoutTheme=light`, { waitUntil:'networkidle' });
    await zonePage.waitForFunction(() => document.querySelectorAll('#timelineBody .event').length > 0);
    zoneRenders.push(await zonePage.evaluate(() => Array.from(
      document.querySelectorAll('.tl-currency[data-published-utc]'),
      node => ({
        utc:node.dataset.publishedUtc,
        rendered:node.querySelector('.tl-signal-date time')?.textContent?.trim() || '',
      }),
    )));
    await zoneContext.close();
  }
  const [east, west] = zoneRenders;
  const expectedCurrencyCards = Object.values(signals.currency || {}).reduce((sum, list) => sum + list.length, 0);
  const zoneMismatch = east.filter((row, index) => row.rendered !== west[index]?.rendered);
  const utcMismatch = east.filter(row => {
    const parsed = new Date(`${row.rendered} UTC`);
    return isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== row.utc;
  });
  /* The DOM is pinned to the artefact in BOTH directions: rows declared but not rendered
     fail, and rows rendered but not declared fail. An artefact that declares zero is
     reported as inert below rather than skipped, so 'no rows' can never read as 'passed'. */
  if (east.length !== expectedCurrencyCards || zoneMismatch.length || utcMismatch.length) {
    failures++;
    console.log(`  FAIL currency dates are reader-location dependent · cards ${east.length}/${expectedCurrencyCards} · zone mismatches ${zoneMismatch.length} · UTC mismatches ${utcMismatch.length}${utcMismatch.length ? ` · ${JSON.stringify(utcMismatch.slice(0, 3))}` : ''}`);
  } else {
    console.log(expectedCurrencyCards === 0
      ? '[utc-dates] currency layer is INERT: signals.currency declares 0 rows and the DOM renders 0. Nothing to compare; the artefact pin still holds in both directions.'
      : `[utc-dates] ${east.length}/${expectedCurrencyCards} currency dates identical at UTC+14 and UTC-11 and equal to the captured date`);
  }

  await browser.close();
  if (failures) {
    console.log(`RESULT: FAIL (${failures} observatory check${failures === 1 ? '' : 's'})`);
    process.exit(1);
  }
  console.log('RESULT: PASS — responsive observatory interactions, accessibility state and data encodings are coherent.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});

