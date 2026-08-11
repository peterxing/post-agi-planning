'use strict';

/*
 * TIER-3 VERIFIED NEWS EVIDENCE
 * =============================
 * Evidence for a prediction is chosen in a strict priority order:
 *
 *   1. a reviewed @peterxing AUTHORED status  (archive-verified corpus)
 *   2. a reviewed @peterxing REPOST           (archive-verified corpus)
 *   3. a reviewed authoritative EXTERNAL X status
 *   4. a reviewed authoritative NEWS ARTICLE  <- this file
 *
 * News is a resilience tier BENEATH the X tiers, never a replacement for them.
 * It becomes eligible for one prediction only when, after the full archive
 * pipeline has run (discovery + hydration + review), that prediction has no
 * defensible reviewed X status of any kind. A degraded or unpaid X API does
 * NOT make news eligible: archive-verified retrieval does not use the API, so
 * an API outage never blocks X evidence. News can never satisfy or bypass the
 * Peter floors or the evidence-floors.json ratchet, and an existing reviewed X
 * mapping is never swapped for a news article.
 *
 * A news URL is far easier to hallucinate than an X status ID, which has a hard
 * first-party + oEmbed author check. The verification bar here is therefore
 * HIGHER, not lower:
 *
 *   - every field is extracted FROM THE FETCHED PAGE, never from memory;
 *   - an exact verbatim supporting quote is stored and must still be present at
 *     publish time;
 *   - the resolved host after redirects must belong to the declared publisher;
 *   - aggregators, syndicators, shorteners, release mills and content farms are
 *     rejected outright;
 *   - nothing is auto-approved: a mapping exists only after manual review and is
 *     bound to the exact predictionText.
 */

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { URL } = require('url');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 6;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/* ------------------------------------------------------------------ *
 * Reviewed ledger
 * ------------------------------------------------------------------ */

/*
 * NEWS_SOURCES is deliberately EMPTY.
 *
 * Every prediction currently carries a reviewed, independently verified X
 * status, so no prediction is eligible for the news tier. Publishing a news
 * mapping while defensible X evidence exists would be a regression, and
 * inventing one to exercise the code would be fabrication. The machinery is
 * built, wired and proven by verify-news-evidence.js against real live
 * articles; the ledger fills only when a prediction genuinely has no X
 * evidence left.
 *
 * Shape of an entry, all fields captured from a live fetch at review time:
 *
 *   'unique-key': {
 *     url:            'https://www.example.org/2026/07/thing',   // reviewed input URL
 *     resolvedUrl:    'https://www.example.org/2026/07/thing',   // final URL after redirects
 *     publisher:      'Example Organisation',                    // from og:site_name / JSON-LD
 *     publisherHost:  'example.org',                             // registrable host of resolvedUrl
 *     author:         'A. Reporter',                             // byline when the page carries one
 *     headline:       'Exact headline as published',
 *     publishedAt:    '2026-07-14T09:30:00.000Z',
 *     retrievedAt:    '2026-08-03',
 *     sourceQuality:  'official-research-organization',
 *     quote:          'A verbatim sentence from the article that supports the claim.',
 *     textSha256:     '<sha-256 of the extracted main text at review time>',
 *   }
 */
const NEWS_SOURCES = {};

/*
 * NEWS_GROUPS binds reviewed sources to prediction IDs, exactly like
 * EXTERNAL_GROUPS. Each group carries the reviewed rationale, the reuse family
 * and the evidence type, and every entry is manually reviewed.
 */
const NEWS_GROUPS = [];

const NEWS_MAPPINGS = {};
for (const group of NEWS_GROUPS) {
  if (!NEWS_SOURCES[group.source]) throw new Error(`Unknown news evidence source ${group.source}`);
  for (const predictionId of group.ids) {
    if (NEWS_MAPPINGS[predictionId]) throw new Error(`Duplicate news evidence mapping for ${predictionId}`);
    NEWS_MAPPINGS[predictionId] = {
      source: group.source,
      reuseFamily: group.reuseFamily,
      evidenceType: group.evidenceType,
      rationale: group.rationale,
      reviewedAt: group.reviewedAt,
      lastVerifiedAt: group.lastVerifiedAt || group.reviewedAt,
    };
  }
}

