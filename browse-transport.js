'use strict';

/*
 * browse-transport.js — THE BROWSER TRANSPORT.
 *
 * WHY THIS EXISTS. Discovery reached publishers through feeds and verification read them with a
 * plain HTTPS GET. Both rest on the same assumption: that a publisher will hand its article to a
 * non-browser client. Many will not. They answer an interstitial challenge, or they ship an empty
 * shell and render the article in JavaScript. Those articles could never become evidence no matter
 * how squarely they were on topic, and the gap did not look like a gap — it looked like an honest
 * "no qualifying source", which is the most expensive kind of wrong answer this tree can give.
 *
 * detectBotChallenge() already existed to catch exactly that response and refuse it. This module is
 * the other half of that finding: having named the wall, read the page the way a reader does.
 *
 * WHAT THIS CHANGES: THE TRANSPORT, AND NOTHING ELSE.
 * renderArticle() returns the SAME shape fetchArticle() returns, so it is a drop-in for the single
 * step that was failing. Every gate that decides whether an article is ADMISSIBLE — classifyHost,
 * the extraction chain, the verbatim quote, the text hash, the currency window — is imported from
 * news-evidence.js and runs identically afterwards. A channel that rendered pages AND relaxed a
 * gate would close the coverage gap by lowering the bar rather than by raising reach, which is the
 * substitution this tree has refused every time it has been offered. So the bar lives in one place
 * and this file cannot reach it.
 *
 * WHAT IT STILL REFUSES, EVEN THOUGH A BROWSER COULD GET PAST IT:
 *   - a rejected host, checked on the ENTRY url, on EVERY redirect hop and on the FINAL url. A
 *     browser follows redirects silently and would otherwise land on an aggregator with the
 *     original URL still in hand;
 *   - a challenge page. A browser is much better at satisfying one, and a satisfied challenge that
 *     yields a "verify you are human" document is still not an article. The rendered DOM is put
 *     through the same detector as a fetched body, so passing the wall is not confused with
 *     passing the gate;
 *   - a non-200 document, an unparsable URL, or a navigation that never produced a response.
 *
 * It never returns a partial page as a success: an empty or implausibly small render is a refusal
 * with a reason, never a blank field for a caller to fill in.
 */

const {
  classifyHost, detectBotChallenge, extractMainText, normalizeUrl,
} = require('./news-evidence.js');

/* The same browser channel every other Playwright entry point in this tree uses. Declared once so
   a divergence here cannot make the evidence path behave unlike the verification path. */
const BROWSER_CHANNEL = 'msedge';
const NAV_TIMEOUT_MS = 45000;
const SETTLE_TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 6;

/* A browser downloads far more than the document. None of it can become evidence — the extractor
   reads text — so images, media and fonts are refused at the network layer. This is a speed and
   politeness measure, never a content decision. */
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';

/*
 * Open one browser for a whole run. Callers that render N pages must not launch N browsers, and a
 * caller that forgets to close is a hung process, so the lifetime is handed back explicitly rather
 * than hidden in a module-level singleton.
 */
