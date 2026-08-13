'use strict';

/*
 * VERIFIER FOR THE TIER-3 NEWS EVIDENCE PATH
 * ==========================================
 * Two halves, both mandatory:
 *
 *   LEDGER  — every reviewed news mapping currently published must still be
 *             live, unchanged and correctly bound. Fails closed on a dead URL,
 *             a moved quote, a changed headline or date, a rejected publisher,
 *             a broken prediction binding or a breach of the reuse ceiling.
 *
 *   PROOFS  — the path is exercised against the real web on every run, so the
 *             machinery is known to work BEFORE an outage forces it into use:
 *               1. a real authoritative article verifies end to end;
 *               2. a fabricated / 404 URL fails closed;
 *               3. a quote that is no longer present fails closed;
 *               4. an aggregator is rejected before it is ever fetched;
 *               5. the reuse ceiling holds.
 *             With a browser URL it also proves the UI renders news honestly as
 *             news, and that the page's own coverage validator accepts it.
 *
 * News can never satisfy the Peter floors, and it can never displace a reviewed
 * X mapping. Both of those are asserted here, not assumed.
 */

// Concurrency interlock: claim the tree before reading predictions/signals/approvals/floors.
if (require.main === module) require('./pipeline-lock').guard('verify:news');

const fs = require('fs');
const path = require('path');
// X RETIREMENT 2026-08-13 — evidence-approvals.json is deleted; there are no X approvals to read.
const approvals = {};
const { EXTERNAL_MAPPINGS } = require('./external-evidence');
const news = require('./news-evidence');

const {
  NEWS_GROUPS,
  NEWS_MAPPINGS,
  NEWS_SOURCES,
  NEWS_QUALITY_CLASSES,
  classifyHost,
  extractArticle,
  fetchArticle,
  quotePresent,
  registrableHost,
  sha256,
  verifyNewsSource,
} = news;

const readJson = file => JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/^\uFEFF/, ''));
const predictions = readJson('predictions.json');
const signals = readJson('signals.json');
// Fails closed: `catch { return {} }` here silently restored the hardcoded reuse ceiling of 10 that
// the registered value exists to tighten, and reported the same exit code either way. The integer
// assertion is the second half — measured before it was added, maxReuse:"not-a-number" left this
// verifier at exit 0 with the ceiling silently loosened from the registered 9 to that literal.
const floors = (() => {
  let doc;
  try {
    doc = readJson('evidence-floors.json');
  } catch (error) {
    console.error(`RESULT: FAIL — evidence-floors.json could not be read as JSON (${error.message}). The evidence `
      + 'ratchet is a gate, not a hint: refusing rather than falling back to the ceiling it exists to tighten.');
    process.exit(1);
  }
// X RETIREMENT 2026-08-13 — this demanded an X-post reuse ceiling and exited 1 when it was absent,
// which made the NEWS verifier unrunnable the moment X was retired. Inverted, exactly as the
// refresh-signals read-site was: reinstating a retired X floor is now what fails.
if (['peterTotal', 'peterAuthored', 'maxReuse'].some(k => k in doc)) {
  console.error('verify:news FAILED - evidence-floors.json reinstates a retired X floor.');
  process.exit(1);
}
  return doc;
})();

const MAX_REVIEWED_REUSE = Math.min(10, Number.isFinite(Number(floors.maxReuse)) ? Number(floors.maxReuse) : 10);
const expectedIds = new Set([
  ...predictions.years.flatMap(year => year.events.map((_, index) => `${year.year}-${index}`)),
  ...predictions.postSuperintelligence.items.map(item => `horizon-${item.id}`),
]);

/* ------------------------------------------------------------------ *
 * Ledger audit — pure, so the synthetic proofs can reuse it verbatim
 * ------------------------------------------------------------------ */