/* Same source-quality bar already applied to external X evidence. */
const NEWS_QUALITY_CLASSES = new Set([
  'official-research-organization',
  'official-ai-lab',
  'official-company',
  'government',
  'intergovernmental-organization',
  'academic-researcher',
  'academic-research-institution',
  'peer-reviewed-journal',
  'primary-news-organization',
  'named-expert-analysis',
  'original-researcher',
]);

/*
 * Hosts that can never be primary news provenance: aggregators and syndicated
 * republishers, press-release mills, SEO/AI content farms and link shorteners.
 * Matching is on the registrable host, so subdomains are covered.
 */
const REJECTED_HOSTS = new Map([
  ['news.google.com', 'aggregator'],
  ['news.yahoo.com', 'aggregator'],
  ['finance.yahoo.com', 'aggregator'],
  ['msn.com', 'aggregator'],
  ['flipboard.com', 'aggregator'],
  ['smartnews.com', 'aggregator'],
  ['apple.news', 'aggregator'],
  ['reddit.com', 'aggregator'],
  ['news.ycombinator.com', 'aggregator'],
  ['techmeme.com', 'aggregator'],
  ['slashdot.org', 'aggregator'],
  ['digg.com', 'aggregator'],
  ['feedly.com', 'aggregator'],
  ['prnewswire.com', 'press-release mill'],
  ['businesswire.com', 'press-release mill'],
  ['globenewswire.com', 'press-release mill'],
  ['einpresswire.com', 'press-release mill'],
  ['accesswire.com', 'press-release mill'],
  ['newswire.com', 'press-release mill'],
  ['openpr.com', 'press-release mill'],
  ['prweb.com', 'press-release mill'],
  ['medium.com', 'open publishing platform'],
  ['substack.com', 'open publishing platform'],
  ['blogspot.com', 'open publishing platform'],
  ['wordpress.com', 'open publishing platform'],
  ['linkedin.com', 'open publishing platform'],
  ['t.co', 'link shortener'],
  ['bit.ly', 'link shortener'],
  ['tinyurl.com', 'link shortener'],
  ['ow.ly', 'link shortener'],
  ['buff.ly', 'link shortener'],
  ['lnkd.in', 'link shortener'],
  ['rb.gy', 'link shortener'],
  ['shorturl.at', 'link shortener'],
  ['dlvr.it', 'link shortener'],
  ['ift.tt', 'link shortener'],
  ['zerohedge.com', 'low-quality republisher'],
  ['dailymail.co.uk', 'low-quality republisher'],
  ['express.co.uk', 'low-quality republisher'],
  ['thesun.co.uk', 'low-quality republisher'],
  ['nypost.com', 'low-quality republisher'],
  ['futurism.com', 'aggregating rewrite outlet'],
  ['interestingengineering.com', 'aggregating rewrite outlet'],
  ['dailygalaxy.com', 'aggregating rewrite outlet'],
  ['scitechdaily.com', 'press-release republisher'],
  ['phys.org', 'press-release republisher'],
  ['eurekalert.org', 'press-release republisher'],
  ['sciencedaily.com', 'press-release republisher'],
  ['benzinga.com', 'content farm'],
  ['analyticsinsight.net', 'content farm'],
  ['marktechpost.com', 'content farm'],
  ['cointelegraph.com', 'content farm'],
]);

/* Structural giveaways that a host is a farm or a mirror regardless of name. */
const REJECTED_HOST_PATTERNS = [
  { pattern: /(^|\.)(amp|amp-cdn)\./i, reason: 'AMP mirror rather than the publisher original' },
  { pattern: /(^|\.)(webcache|cache)\./i, reason: 'cache mirror rather than the publisher original' },
  { pattern: /(^|\.)translate\./i, reason: 'translation proxy rather than the publisher original' },
  { pattern: /(^|\.)(m|mobile)\.facebook\.com$/i, reason: 'social platform, not a publisher' },
];

const REJECTED_URL_PATTERNS = [
  { pattern: /\/amp(\/|$|\.html)/i, reason: 'AMP rendition rather than the canonical article' },
  { pattern: /^https?:\/\/[^/]*\/?$/i, reason: 'site root rather than a specific article' },
];

