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
      return {
        theme:document.documentElement.dataset.theme,
        bodyWidth:document.body.scrollWidth,
        viewportWidth:document.documentElement.clientWidth,
        events:document.querySelectorAll('#timelineBody .event').length,
        years:document.querySelectorAll('#timelineOverview .overview-year').length,
        collapsedYears:document.querySelectorAll('.year-block.is-collapsed').length,
        horizonNodes:document.querySelectorAll('#horizonMap .horizon-node').length,
        horizonCards:document.querySelectorAll('#horizonBody .horizon-item').length,
        reality:document.querySelectorAll('#signalsGrid .observation-card').length,
        chapters:document.querySelectorAll('#chapters .chapter').length,
        collapsedChapters:[...document.querySelectorAll('#chapters .ch-body')].every(element => element.hidden),
        simulator:{
          map:Boolean(document.querySelector('#probabilitySimulatorMap svg')),
          controls:[...document.querySelectorAll('.simulator-control input')].length,
          enabled:[...document.querySelectorAll('.simulator-control input')].every(input => !input.disabled),
          probabilities:[...document.querySelectorAll('.simulator-probability strong')].map(element => element.textContent.trim()),
          disclaimer:document.getElementById('simulatorDisclaimer')?.textContent || '',
        },
        heroCount:document.getElementById('heroEventCount')?.textContent.trim(),
        coordinate:document.getElementById('heroCoordinate')?.textContent.trim(),
        freshness:document.getElementById('heroSignalFreshness')?.textContent.trim(),
        sticky:getComputedStyle(document.querySelector('.timeline-overview-shell')).position,
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
    check(results, 'all forecast years index', state.years === expectedYears, `${state.years}/${expectedYears}`);
    check(results, 'later years compact by default', state.collapsedYears === profile.collapsedYears, `${state.collapsedYears}/${profile.collapsedYears}`);
    check(results, 'horizon map and cards align', state.horizonNodes === expectedHorizon && state.horizonCards === expectedHorizon);
    check(results, 'six reality observations render', state.reality === 6, String(state.reality));
    check(results, 'all chapters render', state.chapters === 13, String(state.chapters));
    check(results, 'collapsed chapters leave the accessibility tree', state.collapsedChapters);
    check(results, 'JSON-derived text is escaped at render time', state.escapedText);
    check(results, 'probability simulator loads published anchors',
      state.simulator.map
      && state.simulator.controls === 3
      && state.simulator.enabled
      && JSON.stringify(state.simulator.probabilities) === JSON.stringify(['70%','18%','45%','42%','28%'])
      && /Simulation only/i.test(state.simulator.disclaimer),
      JSON.stringify(state.simulator.probabilities));
    check(results, 'hero uses fetched event count', state.heroCount === String(expectedEvents), state.heroCount);
    check(results, 'current coordinate is numeric', /^\d{4}\.\d{2}$/.test(state.coordinate || ''), state.coordinate);
    check(results, 'live freshness is exposed', /Evidence ·/.test(state.freshness || ''), state.freshness);
    check(results, 'timeline minimap is sticky', state.sticky === 'sticky', state.sticky);
    check(results, 'ids are unique', state.duplicateIds.length === 0, state.duplicateIds.join(', '));
    check(results, 'console is clean', consoleErrors.length === 0, consoleErrors.join(' | '));

    await page.keyboard.press('Tab');
    check(results, 'skip link is first keyboard target',
      await page.evaluate(() => document.activeElement?.classList.contains('skip-link')));

    const targetYear = page.locator('.overview-year[data-year="2040"]');
    await targetYear.click();
    check(results, 'year rail expands selected year',
      await page.locator('#year-2040').evaluate(element => !element.classList.contains('is-collapsed')));

    const evidenceToggle = page.locator('#overlayToggle');
    await evidenceToggle.click();
    const evidenceState = await page.evaluate(() => ({
      pressed:document.getElementById('overlayToggle').getAttribute('aria-pressed'),
      searchDisplay:getComputedStyle(document.querySelector('#timelineAtlas .tl-signal-search')).display,
      eventCount:document.querySelectorAll('#timelineBody .event').length,
    }));
    check(results, 'evidence toggle hides evidence only',
      evidenceState.pressed === 'false' && evidenceState.searchDisplay === 'none' && evidenceState.eventCount === expectedEvents);
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
      cards:[...document.querySelectorAll('.simulator-probability strong')].map(element => Number.parseInt(element.textContent, 10)),
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

    if (profile.mobile || profile.compactNav) {
      const menu = page.locator('#navToggle');
      await menu.click();
      check(results, 'mobile menu exposes expanded state', await menu.getAttribute('aria-expanded') === 'true');
      await menu.click();
    }

    const firstPlannerOption = page.locator('#plannerBody .opt').first();
    await firstPlannerOption.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(30);
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
