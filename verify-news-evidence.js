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
 *             --academic-dates-only runs the offline date regressions alone;
 *             its focused result is not a full NEWS or publication verdict.
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
  NEWS_TRANSPORTS,
  classifyHost,
  classifyNewsCurrency,
  defaultNewsMirror,
  extractArticle,
  fetchArticle,
  quotePresent,
  registrableHost,
  sha256,
  verifyNewsSource,
  verifyNewsSourceAllowingLastGood,
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
    /* TRANSPORT IS A LEDGER FIELD, SO IT IS VALIDATED WHERE LEDGER FIELDS ARE VALIDATED. A row may
       declare transport 'browser' for a publisher that refuses a plain GET (news-evidence.js
       NEWS_TRANSPORTS). An undeclared row means 'https' and is unchanged. A row declaring anything
       else is refused HERE, in a gate that already runs every day, rather than only in the
       browser-channel verifier — a typo would otherwise select executable behaviour at publish time
       and be discovered as a mysterious verification failure against the live publisher. */
    const declaredTransport = String(source.transport || 'https').toLowerCase();
    if (!NEWS_TRANSPORTS.has(declaredTransport)) {
      problems.push(`${key}: unknown transport "${declaredTransport}"; declare one of ${[...NEWS_TRANSPORTS].join(', ')}`);
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

/* The empty-current verdict ORDER, pure so the fixtures exercise the same rule the run applies: any
   verification or integrity problem FAILS first; a fault-empty FAILS; only a clean aging-empty WARNS. */
function emptyCurrentVerdict(problems, newsCurrency) {
  if (problems.length || newsCurrency.mode === 'fault') return 'FAIL';
  return newsCurrency.mode === 'aging-empty' ? 'WARN' : 'PASS';
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

/* The UNFILTERED expected set of proofs. This exists because of the census lesson: a completeness
   check over a results array cannot see an entry that was never appended, so a proof that did not
   run is ABSENT rather than failed and pushes no problem. That is why `kept`/`dropped` had to be
   published for the forecast population rather than inferred from survivors, and it is why the
   roster here is written out rather than derived from what ran. Drift is caught in both directions:
   a roster entry with no result means the run did not establish it, and a result with no roster
   entry means this list went stale. */
const PROOF_ROSTER = [
  'aggregator, shortener and press-release mill rejected before fetch',
  'X source redirects are refused while independent reporting may mention X',
  'an apostrophe in a headline or publisher is not read as a delimiter',
  "a neighbouring post's <time> cannot supply this article's publication date",
  'academic publication dates require an explicit calendar day',
  'the reviewed host map fills a missing publisher, never overrides a declared one, and never invents',
  'inline-spacing tidy cannot change any quote comparison',
  'reuse ceiling holds against an over-ceiling ledger',
  'publisher bot protection is a dated last-good warning only for an unchanged, durably verified record',
  'an empty cited channel is a warning only when window aging explains it',
  'fabricated / non-existent article fails closed',
  'real authoritative article verifies end to end',
  'quote drift fails closed',
  'headline drift fails closed',
];

/* The capability each proof licenses the PASS line to claim. The verdict sentence is BUILT from
   this, so a proof that did not run cannot contribute its clause — the old line named four
   capabilities unconditionally, and on a feed outage three of the six proofs are skipped, so it
   claimed "proven live" and "drift" on a run that established neither. A sentence assembled from
   results cannot make that mistake; one written by hand always can. */
const PROOF_CAPABILITY = {
  'aggregator, shortener and press-release mill rejected before fetch': 'aggregators',
  'X source redirects are refused while independent reporting may mention X': 'X source isolation',
  'an apostrophe in a headline or publisher is not read as a delimiter': 'metadata truncation',
  "a neighbouring post's <time> cannot supply this article's publication date": 'date provenance',
  'academic publication dates require an explicit calendar day': 'academic date precision',
  'the reviewed host map fills a missing publisher, never overrides a declared one, and never invents': 'publisher attribution',
  'inline-spacing tidy cannot change any quote comparison': 'quote fidelity',
  'reuse ceiling holds against an over-ceiling ledger': 'reuse ceiling',
  'publisher bot protection is a dated last-good warning only for an unchanged, durably verified record': 'access-challenge last-good bounds',
  'an empty cited channel is a warning only when window aging explains it': 'empty-current bounds',
  'fabricated / non-existent article fails closed': 'fabrication',
  'real authoritative article verifies end to end': 'live retrieval',
  'quote drift fails closed': 'quote drift',
  'headline drift fails closed': 'headline drift',
};

function academicDateProofs() {
  // Historical fixture inputs must survive retirement of the active source rows.
  const url = "https://www.nature.com/articles/d41586-026-02451-2";
  const originalQuotes = [
    "The world’s data centres used about 485 terawatt-hours of electricity last year, similar to that used by Germany, and the International Energy Agency expects that to double by 2030.",
    "Five technology companies — Amazon, Alphabet, Microsoft, Meta and Oracle — are expected to spend a total of more than US$600 billion on AI infrastructure this year; a decade ago, the same five companies spent less than $40 billion.",
  ];
  const page = (head, body = '<p>Undated fixture text.</p>') =>
    `<html><head><title>Date fixture</title>${head}</head><body><article>${body}</article></body></html>`;
  const meta = (name, value) => `<meta name="${name}" content="${value}">`;
  const precise = '2026-08-11T00:00:00.000Z';
  const coarseTag = meta('citation_publication_date', '2026/08');
  // Reduced from the captured Nature response: issue month, precise online/DC date, and a nested rail.
  const captured = page(coarseTag + meta('citation_online_date', '2026/08/11')
    + meta('dc.date', '2026-08-11')
    + '<script type="application/ld+json">{"@type":"WebPage","mainEntity":'
    + '{"@type":"NewsArticle","headline":"Date fixture","datePublished":"2026-08-11T00:00:00Z"}}</script>',
    '<header><time datetime="2026-08-11">11 August 2026</time></header>'
    + '<p class="article__teaser">Only the opening teaser is available.</p>'
    + '<div data-test="entitlement-box-main">Access through your institution</div>'
    + '<aside><time datetime="2026-09-10">Related one</time>'
    + '<time datetime="2026-09-08">Related two</time></aside>');
  const cases = [
    { name: 'captured issue month yields to precise online date', html: captured, expected: precise },
    { name: 'removing captured coarse tag preserves the date', html: captured.replace(coarseTag, ''), expected: precise },
    { name: 'precise publication date keeps precedence over online date',
      html: page(meta('citation_publication_date', '2026/08/10') + meta('citation_online_date', '2026/08/11')),
      expected: '2026-08-10T00:00:00.000Z' },
    { name: 'primary timestamp keeps precedence and timezone',
      html: page(meta('article:published_time', '2026-08-11T01:00:00+10:00') + meta('citation_online_date', '2026/08/11')),
      expected: '2026-08-10T15:00:00.000Z' },
    { name: 'coarse publication and online values yield to precise DC date',
      html: page(coarseTag + meta('citation_online_date', '2026') + meta('DC.date', '2026-08-11')),
      expected: precise },
    { name: 'coarse DC date yields to precise dcterms date',
      html: page(meta('DC.date', 'August 2026') + meta('dcterms.date', '11 August 2026')),
      expected: precise },
    { name: 'modified date cannot replace an unknown publication day',
      html: page(coarseTag + meta('article:modified_time', '2026-09-13T00:00:00Z')), expected: '' },
    { name: 'disagreeing rail dates cannot replace an unknown publication day',
      html: page(coarseTag, '<aside><time datetime="2026-09-10">Related one</time>'
        + '<time datetime="2026-09-08">Related two</time></aside><p>Undated fixture text.</p>'), expected: '' },
    { name: 'article-scoped precise time still outranks the issue month',
      html: page(coarseTag, '<time datetime="2026-08-11">11 August 2026</time><p>Article text.</p>'),
      expected: precise },
  ];
  for (const field of ['citation_publication_date', 'citation_online_date', 'DC.date', 'dcterms.date']) {
    for (const partial of ['2026', '2026/08', '2026-08', '08/2026', 'August 2026']) {
      cases.push({ name: `${field} ${partial} has no publication day`, html: page(meta(field, partial)), expected: '' });
    }
  }
  for (const full of ['2026/08/11', '2026-08-11', 'August 11, 2026', '11 August 2026']) {
    cases.push({ name: `precise academic date ${full} is preserved`,
      html: page(meta('citation_publication_date', full)), expected: precise });
  }
  const results = cases.map(test => {
    const actual = extractArticle(test.html, url).publishedAt;
    return { name: test.name, passed: actual === test.expected, detail: `actual=${JSON.stringify(actual)} expected=${JSON.stringify(test.expected)}` };
  });
  const withCoarse = extractArticle(captured, url);
  const withoutCoarse = extractArticle(captured.replace(coarseTag, ''), url);
  results.push({
    name: 'date correction neither changes preview text nor supplies missing reviewed quotes',
    passed: withCoarse.textSha256 === withoutCoarse.textSha256
      && originalQuotes.every(quote => !quotePresent(withCoarse.mainText, quote)),
    detail: 'Both historical reviewed quotes remain absent from the reduced captured teaser.',
  });
  return results;
}

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

  let refusedRedirects = 0;
  for (const host of ['x.com', 'api.x.com', 'twitter.com', 'mobile.twitter.com', 't.co', 'cdn.syndication.twimg.com']) {
    let calls = 0;
    const target = ['https:', '', host, 'synthetic-refusal'].join('/');
    const result = await fetchArticle('https://example.org/source', { requestImpl:async () => {
      calls++;
      return { ok:true, status:302, headers:{ location:target }, body:'' };
    } });
    if (!result.ok && result.finalUrl === target && calls === 1 && /rejected source/.test(result.reason))
      refusedRedirects++;
  }
  const report = await fetchArticle('https://example.org/independent-report', { requestImpl:async () => ({
    ok:true, status:200, headers:{}, body:'Independent reporting about X, Twitter and reposting.',
  }) });
  record('X source redirects are refused while independent reporting may mention X',
    refusedRedirects === 6 && report.ok && report.body.includes('Twitter'),
    `${refusedRedirects}/6 redirected hosts refused before contact; independent body text retained`);

  /* Proof 4b: an apostrophe in a headline is not a delimiter. This is a REGRESSION PROOF, pinned to
     the two live articles it was measured on. The meta-attribute pattern excluded both quote
     characters regardless of which one opened the value, so a straight apostrophe inside a
     double-quoted attribute ended the capture early and the apostrophe itself matched as the closing
     delimiter. The match SUCCEEDED, so nothing failed: it silently stored a truncated headline,
     published it to readers as the article's title, and would then have compared one truncation
     against another forever and reported "unchanged". Offline, so it always runs. */
  const APOS = String.fromCharCode(39);
  const QUOTE = String.fromCharCode(34);
  const truncationCase = `<html><head><meta property=${QUOTE}og:title${QUOTE} `
    + `content=${QUOTE}Ukraine${APOS}s one-time test used fully autonomous drones${QUOTE}>`
    + `<meta property=${QUOTE}og:site_name${QUOTE} content=${QUOTE}Shaping Europe${APOS}s digital future${QUOTE}>`
    + `</head><body><p>${'body '.repeat(120)}</p></body></html>`;
  const extractedCase = extractArticle(truncationCase, 'https://arstechnica.com/ai/2026/06/story/');
  record('an apostrophe in a headline or publisher is not read as a delimiter',
    extractedCase.headline === `Ukraine${APOS}s one-time test used fully autonomous drones`
    && extractedCase.publisher === `Shaping Europe${APOS}s digital future`,
    `headline=${JSON.stringify(extractedCase.headline)} publisher=${JSON.stringify(extractedCase.publisher)}`);

  /* Proof 4b-2: a RAIL <time> is not this article's date. REGRESSION PROOF, pinned to the page it
     was measured on. openai.com/index/responding-next-frontier-critical-cyber-capabilities carries
     no article:published_time, no og:published_time and no JSON-LD date, so the chain fell to its
     <time> fallback — which took the FIRST <time> in the document. OpenAI nests a rail of its other
     posts INSIDE <article>, so that element belonged to OpenAI's newest post. The recorded date
     tracked OpenAI's publishing schedule instead of the article: 2026-08-17 -> 2026-08-26 ->
     2026-09-01 across three runs, on a story whose URL, headline, publisher and reviewed quote
     never changed, while its own dateline said "August 7, 2026" throughout. Nothing failed loudly;
     it published a ~27-day-old article as a CITED citation inside a 14-day window and re-armed its
     own currency clock every time OpenAI posted anything.
     Both halves are asserted, because a fix that only refused the ambiguous case would evict real
     evidence: nature.com's ten <time> elements include nine rail items, and the ONE inside
     <article> is its true date, which must still be read. Offline, so it always runs. */
  const railCase = `<html><head><title>Story</title></head><body><article>`
    + `<p>OpenAI August 7, 2026 Security ${'prose '.repeat(120)}</p>`
    + `<aside><a>Newer post</a><time dateTime=${QUOTE}2026-09-01T13:00${QUOTE}>Sep 1, 2026</time>`
    + `<a>Another</a><time dateTime=${QUOTE}2026-08-26T00:00${QUOTE}>Aug 26, 2026</time>`
    + `<a>Older</a><time dateTime=${QUOTE}2026-08-17T05:30${QUOTE}>Aug 17, 2026</time></aside>`
    + `</article></body></html>`;
  const railExtracted = extractArticle(railCase, 'https://openai.com/index/story/');
  const scopedCase = `<html><head><title>Story</title></head><body>`
    + `<article><time datetime=${QUOTE}2026-08-11${QUOTE}>Aug 11, 2026</time>`
    + `<p>${'prose '.repeat(120)}</p></article>`
    + `<aside><time datetime=${QUOTE}2026-09-02${QUOTE}>Sep 2, 2026</time>`
    + `<time datetime=${QUOTE}2026-08-27${QUOTE}>Aug 27, 2026</time></aside>`
    + `</body></html>`;
  const scopedExtracted = extractArticle(scopedCase, 'https://www.nature.com/articles/story');
  record("a neighbouring post's <time> cannot supply this article's publication date",
    railExtracted.publishedAt.slice(0, 10) === '2026-08-07'
    && scopedExtracted.publishedAt.slice(0, 10) === '2026-08-11',
    `rail=${JSON.stringify(railExtracted.publishedAt)} (must be the 2026-08-07 dateline, not the `
    + `2026-09-01 rail item); scoped=${JSON.stringify(scopedExtracted.publishedAt)} (must still read `
    + `the 2026-08-11 date inside <article>)`);

  const academicDates = academicDateProofs();
  record('academic publication dates require an explicit calendar day',
    academicDates.every(result => result.passed),
    `${academicDates.filter(result => result.passed).length}/${academicDates.length} offline controls`
      + academicDates.filter(result => !result.passed).map(result => `; ${result.name}: ${result.detail}`).join(''));

  /* Proof 4c: the reviewed host->publisher map ADDS REACH WITHOUT INVENTING. Measured 2026-08-27:
     anthropic.com and research.google serve a headline, a date and full body text but declare no
     publisher through any tag or JSON-LD field, so the whole chain returned '' and the extractor
     failed closed — the pipeline could not cite either lab for a missing metadata tag rather than
     any editorial reason. The map is the fix, and these three assertions are what keep it honest:
     it must fill the gap, it must NEVER override a page that names itself, and an unmapped host
     must still yield '' so nothing is ever attributed to a publisher that did not publish it.
     The override case is the one that matters most — a map consulted too early would silently
     restamp real publishers and quietly rewrite already-captured evidence. Offline, so it always
     runs. */
  const bare = `<html><head><meta property=${QUOTE}og:title${QUOTE} content=${QUOTE}Our position on `
    + `open-weights models${QUOTE}></head><body><p>${'body '.repeat(120)}</p></body></html>`;
  const mapped = extractArticle(bare, 'https://www.anthropic.com/news/position-open-weights-models');
  /* The unmapped case deliberately reuses an ALREADY-DECLARED host rather than a synthetic one.
     A made-up hostname here reads as an undeclared egress target to verify-deploy-surface.js — which
     caught exactly that and refused the run — and inventing a domain to prove we do not invent
     publishers would be its own small dishonesty. arstechnica.com is declared, is real, and is
     absent from REVIEWED_HOST_PUBLISHERS, which is precisely the condition under test. Nothing here
     is fetched; these are offline string inputs to the extractor. */
  const unmapped = extractArticle(bare, 'https://arstechnica.com/ai/2026/08/story/');
  const declares = `<html><head><meta property=${QUOTE}og:title${QUOTE} content=${QUOTE}Story${QUOTE}>`
    + `<meta property=${QUOTE}og:site_name${QUOTE} content=${QUOTE}Anthropic Newsroom${QUOTE}>`
    + `</head><body><p>${'body '.repeat(120)}</p></body></html>`;
  const declared = extractArticle(declares, 'https://www.anthropic.com/news/other');
  record('the reviewed host map fills a missing publisher, never overrides a declared one, and never invents',
    mapped.publisher === 'Anthropic'
    && unmapped.publisher === ''
    && declared.publisher === 'Anthropic Newsroom',
    `mapped=${JSON.stringify(mapped.publisher)} unmapped=${JSON.stringify(unmapped.publisher)} `
    + `declared=${JSON.stringify(declared.publisher)}`);

  /* Proof 4d: tidying inline-markup spacing is MATCH-INVARIANT. The extractor leaves "( AMIE )" and
     "interpretability ," where a publisher wrote neither, and that artifact reached a live published
     quote. extractMainText() now removes it — but a change to shared extraction is exactly the kind
     that can silently break every recorded quote at once, so the invariance is PROVEN here rather
     than argued in a comment: a quote captured WITH the old artifact must still match text cleaned
     the new way, and vice versa, because normalizeForQuote() collapses the same whitespace on both
     sides before comparing. If someone later widens tidyInlineSpacing() beyond punctuation-adjacent
     whitespace, this proof fails and stops the run. Offline, so it always runs. */
  const artefactText = `In early work, the Explorer ( AMIE ), known as mechanistic interpretability , `
    + 'aims to map the key features.';
  const cleanedText = 'In early work, the Explorer (AMIE), known as mechanistic interpretability, '
    + 'aims to map the key features.';
  record('inline-spacing tidy cannot change any quote comparison',
    quotePresent(cleanedText, artefactText) && quotePresent(artefactText, cleanedText)
    && !quotePresent(cleanedText, 'the Explorer (AMIA), known as mechanistic interpretability'),
    `artefact<->clean match both ways; a genuinely different word still fails`);

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

  /* Proof: access-challenge last-good (owner-approved 2026-09-24). Offline: only the HTTP exchange and
     the mirror are fixtures; classification, record identity and date arithmetic are production code. */
  const lgKey = 'proof-last-good';
  const lgUrl = 'https://example.org/2026/09/verified-story';
  const lgSource = {
    url: lgUrl, resolvedUrl: lgUrl, publisher: 'Example Publisher', publisherHost: 'example.org',
    headline: 'A verified story', publishedAt: '2026-09-01T00:00:00.000Z', publishedAtSource: 'page',
    retrievedAt: '2026-09-02', sourceQuality: 'primary-news-organization',
    quote: 'A sufficiently long verbatim supporting sentence used only for the last-good proof.',
    textSha256: sha256('last-good'),
  };
  const lgMappings = { '2027-1': { source: lgKey, reuseFamily: 'proof', evidenceType: 'leading-indicator',
    rationale: 'last-good proof', reviewedAt: '2026-09-02', lastVerifiedAt: '2026-09-02' } };
  const lgCommit = 'a'.repeat(40);
  const lgVerifications = [{ commit: lgCommit, verifiedOn: '2026-09-22', basis: 'fixture' }];
  const lgMirror = ({ sources = { [lgKey]: lgSource }, mappings = lgMappings, head = null, contains = true,
    committedOn = '2026-09-22' } = {}) => ({
    head: () => 'b'.repeat(40), committedOn: () => committedOn, contains: () => contains,
    news: commit => (commit === lgCommit ? { sources, mappings } : head || { sources, mappings }),
  });
  const answer = (status, headers = {}) => async () => ({ ok: true, status, headers, body: '' });
  const waf = answer(405, { 'x-amzn-waf-action': 'captcha' });
  const within = Date.parse('2026-09-24T01:00:00Z');
  let akamaiCalls = 0;
  const akamai = async () => { akamaiCalls++; return { ok: true, status: 302, headers: { location: '/apology_objects/abuse-detection-apology.html' }, body: '' }; };
  const lgRun = (overrides = {}) => verifyNewsSourceAllowingLastGood(lgKey, overrides.source || lgSource, {
    mappings: overrides.mappings || lgMappings, mirror: 'mirror' in overrides ? overrides.mirror : lgMirror(),
    now: overrides.now || within, verifications: lgVerifications, requestImpl: overrides.request || waf,
    browserTransport: overrides.browserTransport,
  });
  const expectWarn = (result, now) => result.problems.length === 0 && result.lastGood
    && result.lastGood.status === 'last-good' && result.lastGood.label === "Couldn't recheck today"
    && result.lastGood.reason === 'publisher bot protection' && result.lastGood.lastVerifiedAt === '2026-09-22'
    && result.lastGood.lastCheckedAt === new Date(now).toISOString() && result.lastGood.retainedUntil === '2026-10-06';
  const expectFail = result => result.problems.length > 0 && !result.lastGood;
  const changedQuote = { ...lgSource, quote: 'A different verbatim supporting sentence that was never verified by the released gate.' };
  const shortQuote = { ...lgSource, quote: 'Too short to be probative.' };
  const movedUrl = 'https://example.org/2026/09/moved-story';
  const lgCases = [
    ['WAF captcha, unchanged, within 14 days', expectWarn(await lgRun(), within)],
    ['WAF challenge action', expectWarn(await lgRun({ request: answer(202, { 'x-amzn-waf-action': 'challenge' }) }), within)],
    ['day 14 (end of 6 Oct UTC)', expectWarn(await lgRun({ now: Date.parse('2026-10-06T23:59:59Z') }), Date.parse('2026-10-06T23:59:59Z'))],
    ['Akamai apology redirect, not followed', expectWarn(await lgRun({ request: akamai }), within) && akamaiCalls === 1],
    ['Cloudflare cf-mitigated challenge', expectWarn(await lgRun({ request: answer(403, { 'cf-mitigated': 'challenge' }) }), within)],
    ['day 15', expectFail(await lgRun({ now: Date.parse('2026-10-07T00:00:00Z') }))],
    ['plain 405', expectFail(await lgRun({ request: answer(405) }))],
    ['plain 404', expectFail(await lgRun({ request: answer(404) }))],
    ['plain 410', expectFail(await lgRun({ request: answer(410) }))],
    ['plain 503', expectFail(await lgRun({ request: answer(503) }))],
    ['timeout', expectFail(await lgRun({ request: async () => ({ ok: false, reason: 'timeout after 20000ms', code: 'ETIMEDOUT' }) }))],
    ['unrecognised WAF action', expectFail(await lgRun({ request: answer(403, { 'x-amzn-waf-action': 'block' }) }))],
    ['apology redirect to another site', expectFail(await lgRun({ request: async url => (url === lgUrl
      ? { ok: true, status: 302, headers: { location: 'https://example-not-reviewed.test/apology_objects/abuse-detection-apology.html' }, body: '' }
      : { ok: true, status: 404, headers: {}, body: '' }) }))],
    ['challenge on a changed quote', expectFail(await lgRun({ source: changedQuote }))],
    ['challenge on a changed URL', expectFail(await lgRun({ source: { ...lgSource, url: movedUrl, resolvedUrl: movedUrl } }))],
    ['challenge on a changed mapping', expectFail(await lgRun({ mappings: { '2027-1': { ...lgMappings['2027-1'], rationale: 'edited' } } }))],
    ['challenge on a never-verified item', expectFail(await lgRun({ mirror: lgMirror({ sources: {}, mappings: {} }) }))],
    ['changed in the published head after verification', expectFail(await lgRun({ mirror: lgMirror({ head: { sources: { [lgKey]: changedQuote }, mappings: lgMappings } }) }))],
    ['record with another problem', expectFail(await lgRun({ source: shortQuote, mirror: lgMirror({ sources: { [lgKey]: shortQuote } }) }))],
    ['mirror unavailable', expectFail(await lgRun({ mirror: null }))],
    ['verification commit not published', expectFail(await lgRun({ mirror: lgMirror({ contains: false }) }))],
    ['commit day differs from recorded day', expectFail(await lgRun({ mirror: lgMirror({ committedOn: '2026-09-21' }) }))],
    ['verification dated in the future', expectFail(await lgRun({ now: Date.parse('2026-09-21T12:00:00Z') }))],
    ['browser transport', expectFail(await lgRun({ source: { ...lgSource, transport: 'browser' }, browserTransport: async () => ({
      ok: false, reason: 'HTTP 405', challenge: { vendor: 'aws-waf', status: 405, marker: 'x-amzn-waf-action: captcha' } }) }))],
  ];
  const lgFailed = lgCases.filter(([, passed]) => !passed).map(([name]) => name);
  record('publisher bot protection is a dated last-good warning only for an unchanged, durably verified record',
    lgFailed.length === 0,
    lgFailed.length ? `unexpected: ${lgFailed.join('; ')}` : `${lgCases.length}/${lgCases.length} controls (5 WARN, ${lgCases.length - 5} FAIL)`);

  /* Proof: honest empty-current mode (owner-approved 2026-09-26). Offline and synthetic; the classifier,
     the verdict order and the public label are the production code (the label is read out of app.js). */
  const ecIds = new Set(['2027-1', '2027-2', '2027-3']);
  const ecMappings = { '2027-1': { source: 'aged-a' }, '2027-2': { source: 'aged-b' } };
  const ecRow = (source, publishedAt, ageDays) => ({ id: `news:${source}`, channel: 'context', evidenceOwner: 'news', publishedAt, ageDays });
  const ecBase = () => ({
    updated: '2026-10-01T00:00:00.000Z', sourceFresh: true, embeds: {},
    coverage: { complete: true, cited: 0, context: 2, uncited: 1, searches: 0, total: 3, kept: 3, dropped: 0, byEvidenceOwner: { news: 0 } },
    context: { windowDays: 14, count: 2, items: {
      '2027-1': ecRow('aged-a', '2026-09-10T08:00:00.000Z', 21), '2027-2': ecRow('aged-b', '2026-09-15T00:00:00.000Z', 16) } },
    uncited: { windowDays: 14, count: 1, items: { '2027-3': { id: '2027-3' } } },
  });
  const ec = (mutate = () => {}, mappings = ecMappings) => {
    const fixture = ecBase(); mutate(fixture);
    return classifyNewsCurrency(fixture, { mappings, expectedIds: ecIds });
  };
  const toUncited = (s, id) => { delete s.context.items[id]; s.context.count--; s.coverage.context--;
    s.uncited.items[id] = { id }; s.uncited.count++; s.coverage.uncited++; };
  const ecFault = result => result.mode === 'fault' && result.problems.length > 0;
  const quietSource = (fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8')
    .match(/function quietNewsLabel\(data, format = recorded\)\{[\s\S]*?\n\}/) || [])[0];
  // eslint-disable-next-line no-new-func
  const quietLabel = quietSource ? new Function('recorded', `${quietSource}; return quietNewsLabel;`)(value => value) : null;
  const warm = ec();
  const ecCases = [
    ['aging-empty is a WARNING with its label', warm.mode === 'aging-empty' && warm.aged === 2
      && warm.lastLinkedNewsAt === '2026-09-15T00:00:00.000Z' && emptyCurrentVerdict([], warm) === 'WARN'
      && !!quietLabel && quietLabel(ecBase()) === 'No news from the last 14 days is linked yet — last linked news: 2026-09-15T00:00:00.000Z.'],
    ['normal cited path unchanged, no label', (() => { const cited = ec(s => { s.embeds = { '2027-1': {} }; });
      return cited.mode === 'cited' && !cited.problems.length && emptyCurrentVerdict([], cited) === 'PASS'
        && !!quietLabel && quietLabel({ ...ecBase(), embeds: { '2027-1': {} } }) === ''; })()],
    ['verification failure on an aged-empty day', emptyCurrentVerdict(['live fetch failed'], warm) === 'FAIL'],
    ['embeds missing', ecFault(ec(s => { delete s.embeds; }))],
    ['embeds malformed', ecFault(ec(s => { s.embeds = []; }))],
    ['context partition missing', ecFault(ec(s => { delete s.context; }))],
    ['uncited partition corrupt', ecFault(ec(s => { s.uncited.items = null; }))],
    ['news tally absent', ecFault(ec(s => { delete s.coverage.byEvidenceOwner.news; }))],
    ['news tally nonzero', ecFault(ec(s => { s.coverage.byEvidenceOwner.news = 1; }))],
    ['coverage incomplete', ecFault(ec(s => { s.coverage.complete = false; }))],
    ['stale build', ecFault(ec(s => { s.sourceFresh = false; }))],
    ['search ids present', ecFault(ec(s => { s.search = { '2027-3': {} }; }))],
    ['population dropped', ecFault(ec(s => { s.coverage.dropped = 1; s.coverage.kept = 2; }))],
    ['mapping dropped to uncited', ecFault(ec(s => toUncited(s, '2027-2')))],
    ['forecast unaccounted', ecFault(ec(s => { delete s.uncited.items['2027-3']; s.uncited.count = 0; s.coverage.uncited = 0; }))],
    ['row still inside the window', ecFault(ec(s => { s.context.items['2027-2'] = ecRow('aged-b', '2026-09-28T00:00:00.000Z', 3); }))],
    ['forged age on a recent row', ecFault(ec(s => { s.context.items['2027-2'] = ecRow('aged-b', '2026-09-28T00:00:00.000Z', 16); }))],
    ['future-dated row', ecFault(ec(s => { s.context.items['2027-2'] = ecRow('aged-b', '2026-10-05T00:00:00.000Z', 16); }))],
    ['row from another source', ecFault(ec(s => { s.context.items['2027-2'] = ecRow('other', '2026-09-15T00:00:00.000Z', 16); }))],
    ['unreviewed context row', ecFault(ec(s => { delete s.uncited.items['2027-3']; s.uncited.count = 0; s.coverage.uncited = 0;
      s.context.items['2027-3'] = ecRow('unreviewed', '2026-09-01T00:00:00.000Z', 30); s.context.count = 3; s.coverage.context = 3; }))],
    ['id in both context and uncited', ecFault(ec(s => { s.uncited.items['2027-1'] = { id: '2027-1' }; s.uncited.count = 2; s.coverage.uncited = 2; }))],
    ['partition count disagrees', ecFault(ec(s => { s.context.count = 3; }))],
    ['no reviewed mapping at all', ecFault(ec(s => { toUncited(s, '2027-1'); toUncited(s, '2027-2'); }, {}))],
  ];
  const ecFailed = ecCases.filter(([, passed]) => !passed).map(([name]) => name);
  record('an empty cited channel is a warning only when window aging explains it',
    ecFailed.length === 0,
    ecFailed.length ? `unexpected: ${ecFailed.join('; ')}` : `${ecCases.length}/${ecCases.length} controls (1 WARN, 1 cited PASS, ${ecCases.length - 2} FAIL)`);

  /* Proof 2: a fabricated URL on a real publisher must fail closed ON THAT PUBLISHER'S OWN ANSWER. A bot
     challenge proves nothing about a missing article, so a challenged probe is repeated on the host that
     has just served the real proof article; it must also never qualify for last-good retention. */
  const fabricatedSource = (url, publisher, publisherHost) => ({
    url, resolvedUrl: url, publisher, publisherHost,
    headline: 'An article that was never published',
    publishedAt: '2026-01-01T00:00:00.000Z',
    publishedAtSource: 'page',
    retrievedAt: '2026-01-01',
    sourceQuality: 'primary-news-organization',
    quote: 'A fabricated sentence that no real article on this publisher has ever contained anywhere.',
    textSha256: sha256('fabricated'),
  });
  const proofMirror = defaultNewsMirror();
  const fabricated = await verifyNewsSourceAllowingLastGood('proof-fabricated', fabricatedSource(
    'https://arstechnica.com/this-article-does-not-exist-verification-probe', 'Ars Technica', 'arstechnica.com'),
  { mirror: proofMirror });
  let fabricatedChallenge = null;
  if (fabricated.fetched && fabricated.fetched.challenge) {
    fabricatedChallenge = `arstechnica.com answered with publisher bot protection (${fabricated.fetched.challenge.marker}), `
      + `which proves nothing about a missing article; ${fabricated.lastGood ? 'IT WAS RETAINED AS LAST-GOOD' : 'last-good refused it'}`;
    if (fabricated.lastGood) record('fabricated / non-existent article fails closed', false, fabricatedChallenge);
  } else {
    record('fabricated / non-existent article fails closed',
      !fabricated.lastGood && fabricated.problems.some(problem => /live fetch failed|HTTP 4\d\d/.test(problem)),
      fabricated.problems[0] || 'no problem reported');
  }

  // The live-retrieval and drift proofs need a real, currently published article.
  const discovered = await discoverProofArticle();
  if (!discovered) {
    /* The names are DERIVED from the roster, not written out. This line used to read "proofs 1 and
       3 were not exercised" — a hand-maintained inventory that named TWO when THREE entries are
       missing from `results` (live retrieval, quote drift, headline drift). It was wrong in the
       honest half of the very output that was covering for the dishonest exit code, and it had no
       way to fail. */
    const missing = PROOF_ROSTER.filter(name => !results.some(result => result.name === name));
    log('  INFRASTRUCTURE — no proof article could be retrieved from any authoritative feed;');
    log(`  ${missing.length} proof(s) were not exercised this run. This is a network fault, not an `
      + 'evidence fault.');
    missing.forEach(name => log(`    - not exercised: ${name}`));
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

  if (fabricatedChallenge && !fabricated.lastGood) {
    const probe = new URL('/this-article-does-not-exist-verification-probe', discovered.url).toString();
    const retry = await verifyNewsSourceAllowingLastGood('proof-fabricated',
      fabricatedSource(probe, reviewed.publisher, reviewed.publisherHost), { mirror: proofMirror });
    const ownAnswer = !(retry.fetched && retry.fetched.challenge) && !retry.lastGood
      && retry.problems.some(problem => /HTTP 4\d\d|headline|quote|publisher|publication date|resolved URL/.test(problem));
    record('fabricated / non-existent article fails closed', ownAnswer,
      `${fabricatedChallenge}; repeated on ${new URL(probe).hostname}, which just served the real proof article: `
      + (retry.problems[0] || 'no problem reported'));
  }

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

if (process.argv.includes('--academic-dates-only')) {
  const results = academicDateProofs();
  for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name} - ${result.detail}`);
  const passed = results.every(result => result.passed);
  console.log(`FOCUSED RESULT: ${passed ? 'PASS' : 'FAIL'} - academic dates only; no source retrieval or full NEWS verdict.`);
  process.exit(passed ? 0 : 1);
}

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
  /* EMPTY-CURRENT MODE (owner-approved 2026-09-26): an empty cited channel is a WARNING only when window
     aging alone explains it; every other empty is a FAULT. A non-empty channel is untouched. */
  const newsCurrency = classifyNewsCurrency(signals, { mappings: NEWS_MAPPINGS, expectedIds });
  if (newsCurrency.mode === 'fault') {
    problems.push(...newsCurrency.problems.map(problem => `empty cited NEWS channel is not explained by window aging: ${problem}`));
  } else if (newsCurrency.mode === 'aging-empty') {
    log(`  EMPTY-CURRENT WARNING — no news from the last ${newsCurrency.windowDays} days is linked yet; all `
      + `${newsCurrency.aged} reviewed mapping(s) aged into dated context; last linked news ${newsCurrency.lastLinkedNewsAt}`);
  }
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

  // Live re-verification of every reviewed news source before publish. A positively identified
  // publisher bot challenge on an unchanged, durably verified record is a dated last-good WARNING.
  const liveMirror = defaultNewsMirror();
  const lastGood = [];
  for (const [key, source] of Object.entries(NEWS_SOURCES)) {
    const result = await verifyNewsSourceAllowingLastGood(key, source, { mirror: liveMirror })
      .catch(error => ({ problems: [`${key}: ${error.message}`] }));
    problems.push(...result.problems);
    if (result.lastGood) {
      lastGood.push({ key, ...result.lastGood });
      log(`  LAST-GOOD WARNING ${key} — ${result.lastGood.label}: ${result.lastGood.reason} (${result.lastGood.challenge}); `
        + `last verified ${result.lastGood.lastVerifiedAt} (${result.lastGood.verifiedBy.slice(0, 12)}); `
        + `retained until ${result.lastGood.retainedUntil}; not verified this run`);
    } else if (!result.problems.length) {
      log(`  live OK ${key} — ${source.publisher} · ${String(source.publishedAt).slice(0, 10)}${result.textDrift ? ' (boilerplate text drift; headline, date and quote unchanged)' : ''}`);
    }
  }

  log('Proofs:');
  const proofs = await runProofs(log);
  for (const proof of proofs.results) {
    if (!proof.passed) problems.push(`proof failed: ${proof.name}`);
  }
  const exercised = new Set(proofs.results.map(proof => proof.name));
  const notExercised = PROOF_ROSTER.filter(name => !exercised.has(name));
  const offRoster = [...exercised].filter(name => !PROOF_ROSTER.includes(name));
  if (offRoster.length) {
    problems.push(`proof roster is stale: ${offRoster.join('; ')} ran but is not registered, so the `
      + 'run cannot be checked for completeness');
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
  const lastGoodKeys = new Set(lastGood.map(item => item.key));
  const retainedMappings = mappingIds.filter(id => lastGoodKeys.has(NEWS_MAPPINGS[id].source)).length;
  const state = !mappingIds.length
    ? 'no NEWS mapping was checked; this establishes no reviewed evidence'
    : retainedMappings
      ? `${mappingIds.length - retainedMappings} of ${mappingIds.length} reviewed news mapping(s) are live, quoted and `
        + `unchanged; ${retainedMappings} rest on ${lastGood.length} source(s) that couldn't be rechecked today `
        + '(publisher bot protection) and are LAST-GOOD WARNINGS, not verified this run'
      : `${mappingIds.length} reviewed news mapping(s) are live, quoted and unchanged`;
  /* Assembled from the proofs that actually ran and passed, never written by hand. */
  const proven = proofs.results
    .filter(proof => proof.passed && PROOF_CAPABILITY[proof.name])
    .map(proof => PROOF_CAPABILITY[proof.name]);
  if (emptyCurrentVerdict(problems, newsCurrency) === 'WARN' && !notExercised.length) {
    /* Never a PASS: nothing is cited this run. Same passed-but-inert shape, so a quiet day may publish
       with its visible label while every fault-empty case above has already failed. */
    console.log(`RESULT: PASSED BUT INERT — EMPTY-CURRENT WARNING: no news from the last ${newsCurrency.windowDays} days `
      + `is linked yet (last linked news ${newsCurrency.lastLinkedNewsAt}); ${state}; partition complete and every `
      + 'reviewed mapping accounted for as aged context.');
    lastGood.forEach(item => console.log(`  - couldn't recheck today: ${item.key} — ${item.reason} (${item.challenge}); `
      + `last verified ${item.lastVerifiedAt}; retained until ${item.retainedUntil}`));
    console.log(`  proven this run: ${proven.length ? proven.join(', ') : 'nothing'} `
      + `(${proofs.results.length}/${PROOF_ROSTER.length} proofs exercised).`);
    process.exit(70);
  }
  if (lastGood.length && !notExercised.length) {
    /* A last-good warning is never a PASS: those sources were not verified on this run. It is the same
       passed-but-inert shape as below, so publication may proceed with the warning carried visibly. */
    console.log(`RESULT: PASSED BUT INERT — ${state}:`);
    lastGood.forEach(item => console.log(`  - couldn't recheck today: ${item.key} — ${item.reason} (${item.challenge}); `
      + `last verified ${item.lastVerifiedAt}; retained until ${item.retainedUntil}`));
    console.log(`  proven this run: ${proven.length ? proven.join(', ') : 'nothing'} `
      + `(${proofs.results.length}/${PROOF_ROSTER.length} proofs exercised).`);
    process.exit(70);
  }
  if (notExercised.length) {
    /* PASSED BUT INERT, the exit-70 shape this tree already uses for the currency gate: nothing
       failed, and one or more axes verified NOTHING. A total feed outage is a network fault, not an
       evidence fault, so it must not FAIL and must not block publication — but it may not be
       reported as a full pass either, which is exactly what this gate did before. The proofs that
       could not run are named, because a count would leave the reader unable to tell which
       capability is unestablished. */
    console.log(`RESULT: PASSED BUT INERT — ${state}. `
      + `${notExercised.length} of ${PROOF_ROSTER.length} proof(s) were NOT EXERCISED on this run, `
      + 'so it does not establish them:');
    notExercised.forEach(name => console.log(`  - not exercised: ${name}`));
    if (newsCurrency.mode === 'aging-empty') {
      console.log(`  - EMPTY-CURRENT WARNING: no news from the last ${newsCurrency.windowDays} days is linked yet `
        + `(last linked news ${newsCurrency.lastLinkedNewsAt})`);
    }
    lastGood.forEach(item => console.log(`  - couldn't recheck today: ${item.key} — ${item.reason} (${item.challenge}); `
      + `last verified ${item.lastVerifiedAt}; retained until ${item.retainedUntil}`));
    console.log(`  proven this run: ${proven.length ? proven.join(', ') : 'nothing'}.`);
    /* `infrastructure` had 0 consumers tree-wide: the reason was published and read by nothing, so
       the exit code carried none of it. It is consumed HERE rather than assumed, because the roster
       gap is detected structurally and a missing proof need not be a network fault — asserting a
       cause the run did not establish would be the same defect one level down. */
    console.log(proofs.infrastructure
      ? '  Cause: no proof article could be retrieved from any authoritative feed. That is a '
        + 'network fault, not an evidence fault; the live news citations above were checked '
        + 'individually and are unaffected.'
      : '  Cause: NOT ESTABLISHED — the proofs are absent from the results and the harness did not '
        + 'report an infrastructure fault. Treat this as an instrument defect until explained.');
    process.exit(70);
  }
  console.log(`RESULT: PASS — ${state}; the verified-news path is proven live and fails closed on `
    + `${proven.join(', ')} (${proofs.results.length}/${PROOF_ROSTER.length} proofs exercised).`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