/* ------------------------------------------------------------------ *
 * URL and host handling
 * ------------------------------------------------------------------ */

function registrableHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  // Handle the common two-part public suffixes used by news publishers.
  const twoPartSuffix = /^(co|com|org|net|gov|ac|edu|or|ne)\.[a-z]{2}$/;
  const lastTwo = parts.slice(-2).join('.');
  if (twoPartSuffix.test(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}

/*
 * Query parameters that are session, tracking or consent noise. They must be
 * stripped before a resolved URL is recorded, otherwise a publisher that
 * appends a per-request code (Nature appends ?error=cookies_not_supported&code=…)
 * would look like it had "drifted" on every single verification run.
 */
const VOLATILE_QUERY_PARAMS = [
  /^utm_/i, /^fbclid$/i, /^gclid$/i, /^mc_(cid|eid)$/i, /^igsh$/i, /^ref$/i, /^ref_src$/i,
  /^referrer$/i, /^source$/i, /^cmpid$/i, /^smid$/i, /^partner$/i, /^sh$/i, /^s$/i,
  /^error$/i, /^code$/i, /^token$/i, /^session/i, /^_ga$/i, /^spm$/i, /^at_/i,
];

function normalizeUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return String(url || '');
  }
  const keep = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    if (!VOLATILE_QUERY_PARAMS.some(pattern => pattern.test(key))) keep.push([key, value]);
  }
  parsed.search = '';
  for (const [key, value] of keep) parsed.searchParams.append(key, value);
  parsed.hash = '';
  return parsed.toString();
}

/* Prefer the publisher's own canonical URL when it points at the same host. */
function canonicalUrl(html, finalUrl) {
  const match = html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]*?href\s*=\s*["']([^"']+)["']/i)
    || html.match(/<link[^>]+href\s*=\s*["']([^"']+)["'][^>]*?rel\s*=\s*["']canonical["']/i);
  if (!match) return normalizeUrl(finalUrl);
  let candidate;
  try {
    candidate = new URL(collapse(match[1]), finalUrl).toString();
  } catch {
    return normalizeUrl(finalUrl);
  }
  const sameHost = registrableHost(new URL(candidate).hostname) === registrableHost(new URL(finalUrl).hostname);
  return normalizeUrl(sameHost ? candidate : finalUrl);
}

function classifyHost(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'unparsable URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: `unsupported protocol ${parsed.protocol}` };
  }
  const fullHost = String(parsed.hostname || '').toLowerCase().replace(/^www\./, '');
  const host = registrableHost(parsed.hostname);
  // Match the exact hostname, the registrable domain, and any parent suffix, so
  // news.google.com and finance.yahoo.com are caught as well as google.com.
  for (const candidate of [fullHost, host]) {
    if (REJECTED_HOSTS.has(candidate)) {
      return { ok: false, reason: `${candidate} is a ${REJECTED_HOSTS.get(candidate)}`, host };
    }
  }
  for (const [rejected, reason] of REJECTED_HOSTS) {
    if (fullHost === rejected || fullHost.endsWith(`.${rejected}`)) {
      return { ok: false, reason: `${fullHost} is a ${reason}`, host };
    }
  }
  for (const rule of REJECTED_HOST_PATTERNS) {
    if (rule.pattern.test(parsed.hostname)) return { ok: false, reason: rule.reason, host };
  }
  for (const rule of REJECTED_URL_PATTERNS) {
    if (rule.pattern.test(url)) return { ok: false, reason: rule.reason, host };
  }
  return { ok: true, host };
}

/* ------------------------------------------------------------------ *
 * Fetching
 * ------------------------------------------------------------------ */