async function openBrowser(options = {}) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel: BROWSER_CHANNEL, headless: options.headless !== false });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    javaScriptEnabled: true,
    locale: 'en-US',
  });
  context.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  await context.route('**/*', route => {
    if (BLOCKED_RESOURCE_TYPES.has(route.request().resourceType())) return route.abort();
    return route.continue();
  });
  return {
    context,
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

/*
 * Reconstruct the redirect chain Playwright followed. A browser reports only the request that
 * finally succeeded, with its predecessors reachable through redirectedFrom(); without walking that
 * chain a redirect through a rejected host is invisible, because the URL the caller passed in and
 * the URL that answered can both be clean while a hop between them was not.
 *
 * request.response() is ASYNCHRONOUS. Reading .status() off the returned promise silently threw
 * inside the navigation path and turned every redirecting URL into an "error" verdict rather than a
 * judged one — a transport fault reported as a candidate defect.
 */
async function redirectChain(response) {
  const hops = [];
  let request = response.request();
  const seen = [];
  while (request) {
    seen.unshift(request);
    request = request.redirectedFrom();
  }
  for (let i = 0; i < seen.length - 1; i++) {
    const from = seen[i];
    let status = null;
    try {
      const hopResponse = await from.response();
      status = hopResponse ? hopResponse.status() : null;
    } catch {
      status = null;
    }
    hops.push({ from: from.url(), to: seen[i + 1].url(), status });
  }
  return hops;
}

/*
 * Render one article URL and return it in fetchArticle()'s shape:
 *   { ok, status, finalUrl, redirects, body, transport } | { ok:false, reason, ... }
 */
async function renderArticle(context, url) {
  const redirects = [];
  const entryGate = classifyHost(url);
  if (!entryGate.ok) {
    return { ok: false, finalUrl: url, redirects, transport: 'browser', reason: `rejected source: ${entryGate.reason}` };
  }

  const page = await context.newPage();
  try {
    let response;
    try {
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    } catch (error) {
      return {
        ok: false, finalUrl: url, redirects, transport: 'browser',
        reason: `browser navigation failed (${String(error.message || error).split('\n')[0]})`,
      };
    }
    if (!response) {
      return { ok: false, finalUrl: url, redirects, transport: 'browser', reason: 'browser navigation produced no response' };
    }

    for (const hop of await redirectChain(response)) {
      redirects.push(hop);
      const hopGate = classifyHost(hop.to);
      if (!hopGate.ok) {
        return {
          ok: false, finalUrl: hop.to, redirects, transport: 'browser',
          reason: `redirect landed on a rejected source: ${hopGate.reason}`,
        };
      }
    }
    if (redirects.length > MAX_REDIRECTS) {
      return { ok: false, finalUrl: page.url(), redirects, transport: 'browser', reason: `exceeded ${MAX_REDIRECTS} redirects` };
    }

    const status = Number(response.status());
    if (status !== 200) {
      return { ok: false, status, finalUrl: page.url(), redirects, transport: 'browser', reason: `HTTP ${status}` };
    }

    /* Let client-rendered articles finish. A page that never goes idle is not a failure — the
       document may already be complete — so the wait is best-effort and the render proceeds. */
    await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});

    const body = await page.content();
    const finalUrl = page.url();
    const finalGate = classifyHost(finalUrl);
    if (!finalGate.ok) {
      return { ok: false, finalUrl, redirects, transport: 'browser', reason: `rejected source: ${finalGate.reason}` };
    }
    if (!body || !body.trim()) {
      return { ok: false, status, finalUrl, redirects, transport: 'browser', reason: 'browser returned an empty document' };
    }

    /* THE WALL AND THE GATE ARE DIFFERENT THINGS. A browser is far better at satisfying a bot
       challenge than a plain GET is, and the document it gets back may still be the challenge.
       Running the rendered DOM through the SAME detector a fetched body goes through is what keeps
       "got past the wall" from being read as "got the article". */
    const challenge = detectBotChallenge(body, extractMainText(body));
    if (challenge.challenged) {
      return { ok: false, status, finalUrl, redirects, transport: 'browser', reason: `bot challenge: ${challenge.reason}` };
    }

    return {
      ok: true,
      status,
      finalUrl: normalizeUrl(finalUrl),
      redirects,
      body,
      truncated: false,
      transport: 'browser',
    };
  } finally {
    await page.close().catch(() => {});
  }
}

/*
 * A transport in fetchArticle()'s signature, bound to one open browser. This is what makes the
 * browser usable by verifyNewsSource() without that function learning anything about browsers:
 * it calls transport(url) and every gate after it is unchanged.
 */
function createTransport(context) {
  const transport = url => renderArticle(context, url);
  transport.transportName = 'browser';
  return transport;
}

/*
 * Convenience for the common case: open a browser, do work with a bound transport, always close.
 */
async function withBrowserTransport(fn, options = {}) {
  const browser = await openBrowser(options);
  try {
    return await fn(createTransport(browser.context), browser.context);
  } finally {
    await browser.close();
  }
}

module.exports = {
  BROWSER_CHANNEL,
  createTransport,
  openBrowser,
  renderArticle,
  withBrowserTransport,
};
