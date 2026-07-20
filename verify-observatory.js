const { chromium } = require('playwright');
const http = require('http');
const predictions = require('./predictions.json');

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const expectedEvents = predictions.years.reduce((sum, year) => sum + year.events.length, 0);
const expectedTechnology = predictions.years.reduce(
  (sum, year) => sum + year.events.filter(event => event.d === 'technology').length,
  0
);
const expectedYears = predictions.years.length;
const expectedHorizon = predictions.postSuperintelligence.items.length;

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
    const request = http.request({
      hostname:target.hostname,
      port:target.port || 80,
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
      const outcomesDoNotOverlap = outcomeRows.every(row => {
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
        evidenceCards:document.querySelectorAll('#timelineBody .tl-signal, #horizonBody .tl-signal').length,
        evidenceUnavailable:document.querySelectorAll('#timelineBody .tl-signal-unavailable, #horizonBody .tl-signal-unavailable').length,
        predictionSearches:document.querySelectorAll('.tl-signal-search').length,
        peterEvidence:[...document.querySelectorAll('.tl-signal summary')].filter(summary => /Peter Xing|@peterxing/.test(summary.textContent)).length,
        externalEvidence:[...document.querySelectorAll('.tl-signal summary')].filter(summary => /External evidence/.test(summary.textContent)).length,
        scenarioEvidence:[...document.querySelectorAll('.tl-signal summary')].filter(summary => /Scenario source/.test(summary.textContent)).length,
        leadingEvidence:[...document.querySelectorAll('.tl-signal summary')].filter(summary => /Leading indicator/.test(summary.textContent)).length,
        collapsedChapters:[...document.querySelectorAll('#chapters .ch-body')].every(element => element.hidden),
        simulator:{
          map:Boolean(document.querySelector('#probabilitySimulatorMap svg')),
          controls:[...document.querySelectorAll('.simulator-control input')].length,
          enabled:[...document.querySelectorAll('.simulator-control input')].every(input => !input.disabled),
          probabilities:[...document.querySelectorAll('.simulator-outcome-stat')].map(element => element.textContent.trim()),
          disclaimer:document.getElementById('simulatorDisclaimer')?.textContent || '',
          labels:outcomeRows.map(row => row.getAttribute('aria-label')),
          noOverlap:outcomesDoNotOverlap,
          svgPercentText:[...document.querySelectorAll('#probabilitySimulatorMap text')].every(element => !element.textContent.includes('%')),
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
        escapedText:(() => {
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
    check(results, 'six reality observations render', state.reality === 6, String(state.reality));
    check(results, 'all chapters render', state.chapters === 13, String(state.chapters));
    check(results, 'collapsed chapters leave the accessibility tree', state.collapsedChapters);
    check(results, 'prediction evidence is direct-only or fail-closed',
      state.predictionSearches === 0
      && ((state.evidenceCards === expectedEvents + expectedHorizon && state.evidenceUnavailable === 0)
        || (state.evidenceCards === 0 && state.evidenceUnavailable === expectedEvents + expectedHorizon)),
      JSON.stringify({ cards:state.evidenceCards, unavailable:state.evidenceUnavailable, searches:state.predictionSearches }));
    if (state.evidenceCards === expectedEvents + expectedHorizon) {
      check(results, 'mixed provenance labels are explicit',
        state.peterEvidence === 17
        && state.externalEvidence === 86
        && state.scenarioEvidence > 0
        && state.leadingEvidence > 0,
        JSON.stringify({
          peter:state.peterEvidence,
          external:state.externalEvidence,
          scenario:state.scenarioEvidence,
          leading:state.leadingEvidence,
        }));
    }
    check(results, 'JSON-derived text is escaped at render time', state.escapedText);
    check(results, 'probability simulator loads published anchors',
      state.simulator.map
      && state.simulator.controls === 3
      && state.simulator.enabled
      && JSON.stringify(state.simulator.probabilities) === JSON.stringify(['70%','18%','45%','42%','28%'])
      && state.simulator.labels.every(label => /^.+Conditional likelihood: \d+ percent\.$/i.test(label))
      && state.simulator.noOverlap
      && state.simulator.svgPercentText
      && /Simulation only/i.test(state.simulator.disclaimer),
      JSON.stringify(state.simulator.probabilities));
    check(results, 'five editorial figures have useful semantic equivalents',
      state.figures.count === 5 && state.figures.semantic && state.figures.described,
      JSON.stringify(state.figures));
    check(results, 'hero uses fetched event count', state.heroCount === String(expectedEvents), state.heroCount);
    check(results, 'current coordinate is numeric', /^\d{4}\.\d{2}$/.test(state.coordinate || ''), state.coordinate);
    check(results, 'evidence state is exposed',
      /Evidence ·|Direct evidence · temporarily unavailable/.test(state.freshness || ''),
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
      hiddenEvidence:[...document.querySelectorAll('#timelineAtlas .tl-signal, #timelineAtlas .tl-signal-unavailable')]
        .every(element => getComputedStyle(element).display === 'none'),
      eventCount:document.querySelectorAll('#timelineBody .event').length,
    }));
    check(results, 'evidence toggle hides evidence only',
      evidenceState.pressed === 'false' && evidenceState.hiddenEvidence && evidenceState.eventCount === expectedEvents);
    await evidenceToggle.click();

    await page.locator('.chip[data-domain="technology"]').click();
    const visibleTechnology = await page.locator('#timelineBody .event:not([hidden])').count();
    check(results, 'domain filter preserves exact technology count',
      visibleTechnology === expectedTechnology,
      `${visibleTechnology}/${expectedTechnology}`);
    await page.locator('.chip[data-domain="all"]').click();

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
        && figureMotion.figures.every(figure => figure.visible && figure.animationName === 'none' && Number(figure.revealOpacity) === 1),
        JSON.stringify(figureMotion));
    } else {
      check(results, 'normal motion visibly activates every editorial figure',
        figureMotion.motionReady
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
      inert:[...document.querySelectorAll('.content > :not(#reader)')].every(element => element.inert),
      active:document.activeElement?.id,
    }));
    check(results, 'reader opens with complete route navigation',
      readerState.open && readerState.toc === 13 && readerState.inert && readerState.active === 'rdClose');
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