function requestOnce(url) {
  return new Promise(resolve => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ ok: false, reason: 'unparsable URL' });
      return;
    }
    const client = parsed.protocol === 'http:' ? http : https;
    const request = client.request(parsed, {
      method: 'GET',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'accept-encoding': 'gzip, deflate, br',
        'cache-control': 'no-cache',
      },
      timeout: FETCH_TIMEOUT_MS,
    }, response => {
      const chunks = [];
      let bytes = 0;
      let aborted = false;
      const encoding = String(response.headers['content-encoding'] || '').toLowerCase();
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_BODY_BYTES) {
          aborted = true;
          response.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        let buffer = Buffer.concat(chunks);
        try {
          if (encoding === 'gzip') buffer = zlib.gunzipSync(buffer);
          else if (encoding === 'deflate') buffer = zlib.inflateSync(buffer);
          else if (encoding === 'br') buffer = zlib.brotliDecompressSync(buffer);
        } catch {
          resolve({ ok: false, status: response.statusCode, reason: 'undecodable response body' });
          return;
        }
        resolve({
          ok: true,
          status: response.statusCode,
          headers: response.headers,
          body: buffer.toString('utf8'),
          truncated: aborted,
        });
      });
      response.on('error', error => resolve({ ok: false, reason: error.message, code: error.code }));
    });
    request.on('timeout', () => {
      request.destroy();
      resolve({ ok: false, reason: `timeout after ${FETCH_TIMEOUT_MS}ms`, code: 'ETIMEDOUT' });
    });
    /* Carry the STRUCTURED code, not just the message. A caller that needs to tell "this host
       does not exist" from "this host did not answer" was previously forced to pattern-match
       the message text, which keys the decision to the message format rather than to the
       failure. libuv codes (ENOTFOUND, EAI_AGAIN, ECONNRESET, ETIMEDOUT) are stable and
       locale-invariant; the prose around them is neither guaranteed to be. */
    request.on('error', error => resolve({ ok: false, reason: error.message, code: error.code }));
    request.end();
  });
}

/*
 * Fetch an article, following redirects manually so the FINAL resolved URL is
 * recorded rather than the input URL, and so a redirect into an aggregator or
 * shortener is caught rather than silently followed.
 */
async function fetchArticle(url) {
  const redirects = [];
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const gate = classifyHost(current);
    if (!gate.ok) {
      return { ok: false, finalUrl: current, redirects, reason: `rejected source: ${gate.reason}` };
    }
    const response = await requestOnce(current);
    if (!response.ok) return { ok: false, finalUrl: current, redirects, reason: response.reason, code: response.code };
    const status = Number(response.status);
    if (status >= 300 && status < 400 && response.headers.location) {
      const next = new URL(response.headers.location, current).toString();
      redirects.push({ from: current, to: next, status });
      current = next;
      continue;
    }
    if (status !== 200) {
      return { ok: false, status, finalUrl: current, redirects, reason: `HTTP ${status}` };
    }
    return {
      ok: true,
      status,
      finalUrl: normalizeUrl(current),
      redirects,
      body: response.body,
      truncated: response.truncated === true,
    };
  }
  return { ok: false, finalUrl: current, redirects, reason: `exceeded ${MAX_REDIRECTS} redirects` };
}

/* ------------------------------------------------------------------ *
 * Extraction — every published field comes from here, never from memory
 * ------------------------------------------------------------------ */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013',
  mdash: '\u2014', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  hellip: '\u2026', middot: '\u00b7', eacute: '\u00e9', egrave: '\u00e8', uuml: '\u00fc',
};

function decodeEntities(value) {
  return String(value == null ? '' : value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : match;
    });
}

function collapse(value) {
  return decodeEntities(value).replace(/\s+/g, ' ').trim();
}

function metaContent(html, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name|itemprop)\\s*=\\s*["']${escaped}["'][^>]*?content\\s*=\\s*["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*?(?:property|name|itemprop)\\s*=\\s*["']${escaped}["']`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && collapse(match[1])) return collapse(match[1]);
    }
  }
  return '';
}

function jsonLdBlocks(html) {
  const blocks = [];
  const pattern = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const raw = match[1].trim().replace(/^\uFEFF/, '');
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Some publishers emit multiple concatenated objects or trailing commas; skip unparsable blocks.
    }
  }
  const flattened = [];
  const walk = node => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object') return;
    flattened.push(node);
    if (node['@graph']) walk(node['@graph']);
  };
  blocks.forEach(walk);
  return flattened;
}

function jsonLdArticle(html) {
  const nodes = jsonLdBlocks(html);
  const isArticle = node => {
    const type = node['@type'];
    const types = Array.isArray(type) ? type : [type];
    return types.some(value => /article|report|newsitem|blogposting|webpage/i.test(String(value || '')));
  };
  return nodes.find(node => isArticle(node) && (node.headline || node.name)) || null;
}

function nameOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return collapse(value);
  if (Array.isArray(value)) return value.map(nameOf).filter(Boolean).join(', ');
  if (typeof value === 'object') return collapse(value.name || value['@id'] || '');
  return '';
}

function stripToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form|figure)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br|section|article)>/gi, ' \n')
    .replace(/<[^>]+>/g, ' ');
}

function extractMainText(html) {
  const bodyMatch = html.match(/<body\b[\s\S]*?<\/body>/i);
  const bodyText = collapse(stripToText(bodyMatch ? bodyMatch[0] : html));
  const candidates = [
    ...(html.match(/<article\b[\s\S]*?<\/article>/gi) || []),
    ...(html.match(/<main\b[\s\S]*?<\/main>/gi) || []),
  ].map(region => collapse(stripToText(region)));
  // Take the richest semantic region, but fall back to the full body when that
  // region is only a fragment — some publishers wrap a teaser in <article>.
  const best = candidates.sort((a, b) => b.length - a.length)[0] || '';
  return best.length >= Math.max(400, bodyText.length * 0.3) ? best : bodyText;
}

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
const RENDERED_DATE_PATTERNS = [
  new RegExp(`\\b(${MONTHS})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'gi'),
  new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS})[a-z]*\\.?\\s+(\\d{4})\\b`, 'gi'),
  /\b(\d{4})-(\d{2})-(\d{2})\b/g,
];

/*
 * Last-resort publication date read from the RENDERED page rather than metadata.
 * Only accepted when the opening of the article yields exactly one distinct
 * date, so an ambiguous page fails closed instead of guessing.
 */
function renderedPublishedDate(mainText) {
  const window = String(mainText || '').slice(0, 1200);
  const found = new Set();
  for (const pattern of RENDERED_DATE_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(window))) {
      // Parse as UTC. A bare calendar date ("Jul 24, 2026") is otherwise parsed in the
      // RUNNER'S local timezone and then serialised back through toISOString() in UTC, so
      // every date-only page shifted one day EARLIER on any host east of UTC. That silently
      // publishes a wrong publication date, which this system treats as fabrication.
      const parsed = new Date(`${match[0].replace(/,/g, '')} UTC`);
      if (!Number.isNaN(parsed.getTime())) found.add(parsed.toISOString().slice(0, 10));
    }
  }
  return found.size === 1 ? [...found][0] : '';
}

/*
 * BOT-CHALLENGE / INTERSTITIAL DETECTION.
 *
 * Some publishers (nature.com among them) intermittently answer an automated request with a
 * ~3KB "Client Challenge" shell instead of the article — and serve it with HTTP 200. Status
 * alone therefore does NOT mean "fetched". This matters far more than it looks: a challenge
 * shell contains none of the article prose, so a naive verifier concludes the supporting
 * quote has vanished and reports EVIDENCE DRIFT against a citation that is completely
 * genuine and completely unchanged.
 *
 * An infrastructure fault must never be able to evict real evidence. This classifies the two
 * apart so callers can retry and, if it persists, report UNVERIFIABLE-INFRASTRUCTURE rather
 * than accusing the source of tampering.
 */
const CHALLENGE_MARKERS_STRONG = [
  'cf-browser-verification', '__cf_chl', 'Client Challenge', 'Attention Required! | Cloudflare',
  'Checking your browser before accessing', 'DDoS protection by', 'Please verify you are a human',
];
const CHALLENGE_MARKERS_WEAK = [
  'JavaScript is disabled in your browser', 'Enable JavaScript and cookies to continue', 'Just a moment',
];
function detectBotChallenge(html, mainText) {
  const body = String(html || '');
  const prose = String(mainText || '');
  const strong = CHALLENGE_MARKERS_STRONG.find(m => body.includes(m));
  if (strong) return { challenged: true, reason: `interstitial marker "${strong}"` };
  // These phrases can legitimately appear inside a real article, so they only count as a
  // challenge when the response is also too small to BE an article.
  if (body.length < 20000) {
    const weak = CHALLENGE_MARKERS_WEAK.find(m => body.includes(m));
    if (weak) return { challenged: true, reason: `interstitial marker "${weak}" in a ${body.length}-byte response` };
    if (prose.length < 500) {
      return { challenged: true, reason: `implausibly small response (${body.length} bytes, ${prose.length} chars of prose)` };
    }
  }
  return { challenged: false, reason: '' };
}