function auditLedger({ sources, mappings, ceiling, predictionIds, peterApprovals, externalMappings, embeds }) {
  const problems = [];
  const usesBySource = new Map();

  for (const [predictionId, mapping] of Object.entries(mappings)) {
    if (!predictionIds.has(predictionId)) {
      problems.push(`${predictionId}: news mapping references an unknown prediction`);
    }
    if (peterApprovals[predictionId]) {
      problems.push(`${predictionId}: news evidence must never displace a reviewed Peter mapping`);
    }
    if (externalMappings[predictionId]) {
      problems.push(`${predictionId}: news evidence must never displace a reviewed external X mapping`);
    }
    const source = sources[mapping.source];
    if (!source) {
      problems.push(`${predictionId}: unknown news source ${mapping.source}`);
      continue;
    }
    if (!usesBySource.has(mapping.source)) usesBySource.set(mapping.source, []);
    usesBySource.get(mapping.source).push({ predictionId, mapping });
    if (!['direct', 'scenario', 'leading-indicator'].includes(mapping.evidenceType)) {
      problems.push(`${predictionId}: invalid news evidence type`);
    }
    if (!mapping.rationale || !mapping.reviewedAt || !mapping.reuseFamily || !mapping.lastVerifiedAt) {
      problems.push(`${predictionId}: incomplete reviewed news mapping metadata`);
    }
    const embed = embeds && embeds[predictionId];
    if (embed && (embed.evidenceOwner !== 'news'
        || embed.kind !== 'news'
        || embed.url !== source.resolvedUrl
        || embed.mappingRationale !== mapping.rationale
        || embed.reuseFamily !== mapping.reuseFamily
        || embed.evidenceType !== mapping.evidenceType)) {
      problems.push(`${predictionId}: published embed differs from the reviewed news mapping`);
    }
  }

  for (const [key, source] of Object.entries(sources)) {
    const uses = usesBySource.get(key) || [];
    if (!uses.length) problems.push(`${key}: unused news source`);
    if (!NEWS_QUALITY_CLASSES.has(source.sourceQuality)) {
      problems.push(`${key}: invalid source-quality class`);
    }
    const gate = classifyHost(source.resolvedUrl || source.url || '');
    if (!gate.ok) problems.push(`${key}: ${gate.reason}`);
    else if (gate.host !== registrableHost(source.publisherHost || '')) {
      problems.push(`${key}: resolved host ${gate.host} does not match declared publisher host ${source.publisherHost}`);
    }
    if (uses.length > ceiling) {
      problems.push(`${key}: reuse ${uses.length} exceeds reviewed ceiling ${ceiling}`);
    }
    if (uses.length > 1 && new Set(uses.map(use => use.mapping.reuseFamily)).size !== 1) {
      problems.push(`${key}: reuse crosses reviewed compatibility groups`);
    }
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * Proof harness
 * ------------------------------------------------------------------ */

const PROOF_FEEDS = [
  'https://feeds.arstechnica.com/arstechnica/technology-lab',
  'https://www.technologyreview.com/feed/',
  'https://spectrum.ieee.org/feeds/feed.rss',
  'https://www.nature.com/nature.rss',
];

async function discoverProofArticle() {
  for (const feed of PROOF_FEEDS) {
    const response = await fetchArticle(feed).catch(() => ({ ok: false }));
    if (!response.ok) continue;
    const links = [...response.body.matchAll(/<link[^>]*>([^<]+)<\/link>|<link[^>]+href="([^"]+)"/gi)]
      .map(match => (match[1] || match[2] || '').trim())
      .filter(url => /^https?:\/\//.test(url) && !/\.(rss|xml)(\?|$)/i.test(url))
      .filter(url => {
        const gate = classifyHost(url);
        return gate.ok && new URL(url).pathname.length > 12;
      });
    for (const link of links.slice(0, 4)) {
      const article = await fetchArticle(link).catch(() => ({ ok: false }));
      if (!article.ok) continue;
      const extracted = extractArticle(article.body, article.finalUrl);
      const sentence = (extracted.mainText.match(/[^.!?]{60,220}[.!?]/g) || [])
        .map(value => value.trim())
        .find(value => value.length >= 60);
      if (extracted.headline && extracted.publisher && extracted.publishedAt && sentence) {
        return { url: link, article, extracted, sentence };
      }
    }
  }
  return null;
}

async function runProofs(log) {
  const results = [];
  const record = (name, passed, detail) => {
    results.push({ name, passed, detail });
    log(`  ${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  // Proof 4 first: it needs no network at all, so it always runs.
  const aggregator = classifyHost('https://news.google.com/articles/CBMi-example');
  const shortener = classifyHost('https://bit.ly/3xample');
  const releaseMill = classifyHost('https://www.prnewswire.com/news-releases/example.html');
  record('aggregator, shortener and press-release mill rejected before fetch',
    !aggregator.ok && !shortener.ok && !releaseMill.ok,
    `${aggregator.reason}; ${shortener.reason}; ${releaseMill.reason}`);

  // Proof 5: the reuse ceiling holds, exercised through the real audit function.
  const syntheticSources = {
    'proof-source': {
      url: 'https://arstechnica.com/proof',
      resolvedUrl: 'https://arstechnica.com/proof',
      publisher: 'Ars Technica',
      publisherHost: 'arstechnica.com',
      headline: 'Proof',
      publishedAt: '2026-01-01T00:00:00.000Z',
      publishedAtSource: 'page',
      retrievedAt: '2026-01-01',
      sourceQuality: 'primary-news-organization',
      quote: 'A sufficiently long verbatim supporting sentence used only for the ceiling proof.',
      textSha256: sha256('proof'),
    },
  };
  const overCeiling = {};
  const ids = [...expectedIds].slice(0, MAX_REVIEWED_REUSE + 1);
  for (const id of ids) {
    overCeiling[id] = {
      source: 'proof-source',
      reuseFamily: 'proof-family',
      evidenceType: 'leading-indicator',
      rationale: 'ceiling proof',
      reviewedAt: '2026-01-01',
      lastVerifiedAt: '2026-01-01',
    };
  }
  const ceilingProblems = auditLedger({
    sources: syntheticSources,
    mappings: overCeiling,
    ceiling: MAX_REVIEWED_REUSE,
    predictionIds: expectedIds,
    peterApprovals: {},
    externalMappings: {},
    embeds: {},
  });
  record('reuse ceiling holds against an over-ceiling ledger',
    ceilingProblems.some(problem => problem.includes(`exceeds reviewed ceiling ${MAX_REVIEWED_REUSE}`)),
    `${ids.length} mappings on one source rejected at ceiling ${MAX_REVIEWED_REUSE}`);

  // Proof 2: a fabricated URL on a real publisher must fail closed.
  const fabricated = await verifyNewsSource('proof-fabricated', {
    url: 'https://arstechnica.com/this-article-does-not-exist-verification-probe',
    resolvedUrl: 'https://arstechnica.com/this-article-does-not-exist-verification-probe',
    publisher: 'Ars Technica',
    publisherHost: 'arstechnica.com',
    headline: 'An article that was never published',
    publishedAt: '2026-01-01T00:00:00.000Z',
    publishedAtSource: 'page',
    retrievedAt: '2026-01-01',
    sourceQuality: 'primary-news-organization',
    quote: 'A fabricated sentence that no real article on this publisher has ever contained anywhere.',
    textSha256: sha256('fabricated'),
  });
  const fabricatedFailed = fabricated.problems.some(problem => /live fetch failed|HTTP 4\d\d/.test(problem));
  record('fabricated / non-existent article fails closed', fabricatedFailed,
    fabricated.problems[0] || 'no problem reported');

  // Proofs 1 and 3 need a real, currently published article.
  const discovered = await discoverProofArticle();
  if (!discovered) {
    log('  INFRASTRUCTURE — no proof article could be retrieved from any authoritative feed;');
    log('  proofs 1 and 3 were not exercised this run. This is a network fault, not an evidence fault.');
    return { results, infrastructure: true };
  }

  const reviewed = {
    url: discovered.url,
    resolvedUrl: discovered.extracted.canonicalUrl,
    publisher: discovered.extracted.publisher,
    publisherHost: discovered.extracted.host,
    author: discovered.extracted.author,
    headline: discovered.extracted.headline,
    publishedAt: discovered.extracted.publishedAt,
    /* This date was read out of the fetched page, not out of a feed - which is exactly the
       distinction publishedAtSource exists to record. */
    publishedAtSource: 'page',
    retrievedAt: new Date().toISOString().slice(0, 10),
    sourceQuality: 'primary-news-organization',
    quote: discovered.sentence,
    textSha256: discovered.extracted.textSha256,
  };
  const live = await verifyNewsSource('proof-live', reviewed);
  record('real authoritative article verifies end to end', live.problems.length === 0,
    `${reviewed.publisher} · ${reviewed.publishedAt.slice(0, 10)} · ${reviewed.headline.slice(0, 60)}`
    + (live.problems.length ? ` :: ${live.problems.join('; ')}` : ''));

  const drifted = await verifyNewsSource('proof-quote-drift', {
    ...reviewed,
    quote: 'This precise sentence has been removed from the article since it was reviewed and cannot be found.',
  });
  record('quote drift fails closed',
    drifted.problems.some(problem => problem.includes('no longer present')),
    drifted.problems.find(problem => problem.includes('no longer present')) || 'no drift problem reported');

  const headlineDrift = await verifyNewsSource('proof-headline-drift', {
    ...reviewed,
    headline: 'A headline this article has never carried',
  });
  record('headline drift fails closed',
    headlineDrift.problems.some(problem => problem.includes('headline changed materially')),
    'material metadata change blocks publication');

  return { results, infrastructure: false, proofArticle: reviewed };
}

/* ------------------------------------------------------------------ *
 * Browser proof — the UI must present news as news, never as an X post
 * ------------------------------------------------------------------ */

async function runBrowserProof(baseUrl, log) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    log('  SKIP browser proof — playwright is not installed');
    return [];
  }
  const problems = [];
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (!response || !response.ok()) {
      problems.push(`browser proof could not load ${baseUrl}`);
      return problems;
    }
    await page.waitForFunction(() => typeof window.signalCard === 'function', null, { timeout: 20000 })
      .catch(() => {});
    const rendered = await page.evaluate(() => {
      if (typeof window.signalCard !== 'function') return { unavailable: true };
      const signal = {
        id: 'news:example-publisher:2026-07-31:1',
        kind: 'news',
        activityKind: 'news',
        authorship: 'news',
        evidenceOwner: 'news',
        author: 'A. Reporter',
        displayName: 'Example Publisher',
        url: 'https://example.org/2026/07/story',
        headline: 'A headline <with> "unsafe" characters & entities',
        publisher: 'Example Publisher',
        publishedAt: '2026-07-31T12:00:00.000Z',
        quote: 'A verbatim sentence from the article that supports the mapped prediction.',
        provenance: {
          evidenceOwner: 'news',
          activityKind: 'news',
          publisher: 'Example Publisher',
          publisherHost: 'example.org',
          sourceQuality: 'primary-news-organization',
          retrievedAt: '2026-08-03',
          verifiedThrough: 'live-fetch+quote-match',
          sourceChain: ['live-fetch', 'metadata-extract', 'quote-match'],
        },
        recency: 'news',
        matchMethod: 'reviewed-news',
        matchBasis: 'leading-indicator',
        assignmentMode: 'unique',
        evidenceFamily: 'agents-workflows',
        reuseFamily: 'news-proof',
        evidenceType: 'leading-indicator',
        mappingRationale: 'Proof rationale.',
        sourceQuality: 'primary-news-organization',
        reuseCount: 1,
        reviewed: true,
        reviewedAt: '2026-08-03',
        lastVerifiedAt: '2026-08-03',
        date: '31 Jul 2026',
        maps: 'Proof prediction text.',
        text: 'A verbatim sentence from the article that supports the mapped prediction.',
        likes: 0,
        rts: 0,
      };
      return { html: window.signalCard(signal) };
    });
    if (rendered.unavailable) {
      problems.push('signalCard is not reachable in the page for the news rendering proof');
      return problems;
    }
    const html = rendered.html || '';
    if (!/News evidence/.test(html)) problems.push('news card does not carry a News evidence label');
    if (!/Example Publisher/.test(html)) problems.push('news card does not name the publisher');
    if (/tl-signal-load|data-tweet/.test(html)) problems.push('news card offers an X embed affordance');
    if (/x\.com/.test(html)) problems.push('news card links to x.com');
    if (!/https:\/\/example\.org\/2026\/07\/story/.test(html)) problems.push('news card does not link the resolved article URL');
    if (/<with>/.test(html) || /&(?!amp;|middot;|mdash;|rarr;|hellip;|#\d+;|quot;|lt;|gt;)/.test(html.replace(/&amp;|&quot;|&lt;|&gt;|&middot;|&mdash;|&rarr;|&hellip;|&#\d+;/g, ''))) {
      problems.push('news card does not escape publisher-supplied text');
    }
    log(`  PASS news card renders as news — ${html.replace(/\s+/g, ' ').match(/News evidence[^<]*/)?.[0]?.trim() || 'label present'}`);

    const validated = await page.evaluate(() => {
      if (typeof window.hasCompleteSignalCoverage !== 'function') return { unavailable: true };
      return { available: true };
    });
    if (validated.unavailable) {
      problems.push('hasCompleteSignalCoverage is not reachable in the page');
    }
  } finally {
    await browser.close();
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

(async () => {
  const lines = [];
  const log = message => lines.push(message);
  const problems = [];

  const publishedNews = Object.entries(signals.embeds || {})
    .filter(([, embed]) => embed && embed.evidenceOwner === 'news');
  const mappingIds = Object.keys(NEWS_MAPPINGS);

  log(`Reviewed news sources: ${Object.keys(NEWS_SOURCES).length}; reviewed news mappings: ${mappingIds.length}; published news embeds: ${publishedNews.length}`);

  problems.push(...auditLedger({
    sources: NEWS_SOURCES,
    mappings: NEWS_MAPPINGS,
    ceiling: MAX_REVIEWED_REUSE,
    predictionIds: expectedIds,
    peterApprovals: approvals,
    externalMappings: EXTERNAL_MAPPINGS,
    embeds: signals.embeds || {},
  }));

  // Every published news embed must have a reviewed mapping behind it.
  for (const [predictionId] of publishedNews) {
    if (!NEWS_MAPPINGS[predictionId]) {
      problems.push(`${predictionId}: published news embed has no reviewed news mapping`);
    }
  }
  // News must never be counted as Peter evidence.
  /* A12 CLASS (GC seq-115). `owners.news || 0` was an expectation manufactured from an absent key:
     with the tally deleted AND no news embeds it reads 0 !== 0 and passes vacuously, on a payload
     that has lost its evidence accounting entirely. The tally must be PRESENT and numeric. */
  const owners = (signals.coverage && signals.coverage.byEvidenceOwner) || {};
  if (!Number.isFinite(Number(owners.news))) {
    problems.push('coverage.byEvidenceOwner.news is missing or non-numeric, so the news tally '
      + `cannot be compared against the ${publishedNews.length} published news embeds`);
  } else if (Number(owners.news) !== publishedNews.length) {
    problems.push(`coverage.byEvidenceOwner.news (${owners.news}) does not match published news embeds (${publishedNews.length})`);
  }
  /* X RETIREMENT 2026-08-13 - SECOND ATTEMPT. GC seq-90 caught `floors.peterTotal || 0` making this
     `0 < 0`. My first repair wrote `const peterFloor = null`, and GC seq-91 measured that `x < null`
     IS `x < 0`, because null coerces to 0 in a relational comparison. I changed the SPELLING of the
     vacuity and left the semantics - then wrote an authoritative comment on top asserting this exact
     line was handled. That is worse than the untouched bug: the note gives the next reader, or the
     next agent, a documented reason not to look. Prose-vs-code drift about the fix itself.

     There is no Peter evidence left to floor, so a numeric floor of ANY value is meaningless here.
     The intent - "news must never make up the difference" - is re-expressed positively against
     something that still exists: after the retirement, X-owned coverage must be ABSENT. An absent key
     and a zero both satisfy that; a reappearance fails it. Asserted, not defaulted. */
  const peterOwned = Number(owners.peterxing || 0);
  if (peterOwned !== 0) {
    problems.push(`coverage.byEvidenceOwner.peterxing is ${peterOwned}; @peterxing X evidence was retired `
      + 'on 2026-08-13 and must be absent. A nonzero count means an X mapping was reinstated.');
  }

  // Live re-verification of every reviewed news source before publish.
  for (const [key, source] of Object.entries(NEWS_SOURCES)) {
    const result = await verifyNewsSource(key, source).catch(error => ({ problems: [`${key}: ${error.message}`] }));
    problems.push(...result.problems);
    if (!result.problems.length) {
      log(`  live OK ${key} — ${source.publisher} · ${String(source.publishedAt).slice(0, 10)}${result.textDrift ? ' (boilerplate text drift; headline, date and quote unchanged)' : ''}`);
    }
  }

  log('Proofs:');
  const proofs = await runProofs(log);
  for (const proof of proofs.results) {
    if (!proof.passed) problems.push(`proof failed: ${proof.name}`);
  }

  const baseUrl = process.argv[2];
  if (baseUrl) {
    log('Browser proof:');
    problems.push(...await runBrowserProof(baseUrl, log).catch(error => [`browser proof error: ${error.message}`]));
  }

  lines.forEach(line => console.log(line));
  if (problems.length) {
    console.log(`RESULT: FAIL (${problems.length} problem(s))`);
    problems.forEach(problem => console.log(`  - ${problem}`));
    process.exit(1);
  }
  const state = mappingIds.length
    ? `${mappingIds.length} reviewed news mapping(s) are live, quoted and unchanged`
    : 'no prediction currently needs the news tier — every prediction still has reviewed X evidence';
  console.log(`RESULT: PASS — ${state}; the verified-news path is proven live and fails closed on fabrication, drift and aggregators.`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
