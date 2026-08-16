// Concurrency interlock: claim the tree before reading predictions/signals/approvals/floors.
if (require.main === module) require('./pipeline-lock').guard('verify:predictions');

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
      const searches = signals.search && typeof signals.search === 'object' ? signals.search : {};
      const embedValues = Object.values(embeds);
      const methodCounts = {};
      const postUses = {};
      const rowsPerSource = {};
      const badMethods = [];
      for (const e of embedValues) {
        methodCounts[e.matchMethod] = (methodCounts[e.matchMethod] || 0) + 1;
        /* X retirement (2026-08-13). Under X, e.id WAS the source — a status id. Under the news
           contract the source is the resolved ARTICLE (sourceKey); e.id is only a ledger row
           name. Counting reuse by id lets one article be split across N rows and read as no
           reuse at all, which would silently evade the reuse ceiling. Count by article. */
        const sourceIdentity = e.sourceKey || e.id;
        if (!postUses[sourceIdentity]) postUses[sourceIdentity] = [];
        postUses[sourceIdentity].push(e);
        if (!rowsPerSource[sourceIdentity]) rowsPerSource[sourceIdentity] = new Set();
        rowsPerSource[sourceIdentity].add(e.id);
        /* X retirement (2026-08-13). 'lexical', 'semantic', 'hybrid' and 'family' were automatic
           X matchers; 'reviewed-sticky' and 'reviewed-external' were the reviewed X ledgers. The
           news contract is reviewed-only, so exactly one method is legal and any of the retired
           names reappearing is a REGRESSION that must fail loudly rather than be tolerated. */
        if (e.matchMethod !== 'reviewed-news') badMethods.push((e.id || '(missing id)') + ' -> ' + e.matchMethod);
      }
      const datedKeys = predictions.years.flatMap(y => y.events.map((_, i) => `${y.year}-${i}`));
      const horizon = predictions.postSuperintelligence;
      const horizonItems = horizon && Array.isArray(horizon.items) ? horizon.items : [];
      const horizonKeys = horizonItems.map(item => `horizon-${item.id}`);
      const expectedKeys = [...datedKeys, ...horizonKeys];
      const coveredKeys = new Set(Object.keys(embeds));
      /* X retirement (2026-08-13). A prediction is no longer required to carry evidence; it is
         required to be ACCOUNTED FOR — cited by a reviewed news source, or explicitly recorded
         as uncited with a reason. Both at once is a double-count and is charged separately, so
         the totality can never be satisfied by moving a prediction into two populations. */
      const uncitedItems = (signals.uncited && signals.uncited.items) || {};
      const uncitedKeys = new Set(Object.keys(uncitedItems));
      /* THE THIRD CHANNEL (2026-08-17). Context carries a live-verified article that is genuinely
         supporting but published outside the currency window. It is a distinct population from both
         cited and uncited, and every pairing is charged as a double-count, so totality can never be
         satisfied by moving a prediction into two of the three. */
      const contextItems = (signals.context && signals.context.items) || {};
      const contextKeys = new Set(Object.keys(contextItems));
      const missingKeys = expectedKeys.filter(key => !coveredKeys.has(key) && !uncitedKeys.has(key) && !contextKeys.has(key));
      const doubleCountedKeys = expectedKeys.filter(key =>
        (coveredKeys.has(key) && uncitedKeys.has(key))
        || (coveredKeys.has(key) && contextKeys.has(key))
        || (contextKeys.has(key) && uncitedKeys.has(key)));
      const extraContextKeys = [...contextKeys].filter(key => !expectedKeys.includes(key));
      /* A context entry that cannot state its own age would render as though it were current. */
      const unexplainedContext = Object.keys(contextItems).filter(k => {
        const r = contextItems[k] || {};
        return !r.url || !/^https:\/\//i.test(String(r.url)) || !r.publisher || !r.headline || !r.quote
          || !r.publishedAt || isNaN(new Date(r.publishedAt).getTime())
          || !Number.isFinite(Number(r.ageDays)) || !r.ageBucket || !r.publishedAtSource;
      });
      const extraKeys = [...coveredKeys].filter(key => !expectedKeys.includes(key));
      const extraUncitedKeys = [...uncitedKeys].filter(key => !expectedKeys.includes(key));
      /* Every uncited record must state WHY, or the uncited population becomes a dumping ground. */
      const unexplainedUncited = Object.keys(uncitedItems).filter(k => {
        const r = uncitedItems[k] || {};
        return !r.reason || !String(r.reason).trim() || !r.statement || !String(r.statement).trim();
      });

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
          /* INVERTED 2026-08-13: the operator must now be ABSENT. This line REQUIRED it, so removing
             X from the data failed verification - a gate mandating the thing being retired. */
          && item.match && typeof item.match.search === 'string' && item.match.search.trim()
          && !/\bfrom:\s*peterxing\b|x\.com|twitter\.com/i.test(item.match.search));
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
      /* Origin evidence is the reviewed NEWS card (X retirement 2026-08-13). When a prediction
         also carries an additive current reference the pair is wrapped in .tl-evidence-group, so
         the origin card sits one level deeper. Both shapes must be accepted, but a .tl-currency
         card may NEVER satisfy this check — it is supplementary, never a prediction's evidence.

         RENDERED TOTALITY. A prediction without a qualifying source is not blank: it renders an
         explicit uncited notice, or — when a genuinely supporting article exists outside the window —
         a dated-background context card. So the DOM rule is EXACTLY ONE OF THREE. Accepting "any"
         alone would let a double render pass; requiring the cited card alone would fail every
         honestly uncited prediction. This is the strongest check here, because it proves the PAGE
         accounts for every prediction, not merely the artefact.
         Context is excluded from originCard explicitly (2026-08-17): `.tl-signal:not(.tl-currency)`
         matched a context card, so a cited card demoted to background would have satisfied the
         "origin" arm and the substitution would have been invisible here. */
      const originCard = node => node.querySelector(
        '.event-body > .tl-signal:not(.tl-currency):not(.tl-context), .event-body > .tl-evidence-group > .tl-signal:not(.tl-currency):not(.tl-context)');
      const contextCard = node => node.querySelector('.tl-signal.tl-context');
      const uncitedNotice = node => node.querySelector('.tl-signal-uncited');
      const accountedFor = node =>
        (!!originCard(node) + !!contextCard(node) + !!uncitedNotice(node)) === 1;
      const eventCoverage = eventNodes.length > 0 && eventNodes.every(accountedFor);
      const unaccountedEvents = eventNodes
        .map((node, i) => (accountedFor(node) ? null : (node.id || ('#' + i))))
        .filter(Boolean);
      const horizonCoverage = horizonNodes.length > 0 && horizonNodes.every(node =>
        node.querySelector('.horizon-epistemic')
        && node.querySelector('.horizon-prob')
        && node.querySelectorAll('.horizon-block').length === 2
        && node.querySelector('.horizon-caveat')
        && (!!node.querySelector('.horizon-signal .tl-signal:not(.tl-currency)')
            !== !!node.querySelector('.horizon-signal .tl-signal-uncited')));
      const searchLinks = Array.from(document.querySelectorAll('.tl-signal-search')).map(a => a.href);
      const dates = Array.from(document.querySelectorAll('.tl-signal-date')).map(d => d.textContent.trim());
      const directSchema = Object.keys(embeds).every(key => {
        const e = embeds[key];
        const provenance = e && e.provenance || {};
        const isNews = e && e.evidenceOwner === 'news';
        const common = e
          && (isNews
            ? /^news:[a-z0-9][a-z0-9-]*$/.test(String(e.id || ''))
              && /^https:\/\/[^\s/]+\.[^\s/]+\/\S*$/.test(String(e.url || ''))
            : /^\d{15,}$/.test(String(e.id || ''))
              && /^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d{15,}$/.test(String(e.url || '')))
          && !!e.evidenceFamily
          && e.reviewed === true
          && !!e.mappingRationale;
        if (!common) return false;
        if (isNews) {
          return e.kind === 'news'
            && e.activityKind === 'news'
            && provenance.evidenceOwner === 'news'
            && provenance.activityKind === 'news'
            && !!provenance.publisher
            && !!provenance.publisherHost
            && !!provenance.publishedAt
            && !!provenance.retrievedAt
            && !!provenance.sourceQuality
            && !!provenance.textSha256
            && provenance.verifiedThrough === 'live-fetch+quote-match'
            && Array.isArray(provenance.sourceChain)
            && provenance.sourceChain.includes('quote-match')
            && !!e.headline && !!e.quote && !!e.publisher
            && e.matchMethod === 'reviewed-news'
            && ['direct', 'scenario', 'leading-indicator'].includes(e.evidenceType)
            && ['unique', 'news-reuse'].includes(e.assignmentMode)
            && !!e.reuseFamily;
        }
        /* X RETIREMENT 2026-08-13 — a rendered card owned by 'peterxing' or 'external' is a
           reinstatement, not a valid card. The old code ACCEPTED either whenever its X provenance was
           well-formed, which is the X contract restated in provenance vocabulary. The only valid
           owner is news, checked above; everything else is rejected. */
        return false;
      });
      const searchSchema = Object.keys(searches).length === 0;
      /* X retirement (2026-08-13). 'external-reuse' and 'family-reuse' were the X reuse modes
         for the external ledger and Peter's evidence families. News reuse is legitimate only
         when one article supports several predictions WITHIN ONE DECLARED compatible family.
         The family must be non-empty: undefined === undefined collapses to a single group, so
         an undeclared family would otherwise satisfy this check by being absent — the same
         shape as a retired floor silently satisfying every comparison it appears in. */
      const invalidReuse = Object.entries(postUses).filter(([, uses]) => {
        if (uses.length <= 1) return false;
        const owners = new Set(uses.map(use => use.evidenceOwner));
        const families = new Set(uses.map(use => use.reuseFamily));
        return owners.size !== 1
          || !owners.has('news')
          || families.size !== 1
          || !String(uses[0].reuseFamily || '').trim()
          || uses.some(use => use.assignmentMode !== 'news-reuse');
      }).map(([id]) => id);
      return {
        eventCount: eventNodes.length,
        expectedEventCount: datedKeys.length,
        horizonCount: horizonNodes.length,
        expectedHorizonCount: horizonItems.length,
        cards: document.querySelectorAll('#timelineBody .event-body .tl-signal:not(.tl-currency), #horizonBody .horizon-signal .tl-signal:not(.tl-currency)').length,
        evidenceItems: document.querySelectorAll('#timelineBody .event-body > .tl-signal:not(.tl-currency), #horizonBody .horizon-signal > .tl-signal:not(.tl-currency), #timelineBody .event-body > .tl-evidence-group > .tl-signal:not(.tl-currency), #horizonBody .horizon-signal > .tl-evidence-group > .tl-signal:not(.tl-currency)').length,
        /* The additive currency layer, counted separately so it can never be mistaken for
           direct coverage. Every currency card must sit inside an evidence group that also
           contains an origin card — asserted below. */
        currencyCards: document.querySelectorAll('.tl-signal.tl-currency').length,
        orphanCurrency: [...document.querySelectorAll('.tl-signal.tl-currency')].filter(card => {
          const group = card.closest('.tl-evidence-group');
          return !group || !group.querySelector('.tl-signal:not(.tl-currency)');
        }).length,
        currencyWithXAffordance: [...document.querySelectorAll('.tl-signal.tl-currency')].filter(card =>
          card.querySelector('[data-tweet], a[href*="x.com"], a[href*="twitter.com"]')).length,
        chips: searchLinks.length,
        expectedSearches: 0,
        strayCards: document.querySelectorAll('#timelineBody .year-row > div > .tl-signal').length,
        source: signals.source || '',
        sourceStatus: signals.sourceStatus || null,
        sourceAttempts: signals.sourceAttempts || null,
        sourceFresh: signals.sourceFresh === true,
        sourceFetchedAt: signals.sourceFetchedAt || null,
        newestItemAt: signals.newestItemAt || null,
        realityCount: Array.isArray(signals.reality) ? signals.reality.length : 0,
        realityMalformed: (Array.isArray(signals.reality) ? signals.reality : []).map((r, i) => {
          const miss = [];
          if (!r || !String(r.tag || '').trim()) miss.push('tag');
          if (!r || !String(r.kind || '').trim()) miss.push('kind');
          /* Every signal must SAY something: cited signals carry the article quote, uncited
             ones carry the honest "no qualifying source" statement. Both live in .t */
          if (!r || !String(r.t || '').trim()) miss.push('t');
          /* A headline belongs to an article, so only a cited signal can have one. */
          if (r && r.kind !== 'none' && !String(r.headline || '').trim()) miss.push('headline');
          /* A signal either cites a publisher+url, or is explicitly kind:'none'. Anything
             else is a half-rendered card claiming a source it cannot show. */
          if (r && r.kind !== 'none') {
            if (!String(r.publisher || '').trim()) miss.push('publisher');
            if (!String(r.url || '').trim()) miss.push('url');
            if (!String(r.date || '').trim()) miss.push('date');
          }
          return miss.length ? ('#' + i + ' ' + (r && r.tag ? r.tag : '?') + ' missing ' + miss.join('/')) : null;
        }).filter(Boolean),
        methodCounts,
        badMethods,
        maxReuse: Math.max(0, ...Object.values(postUses).map(uses => uses.length)),
        invalidReuse,
        missingKeys,
        extraKeys,
        doubleCountedKeys,
        unaccountedEvents,
        sourceRowFanOut: Object.keys(rowsPerSource)
          .filter(k => rowsPerSource[k].size > 1)
          .map(k => k + ' -> ' + [...rowsPerSource[k]].join(' + ')),
        extraUncitedKeys,
        unexplainedUncited,
        extraContextKeys,
        unexplainedContext,
        citedCount: Object.keys(embeds).length,
        contextCount: contextKeys.size,
        uncitedCount: uncitedKeys.size,
        expectedCount: expectedKeys.length,
        eventCoverage,
        horizonCoverage,
        directSchema,
        searchSchema,
        coverageMetadata: signals.coverage && signals.coverage.complete === true
          && signals.coverage.cited === Object.keys(embeds).length
          && signals.coverage.searches === 0
          && signals.coverage.total === expectedKeys.length
          /* GC seq-147 §2. `total` is the REGISTERED count while `expectedKeys` is an unfiltered
             recount of the same file, so under a dropped entry both are the pre-drop number and
             the line above cannot separate them — a term narrowed to the offline-fallback and
             read-skew cases only. The loss is published directly, so it is asserted directly here
             rather than inferred. This gate is the cross-file twin of verify-direct-coverage.js:
             fixing the instance there and not the class here is the same partial-subject error
             both trees keep committing. */
          && signals.coverage.kept === expectedKeys.length
          && signals.coverage.dropped === 0
          /* X RETIREMENT 2026-08-13 — these required 24 sticky @peterxing mappings and 10 authored
             ones to be PRESENT. Asserted absent rather than compared: a retired floor compared
             numerically is the 'x < null is x < 0' trap, where a missing floor silently satisfies
             every '>=' it appears in.
             A12-CLASS EXCEPTION (GC seq-112/115) — DO NOT "FIX" THE `|| 0` ON THE NEXT TWO LINES.
             Elsewhere `|| 0` manufactures an expectation out of an absent field and is a defect.
             Here the ZERO IS THE FINDING: these two lines assert that the retired X owner and medium
             tallies are absent-or-zero, so coercing absence to 0 is the intended semantics. */
          && signals.coverage.stickyPeterFloor === undefined
          && signals.coverage.stickyPeterAuthoredFloor === undefined
          && Number(signals.coverage.byEvidenceOwner?.peterxing || 0) === 0
          && Number(signals.coverage.byEvidenceMedium?.x || 0) === 0
          && signals.coverage.maxReuse === Math.max(0, ...Object.values(postUses).map(uses => uses.length)),
        horizonSchema,
        horizonCaveats,
        datesMissing: dates.filter(date => !date).length,
      };
    });

    const checks = {
      /* X RETIREMENT 2026-08-13 — this demanded source 'archive-verified', primarySource
         'first-party-status', a positive hydration count and wayback-cdx/tweet-result/x-oembed
         attempts. All five are X-era facts the artefact no longer carries, so this REACHABLE check
         failed on every term. It now asserts the news contract and additionally asserts every
         recorded attempt is RETIRED, so a quiet return to any X source fails here. */
      source: stats.sourceFresh && stats.source === 'news-verified' && !!stats.sourceFetchedAt && !!stats.newestItemAt
        && stats.sourceStatus && stats.sourceStatus.activeSource === stats.source
        && stats.sourceStatus.mode === 'news-verified'
        && stats.sourceStatus.primarySource === 'live-verified-news'
        && Number(stats.sourceStatus.windowDays) > 0
        && Array.isArray(stats.sourceAttempts)
        && ['x-api', 'archive-verified'].every(source =>
          stats.sourceAttempts.some(attempt => attempt.source === source && attempt.status === 'retired'))
        && !stats.sourceAttempts.some(attempt => attempt.status !== 'retired'),
      eventCount: stats.eventCount === stats.expectedEventCount,
      horizonCount: stats.horizonCount === stats.expectedHorizonCount && stats.expectedHorizonCount >= 7,
      exactCoverage: !stats.missingKeys.length && !stats.extraKeys.length
        && !stats.doubleCountedKeys.length && !stats.extraUncitedKeys.length
        && !stats.unexplainedUncited.length
        && !stats.extraContextKeys.length && !stats.unexplainedContext.length
        && (stats.citedCount + stats.contextCount + stats.uncitedCount) === stats.expectedCount,
      renderedCoverage: stats.eventCoverage && stats.horizonCoverage,
      horizonSchema: stats.horizonSchema && stats.horizonCaveats,
      methods: !stats.badMethods.length,
      reuse: !stats.invalidReuse.length,
      directSchema: stats.directSchema,
      searchSchema: stats.searchSchema,
      searches: stats.chips === 0 && stats.expectedSearches === 0,
      coverageMetadata: stats.coverageMetadata,
      /* Was 'realityCount === 6', a hardcoded count that any added signal breaks and that
         asserted nothing about quality. The real risks are the layer silently emptying and
         a malformed entry rendering blank, so assert a floor AND well-formedness. */
      reality: stats.realityCount >= 6 && stats.realityMalformed.length === 0,
      layout: stats.strayCards === 0 && stats.datesMissing === 0,
      /* The currency layer is strictly additive: no currency card may stand alone without
         an origin card beside it, and none may carry an X affordance that would let a news
         article read as one of Peter's posts. */
      currencyAdditive: stats.orphanCurrency === 0,
      currencyNotDisguisedAsX: stats.currencyWithXAffordance === 0,
      console: errors.length === 0,
    };
    const ok = Object.values(checks).every(Boolean);
    console.log(`[${theme}] events=${stats.eventCount}/${stats.expectedEventCount} horizon=${stats.horizonCount}/${stats.expectedHorizonCount} evidence=${stats.evidenceItems} direct=${stats.cards} currency=${stats.currencyCards} searches=${stats.chips} source=${stats.source} fresh=${stats.sourceFresh} methods=${JSON.stringify(stats.methodCounts)} maxReuse=${stats.maxReuse} missing=${stats.missingKeys.length} extra=${stats.extraKeys.length} errs=${errors.length} -> ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) console.log('   CHECKS:', JSON.stringify(checks));
    if (errors.length) console.log('   ERRORS:', errors.slice(0, 4).join(' | '));
    console.log(`   accounting: cited=${stats.citedCount} + context=${stats.contextCount} + uncited=${stats.uncitedCount} = ${stats.citedCount + stats.contextCount + stats.uncitedCount} of ${stats.expectedCount}`);
    if (stats.missingKeys.length) console.log('   MISSING (in none of cited/context/uncited):', stats.missingKeys.slice(0, 12).join(', '));
    if (stats.doubleCountedKeys.length) console.log('   DOUBLE-COUNTED (in more than one channel):', stats.doubleCountedKeys.slice(0, 12).join(', '));
    if (stats.extraContextKeys.length) console.log('   CONTEXT FOR UNKNOWN PREDICTION:', stats.extraContextKeys.slice(0, 12).join(', '));
    if (stats.unexplainedContext.length) console.log('   CONTEXT WITHOUT AGE/PROVENANCE:', stats.unexplainedContext.slice(0, 12).join(', '));
    if (stats.unaccountedEvents.length) console.log('   RENDERED WITHOUT EXACTLY ONE EVIDENCE STATE:', stats.unaccountedEvents.slice(0, 12).join(', '));
    if (stats.realityMalformed.length) console.log('   MALFORMED REALITY SIGNALS:', stats.realityMalformed.slice(0, 6).join(' | '));
    if (stats.sourceRowFanOut.length) console.log('   NOTE one article, multiple ledger rows (reuse counted by article):', stats.sourceRowFanOut.slice(0, 4).join(' | '));
    if (stats.extraUncitedKeys.length) console.log('   UNCITED FOR UNKNOWN PREDICTION:', stats.extraUncitedKeys.slice(0, 12).join(', '));
    if (stats.unexplainedUncited.length) console.log('   UNCITED WITHOUT REASON/STATEMENT:', stats.unexplainedUncited.slice(0, 12).join(', '));
    if (stats.extraKeys.length) console.log('   EXTRA:', stats.extraKeys.slice(0, 12).join(', '));
    if (stats.badMethods.length) console.log('   BAD METHODS:', stats.badMethods.slice(0, 4).join(' | '));
    if (SHOT) await page.screenshot({ path: SHOT.replace('THEME', theme), fullPage: false });
    if (!ok) pass = false;
    await ctx.close();
  }
  const offlineContext = await browser.newContext();
  const offlinePage = await offlineContext.newPage();
  const offlineErrors = [];
  offlinePage.on('console', message => {
    if (message.type() === 'error') offlineErrors.push(message.text());
  });
  offlinePage.on('pageerror', error => offlineErrors.push(error.message));
  await offlinePage.route('**/signals.json*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '',
  }));
  await offlinePage.goto(URL + (URL.includes('?') ? '&' : '?') + 'scoutTheme=dark&verifyOffline=1', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  const offline = await offlinePage.evaluate(() => {
    const expected = document.querySelectorAll('#timelineBody .event').length
      + document.querySelectorAll('#horizonBody .horizon-item').length;
    const links = [...document.querySelectorAll('.tl-signal-search')];
    return {
      expected,
      direct: document.querySelectorAll('.tl-signal').length,
      unavailable: document.querySelectorAll('.tl-signal-unavailable').length,
      searches: links.length,
      /* INVERTED 2026-08-13. A search link counted as "honest" only if it pointed at
         x.com/search?q=from:peterxing. None is honest now - the offline state must show the
         unavailable notice and link nowhere - so honesty is the ABSENCE of any X link.

         NON-VACUITY, ASSERTED IN PLACE. `[].every(...)` is true, so "no anchor points at X" is
         satisfied by a page that rendered NO ANCHORS AT ALL — precisely the broken-render state this
         offline test exists to detect. That case is covered structurally by `offline.expected >= 103`
         and `offline.unavailable === offline.expected` below, both counted from this same DOM
         snapshot, so the gate does fail on a blank page. But the cover is a NEIGHBOUR, and a
         neighbour is a refactor away from being the fourth accidental save in this tree. The
         quantifier now proves its own subject non-empty: measured 154 anchors in the failure state
         (site chrome, chapter and footer links all render before signals are fetched), so `> 0` is a
         measured floor, not an assumption, and it cannot false-fail without the page being broken. */
      honest: document.querySelectorAll('a[href]').length > 0
        && links.length === 0
        && [...document.querySelectorAll('a[href]')].every(link => {
          try { return !/(?:^|\.)(?:x\.com|twitter\.com)$/i.test(new URL(link.href, location.href).hostname); }
          catch { return true; }
        }),
      anchors: document.querySelectorAll('a[href]').length,
    };
  });
  const offlineOk = offline.expected >= 103
    && offline.searches === 0
    && offline.direct === 0
    && offline.unavailable === offline.expected
    && offline.honest
    && offlineErrors.length === 0;
  console.log(`[signals-fetch-failure] searches=${offline.searches}/${offline.expected} direct=${offline.direct} unavailable=${offline.unavailable} anchors=${offline.anchors} errs=${offlineErrors.length} -> ${offlineOk ? 'OK' : 'FAIL'}`);
  if (offlineErrors.length) console.log('   ERRORS:', offlineErrors.slice(0, 4).join(' | '));
  if (!offlineOk) pass = false;
  await offlineContext.close();
  await browser.close();
  console.log('RESULT: ' + (pass ? 'PASS' : 'FAIL'));
  process.exit(pass ? 0 : 1);
})();
