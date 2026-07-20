const { chromium } = require('playwright');
const URL = process.argv[2] || 'http://127.0.0.1:8787';
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
    const sep = URL.includes('?') ? '&' : '?';
    await page.goto(URL + sep + 'scoutTheme=' + theme, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1200);

    const stats = await page.evaluate(async () => {
      const [signals, predictions] = await Promise.all([
        fetch('signals.json?verify=' + Date.now()).then(r => r.json()),
        fetch('predictions.json?verify=' + Date.now()).then(r => r.json()),
      ]);
      const embeds = signals.embeds || {};
      const embedValues = Object.values(embeds);
      const methodCounts = {};
      const postUses = {};
      const badMethods = [];
      for (const e of embedValues) {
        methodCounts[e.matchMethod] = (methodCounts[e.matchMethod] || 0) + 1;
        if (!postUses[e.id]) postUses[e.id] = [];
        postUses[e.id].push(e);
        if (!['lexical', 'semantic', 'hybrid', 'family', 'reviewed-external'].includes(e.matchMethod)) badMethods.push(e.id || '(missing id)');
      }

      const datedKeys = predictions.years.flatMap(y => y.events.map((_, i) => `${y.year}-${i}`));
      const horizon = predictions.postSuperintelligence;
      const horizonItems = horizon && Array.isArray(horizon.items) ? horizon.items : [];
      const horizonKeys = horizonItems.map(item => `horizon-${item.id}`);
      const expectedKeys = [...datedKeys, ...horizonKeys];
      const coveredKeys = new Set(Object.keys(embeds));
      const missingKeys = expectedKeys.filter(key => !coveredKeys.has(key));
      const extraKeys = [...coveredKeys].filter(key => !expectedKeys.includes(key));

      const stringList = value => Array.isArray(value) && value.length >= 2 && value.length <= 4
        && value.every(v => typeof v === 'string' && v.trim());
      const horizonSchema = !!horizon
        && typeof horizon.title === 'string' && horizon.title.trim()
        && typeof horizon.summary === 'string'
        && /aligned superintelligence/i.test(horizon.summary)
        && /not a probability by 2040/i.test(horizon.summary)
        && /mutually exclusive/i.test(horizon.summary)
        && horizonItems.length >= 7
        && horizonItems.every(item => item && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)
          && typeof item.t === 'string' && item.t.trim()
          && ['conditional', 'speculative'].includes(item.epistemic)
          && typeof item.conditionalProb === 'number' && item.conditionalProb >= 0 && item.conditionalProb <= 100
          && stringList(item.dependencies) && stringList(item.indicators)
          && typeof item.caveat === 'string' && item.caveat.trim()
          && item.match && /\bfrom:peterxing\b/i.test(item.match.search || ''));
      const horizonText = horizonItems.map(item => `${item.t} ${item.caveat}`).join(' ').toLowerCase();
      const horizonCaveats = [
        'endovascular bcis are minimally invasive, not non-invasive',
        'chatbot or digital replica',
        'small orbital clusters are not a dyson swarm',
        'energy-use classification',
        'no empirical confirmation',
        'not an established physical theory',
      ].every(phrase => horizonText.includes(phrase));

      const eventNodes = Array.from(document.querySelectorAll('#timelineBody .event'));
      const horizonNodes = Array.from(document.querySelectorAll('#horizonBody .horizon-item'));
      const eventCoverage = eventNodes.every(node => node.querySelector('.event-body > .tl-signal'));
      const horizonCoverage = horizonNodes.every(node =>
        node.querySelector('.horizon-epistemic')
        && node.querySelector('.horizon-prob')
        && node.querySelectorAll('.horizon-block').length === 2
        && node.querySelector('.horizon-caveat')
        && node.querySelector('.horizon-signal .tl-signal'));
      const searchLinks = Array.from(document.querySelectorAll('.tl-signal-search')).map(a => a.href);
      const dates = Array.from(document.querySelectorAll('.tl-signal-date')).map(d => d.textContent.trim());
      const directSchema = expectedKeys.every(key => {
        const e = embeds[key];
        const provenance = e && e.provenance || {};
        const common = e
          && /^\d{15,}$/.test(String(e.id || ''))
          && /^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d{15,}$/.test(String(e.url || ''))
          && !!e.evidenceFamily
          && e.reviewed === true
          && !!e.mappingRationale;
        if (!common) return false;
        if (e.evidenceOwner === 'peterxing') {
          return ['post', 'repost'].includes(e.kind)
            && provenance.evidenceOwner === 'peterxing'
            && provenance.account === 'peterxing'
            && ['authored', 'reposted'].includes(provenance.relationship)
            && /^\d{15,}$/.test(String(provenance.activityId || ''))
            && !!provenance.observedIn
            && ['unique', 'family-reuse'].includes(e.assignmentMode);
        }
        return e.evidenceOwner === 'external'
          && e.kind === 'external'
          && provenance.evidenceOwner === 'external'
          && provenance.activityKind === 'external'
          && provenance.account === e.author
          && !!provenance.displayName
          && !!provenance.sourceQuality
          && !!provenance.retrievedAt
          && ['direct', 'scenario', 'leading-indicator'].includes(e.evidenceType)
          && ['unique', 'external-reuse'].includes(e.assignmentMode);
      });
      const invalidReuse = Object.entries(postUses).filter(([, uses]) => {
        if (uses.length <= 1) return false;
        const owners = new Set(uses.map(use => use.evidenceOwner));
        const groups = new Set(uses.map(use => use.evidenceOwner === 'external' ? use.reuseFamily : use.evidenceFamily));
        const expectedMode = uses[0].evidenceOwner === 'external' ? 'external-reuse' : 'family-reuse';
        return owners.size !== 1 || groups.size !== 1
          || uses.some(use => use.assignmentMode !== expectedMode);
      }).map(([id]) => id);
      return {
        eventCount: eventNodes.length,
        expectedEventCount: datedKeys.length,
        horizonCount: horizonNodes.length,
        expectedHorizonCount: horizonItems.length,
        cards: document.querySelectorAll('#timelineBody .event-body .tl-signal, #horizonBody .horizon-signal .tl-signal').length,
        chips: searchLinks.length,
        searchFieldAbsent: !Object.prototype.hasOwnProperty.call(signals, 'search'),
        strayCards: document.querySelectorAll('#timelineBody .year-row > div > .tl-signal').length,
        source: signals.source || '',
        sourceFresh: signals.sourceFresh === true,
        sourceFetchedAt: signals.sourceFetchedAt || null,
        newestItemAt: signals.newestItemAt || null,
        realityCount: Array.isArray(signals.reality) ? signals.reality.length : 0,
        methodCounts,
        badMethods,
        maxReuse: Math.max(0, ...Object.values(postUses).map(uses => uses.length)),
        invalidReuse,
        missingKeys,
        extraKeys,
        eventCoverage,
        horizonCoverage,
        directSchema,
        horizonSchema,
        horizonCaveats,
        datesMissing: dates.filter(date => !date).length,
      };
    });

    const checks = {
      source: stats.sourceFresh && stats.source !== 'live-search' && !!stats.sourceFetchedAt && !!stats.newestItemAt,
      eventCount: stats.eventCount === stats.expectedEventCount,
      horizonCount: stats.horizonCount === stats.expectedHorizonCount && stats.expectedHorizonCount >= 7,
      exactCoverage: !stats.missingKeys.length && !stats.extraKeys.length,
      renderedCoverage: stats.eventCoverage && stats.horizonCoverage,
      horizonSchema: stats.horizonSchema && stats.horizonCaveats,
      methods: !stats.badMethods.length,
      reuse: !stats.invalidReuse.length,
      directSchema: stats.directSchema,
      searches: stats.chips === 0 && stats.searchFieldAbsent,
      reality: stats.realityCount === 6,
      layout: stats.strayCards === 0 && stats.datesMissing === 0,
      console: errors.length === 0,
    };
    const ok = Object.values(checks).every(Boolean);
    console.log(`[${theme}] events=${stats.eventCount}/${stats.expectedEventCount} horizon=${stats.horizonCount}/${stats.expectedHorizonCount} cards=${stats.cards} chips=${stats.chips} source=${stats.source} fresh=${stats.sourceFresh} methods=${JSON.stringify(stats.methodCounts)} maxReuse=${stats.maxReuse} missing=${stats.missingKeys.length} extra=${stats.extraKeys.length} errs=${errors.length} -> ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) console.log('   CHECKS:', JSON.stringify(checks));
    if (errors.length) console.log('   ERRORS:', errors.slice(0, 4).join(' | '));
    if (stats.missingKeys.length) console.log('   MISSING:', stats.missingKeys.slice(0, 12).join(', '));
    if (stats.extraKeys.length) console.log('   EXTRA:', stats.extraKeys.slice(0, 12).join(', '));
    if (stats.badMethods.length) console.log('   BAD METHODS:', stats.badMethods.slice(0, 4).join(' | '));
    if (SHOT) await page.screenshot({ path: SHOT.replace('THEME', theme), fullPage: false });
    if (!ok) pass = false;
    await ctx.close();
  }
  await browser.close();
  console.log('RESULT: ' + (pass ? 'PASS' : 'FAIL'));
  process.exit(pass ? 0 : 1);
})();