function extractArticle(html, finalUrl) {
  const ld = jsonLdArticle(html) || {};
  const headline = metaContent(html, ['og:title', 'twitter:title'])
    || collapse(ld.headline || ld.name || '')
    || collapse((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '')
    || collapse((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '')
    // Academic publishers often expose only these. Appended LAST on purpose: a new tag
    // earlier in the chain would change already-captured headlines and trip the drift
    // check on genuine articles. This only adds reach where the chain currently returns
    // nothing, and an empty headline still fails closed.
    || metaContent(html, ['citation_title', 'dc.title', 'DC.title', 'dcterms.title']);
  const publisher = metaContent(html, ['og:site_name', 'application-name', 'publisher', 'DC.publisher'])
    || nameOf(ld.publisher)
    || nameOf(ld.sourceOrganization)
    || nameOf(ld.isPartOf)
    || '';
  const authorRaw = metaContent(html, ['article:author', 'author', 'byl', 'parsely-author', 'DC.creator'])
    || nameOf(ld.author)
    || collapse((html.match(/rel=["']author["'][^>]*>([\s\S]*?)</i) || [])[1] || '');
  // A byline is optional. Publishers frequently put a social profile URL in
  // article:author; a URL is not a byline, so drop it rather than publish it.
  const author = /^(https?:\/\/|@|www\.)/i.test(authorRaw) || authorRaw.length > 120 ? '' : authorRaw;
  const publishedRaw = metaContent(html, [
    'article:published_time', 'datePublished', 'date', 'parsely-pub-date',
    'article:modified_time', 'og:published_time', 'pubdate', 'publish-date', 'DC.date.issued',
  ])
    || collapse(ld.datePublished || ld.dateCreated || '')
    || collapse((html.match(/<time[^>]+datetime\s*=\s*["']([^"']+)["']/i) || [])[1] || '')
    // Same reasoning as the headline chain: academic-publisher tags appended last so no
    // already-captured date can shift. A date that still cannot be extracted fails closed.
    || metaContent(html, ['citation_publication_date', 'citation_online_date', 'DC.date', 'dcterms.date']);
  const mainText = extractMainText(html);
  let publishedAt = '';
  if (publishedRaw) {
    // A value with no time-of-day is a bare calendar date and therefore carries no
    // timezone. new Date() would interpret it in LOCAL time and toISOString() would then
    // serialise it in UTC, recording the date one day EARLY on any host east of UTC.
    // Verified at UTC+10: '2026/06/15', 'June 15, 2026' and '15 June 2026' all shifted.
    const bareCalendarDate = !/\d:\d/.test(publishedRaw);
    const parsed = new Date(bareCalendarDate ? `${publishedRaw} UTC` : publishedRaw);
    if (!Number.isNaN(parsed.getTime())) publishedAt = parsed.toISOString();
  }
  if (!publishedAt) {
    const rendered = renderedPublishedDate(mainText);
    if (rendered) publishedAt = new Date(`${rendered}T00:00:00.000Z`).toISOString();
  }
  let host = '';
  try {
    host = registrableHost(new URL(finalUrl).hostname);
  } catch {
    host = '';
  }
  return {
    headline,
    publisher: publisher || '',
    author: author || '',
    publishedAt,
    publishedRaw,
    mainText,
    host,
    canonicalUrl: canonicalUrl(html, finalUrl),
    textSha256: sha256(mainText),
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value == null ? '' : value), 'utf8').digest('hex');
}

/*
 * Quote matching is whitespace and typography tolerant but never word tolerant:
 * the words themselves must appear verbatim and in order.
 */
function normalizeForQuote(value) {
  return decodeEntities(value)
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201c\u201d\u2033]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    /* Collapse whitespace introduced by inline markup boundaries. A sentence spanning an
       <a>, <em>, <strong> or <time> tag strips to "revealed Thursday , are", so a recorded
       quote that crosses one would stop matching the moment a publisher adds or removes a
       mid-sentence link — the prose unchanged, yet reported as quote drift. That is the
       same false-evidence-fault class as the bot challenge. This touches only whitespace
       ADJACENT TO punctuation: it can never make two different words compare equal, so it
       normalises presentation without weakening the verbatim guarantee. */
    .replace(/\s+([,.;:!?)\]])/g, '$1')
    .replace(/([(\[])\s+/g, '$1')
    .trim()
    .toLowerCase();
}

function quotePresent(mainText, quote) {
  const haystack = normalizeForQuote(mainText);
  const needle = normalizeForQuote(quote);
  return Boolean(needle) && haystack.includes(needle);
}

/* ------------------------------------------------------------------ *
 * Verification
 * ------------------------------------------------------------------ */

/*
 * Verify one reviewed news source against the live web. Returns an array of
 * problems; an empty array means the source is publishable. Every failure mode
 * is fail-closed: a missing field, a dead URL, a moved quote or a changed
 * headline all block publication rather than degrading silently.
 */
async function verifyNewsSource(key, source, options = {}) {
  const problems = [];
  const label = `news:${key}`;
  const required = ['url', 'resolvedUrl', 'publisher', 'publisherHost', 'headline', 'publishedAt', 'retrievedAt', 'sourceQuality', 'quote', 'textSha256'];
  for (const field of required) {
    if (!source || !String(source[field] || '').trim()) problems.push(`${label}: missing ${field}`);
  }
  if (problems.length) return { problems, fetched: null };

  if (!NEWS_QUALITY_CLASSES.has(source.sourceQuality)) {
    problems.push(`${label}: invalid source-quality class ${source.sourceQuality}`);
  }
  const gate = classifyHost(source.resolvedUrl);
  if (!gate.ok) problems.push(`${label}: ${gate.reason}`);
  if (gate.ok && gate.host !== registrableHost(source.publisherHost)) {
    problems.push(`${label}: resolved host ${gate.host} does not match declared publisher host ${source.publisherHost}`);
  }
  if (String(source.quote).trim().length < 40) {
    problems.push(`${label}: supporting quote is too short to be probative`);
  }

  const fetched = await fetchArticle(source.url);
  if (!fetched.ok) {
    problems.push(`${label}: live fetch failed (${fetched.reason})`);
    return { problems, fetched };
  }
  const extracted = extractArticle(fetched.body, fetched.finalUrl);
  if (extracted.canonicalUrl !== normalizeUrl(source.resolvedUrl)) {
    problems.push(`${label}: resolved URL drifted to ${extracted.canonicalUrl}`);
  }
  const finalGate = classifyHost(fetched.finalUrl);
  if (!finalGate.ok) problems.push(`${label}: redirect landed on a rejected source (${finalGate.reason})`);
  if (!extracted.headline) problems.push(`${label}: headline could not be extracted from the fetched page`);
  if (!extracted.publisher) problems.push(`${label}: publisher could not be extracted from the fetched page`);
  if (!extracted.publishedAt) problems.push(`${label}: publication date could not be extracted from the fetched page`);
  if (extracted.headline && collapse(extracted.headline) !== collapse(source.headline)) {
    problems.push(`${label}: headline changed materially since review`);
  }
  if (extracted.publishedAt && source.publishedAt
      && extracted.publishedAt.slice(0, 10) !== String(source.publishedAt).slice(0, 10)) {
    problems.push(`${label}: publication date changed since review`);
  }
  if (!quotePresent(extracted.mainText, source.quote)) {
    problems.push(`${label}: the reviewed supporting quote is no longer present in the article`);
  }
  const drifted = extracted.textSha256 !== source.textSha256;
  if (drifted && options.requireStableText) {
    problems.push(`${label}: article main text changed since review`);
  }
  return { problems, fetched, extracted, textDrift: drifted };
}

module.exports = {
  NEWS_GROUPS,
  NEWS_MAPPINGS,
  NEWS_SOURCES,
  NEWS_QUALITY_CLASSES,
  REJECTED_HOSTS,
  canonicalUrl,
  classifyHost,
  collapse,
  decodeEntities,
  detectBotChallenge,
  extractArticle,
  extractMainText,
  fetchArticle,
  normalizeForQuote,
  normalizeUrl,
  quotePresent,
  registrableHost,
  renderedPublishedDate,
  sha256,
  verifyNewsSource,
};
