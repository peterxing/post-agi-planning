#!/usr/bin/env node
'use strict';

/*
 * verify-currency.js — proves the additive currency layer end to end.
 *
 * The currency layer sits ALONGSIDE the reviewed X evidence, never in place of it. Every
 * prediction keeps exactly one reviewed direct X status; a currency link is an optional
 * second, newer, independently-verified reference. So this verifier has two jobs:
 *
 *   1. Prove every currency source is still genuinely what we said it was, live, right now.
 *   2. Prove the currency layer has not disturbed anything it is forbidden to touch —
 *      the X mappings, the Peter floors, the ratchet, or the prediction texts.
 *
 * It fails closed. A source that cannot be fetched, whose headline has been rewritten, whose
 * supporting quote has vanished, or which is older than the evidence it claims to refresh,
 * blocks publication rather than degrading quietly.
 *
 * Run: npm run verify:currency   (add --offline to skip live fetches in a no-network env)
 */

/* Claim the tree BEFORE loading anything else or reading any protected file, so this
   verifier can never certify a half-applied state written by a concurrent actor. A live
   holder yields exit 75 DEFERRED — the same non-failure status an infrastructure fault
   produces, and equally not an evidence fault. */
require('./pipeline-lock').guard('verify-currency');

const fs = require('fs');
const path = require('path');
const { fetchArticle, extractArticle, quotePresent, registrableHost, detectBotChallenge, normalizeForQuote } = require('./news-evidence');

const OFFLINE = process.argv.includes('--offline');
/* Must read the SAME environment variable as refresh-signals.js. If the writer demoted at one
   ceiling and the verifier judged at another, the two would disagree about what is publishable
   and the consistency assertions below would fire on a correct tree. */
const MAX_AGE_DAYS = Number(process.env.CURRENCY_MAX_AGE_DAYS || 60);
/* Refresh a reference BEFORE it expires, not after. Re-reviewing at 45 days means the
   replacement is sourced while the existing link is still valid, so a prediction never passes
   through a window with no current reference at all. */
const REFRESH_AT_DAYS = Number(process.env.CURRENCY_REFRESH_AT_DAYS || 45);
const REUSE_CEILING = 3;
const EXCLUDED_HOSTS = new Set(['arxiv.org', 'biorxiv.org', 'medrxiv.org', 'ssrn.com', 'researchgate.net']);
/* Exit 75 = DEFERRED, the same non-failure "did not publish, changed nothing" status the
   pipeline interlock already uses. An infrastructure fault blocks publication WITHOUT ever
   being recorded as an evidence-integrity event. */
/* EXIT 76 = INSTRUMENT. A crash is not an evidence fault and it is not a deferral. The old
   handler was `main().catch(err => { console.error(err); process.exit(1); })`, which is both
   halves of the defect this file keeps finding: it exits 1, the EVIDENCE code, so an
   instrument failure is indistinguishable by status from a real integrity finding — and
   because `problems`/`notes` are buffered and flushed at the END of main(), it discarded
   EVERY measurement taken before the throw. Measured on a fixture with an unparseable
   publishedAt: the age pin correctly detected and reported the bad date, then a later line
   threw, and the entire run emitted 12 lines of stack trace and NOTHING ELSE. A correct
   finding was made and destroyed by the reporting path. Remedy differs from every other
   code here — not "fix the evidence", not "re-run later", but "fix the instrument" — so by
   the remedy criterion it gets its own status, and the accumulated findings are flushed
   first because a run that measured something must never report as though it measured
   nothing. */
const EXIT_INSTRUMENT = 76;
const EXIT_INFRASTRUCTURE = 75;
/* Exit 70 = PASSED BUT INERT. Every check below can be true over an empty input set, and a
   check over an empty set reports the same green as a check that passed. Yesterday those
   checks were taught to ANNOUNCE their inertness — but the announcement goes to stdout while
   publish-github.ps1 decides on $LASTEXITCODE alone, so to the caller an inert gate and a
   verified gate were the same byte. That is the sentence retired one level down, still live
   one level up: the fix landed in a channel the consumer does not read.

   70 is deliberately NOT a failure. An entirely demoted currency layer is a legitimate,
   truthful state, and blocking publication because an optional layer aged out is the exact
   defect this file avoids elsewhere. It proceeds — it just cannot be reported as verified. */
const EXIT_INERT = 70;
const infrastructure = [];
const inertAxes = [];

/*
 * Fetch an article, distinguishing "the source is protecting itself from bots" from "the
 * evidence changed" — and, since those were once the only two options, from a third case the
 * original code could not express: "the article is not there any more".
 *
 * Every thrown error collapsed into kind 'network' and every bad status into kind 'http'. The
 * caller then filed the entire bucket under INFRASTRUCTURE, printed "This is NOT evidence
 * drift and no citation should be dropped for it", and deferred the publish. For a bot
 * challenge, a timeout, a 429 or a 5xx that is exactly right. For a 404, a 410 or a host that
 * does not resolve it is false in the one direction that matters: the article is GONE. That
 * is a fact about the evidence, not about the network, and the instruction attached to it
 * told a reader not to drop a citation that no longer exists. Over a 60-day ceiling a deleted
 * news article is the ordinary case, not an exotic one, so this excuse was on a timer.
 *
 * A terminal failure also stops retrying. Retrying cannot make an article exist.
 *
 * 401, 403 and 429 stay INFRASTRUCTURE deliberately. A paywall, a bot block and a removal are
 * indistinguishable from outside, so they must not be promoted to an evidence fault on a
 * guess — the fail-closed direction there is to defer, not to accuse.
 */
const GONE_STATUS = new Set([404, 410]);
async function fetchArticleVerified(url, attempts = 4) {
  let last = null;
  for (let i = 1; i <= attempts; i++) {
    let res;
    try {
      res = await fetchArticle(url);
    } catch (err) {
      /* ENOTFOUND is NXDOMAIN — the host itself does not exist. EAI_AGAIN is a DNS server
         that did not answer, which is transient and must NOT be treated as terminal. */
      const code = (err && err.cause && err.cause.code) || (err && err.code) || '';
      if (code === 'ENOTFOUND') {
        return { ok: false, failure: { kind: 'dns', terminal: true, detail: `host does not resolve (${code})` }, attempts: i };
      }
      last = { kind: 'network', detail: err.message };
      await new Promise(r => setTimeout(r, 700 * i));
      continue;
    }
    if (!res.ok) {
      /* fetchArticle does NOT throw on a DNS failure — it RETURNS {ok:false, status:undefined,
         reason:'getaddrinfo ENOTFOUND <host>'}. The first version of this classifier looked for
         ENOTFOUND in a thrown error's cause.code, so it never fired, and the non-existent host
         fell through to the generic branch and was excused as infrastructure. It would also have
         printed the detail as "HTTP undefined" — a status that never existed, asserted in a line
         a human reads. Both were written against an assumed interface; these branches are
         written against the measured one. */
      const reason = res.reason || (res.status ? `HTTP ${res.status}` : 'no response and no reason reported');
      if (GONE_STATUS.has(res.status)) {
        return { ok: false, failure: { kind: 'gone', terminal: true, detail: reason }, attempts: i };
      }
      /* Key on the STRUCTURED libuv code, not on the prose. ENOTFOUND is NXDOMAIN — the host
         does not exist. EAI_AGAIN is a DNS server that did not answer, which is transient and
         must stay deferrable: treating it as terminal would hard-fail a live article over a
         DNS blip, which is the false-accusation direction and worse than deferring.

         The message regex survives only for a failure that carries no code at all, and when it
         fires it STAMPS the detail to say so, because a message-derived classification is
         weaker evidence than a code-derived one and must never be mistaken for it. */
      const code = res.code || '';
      if (code === 'ENOTFOUND') {
        return { ok: false, failure: { kind: 'dns', terminal: true, detail: `host does not resolve (${code}) — ${reason}` }, attempts: i };
      }
      if (!code && !res.status && /\bENOTFOUND\b/.test(reason)) {
        return { ok: false, failure: { kind: 'dns', terminal: true, detail: `host does not resolve — ${reason} [classified from message text; no structured error code was present]` }, attempts: i };
      }
      last = { kind: 'http', detail: reason };
      await new Promise(r => setTimeout(r, 700 * i));
      continue;
    }
    const extracted = extractArticle(res.body, res.finalUrl);
    const challenge = detectBotChallenge(res.body, extracted.mainText);
    if (!challenge.challenged) return { ok: true, res, extracted, attempts: i };
    last = { kind: 'challenge', detail: challenge.reason };
    await new Promise(r => setTimeout(r, 700 * i));
  }
  return { ok: false, failure: last, attempts };
}

/*
 * Independent corroboration for DOI-bearing journal articles via Europe PMC, an open API
 * with no key and no bot protection. When a publisher's own page is unreachable we can still
 * attest the quote, date and authorship from a second source rather than either failing the
 * run or waving the citation through unverified.
 */
async function corroborateViaEuropePmc(doi, quote) {
  const api = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:%22${encodeURIComponent(doi)}%22&resultType=core&format=json`;
  const res = await fetch(api, { headers: { accept: 'application/json' } });
  if (!res.ok) return { ok: false, detail: `Europe PMC HTTP ${res.status}` };
  const data = await res.json();
  const rec = data && data.resultList && data.resultList.result && data.resultList.result
    .find(r => String(r.doi || '').toLowerCase() === doi.toLowerCase() && r.source !== 'PPR');
  if (!rec) return { ok: false, detail: 'no peer-reviewed Europe PMC record for that DOI' };
  const abstract = normalizeForQuote(rec.abstractText || '');
  const needle = normalizeForQuote(quote);
  // The abstract is shorter than the article, so a quote drawn from the body legitimately
  // may not appear. Corroborating the record's identity still has value on its own.
  return {
    ok: true,
    quoteFound: needle.length > 0 && abstract.includes(needle),
    journal: rec.journalInfo && rec.journalInfo.journal && rec.journalInfo.journal.title || '',
    firstPublicationDate: rec.firstPublicationDate || '',
    authors: rec.authorString || '',
  };
}

function doiFromUrl(url, headline) {
  const nature = String(url).match(/nature\.com\/articles\/(s\d{5}-\d{3}-\d{5}-[\dxX])/);
  if (nature) return `10.1038/${nature[1]}`;
  return '';
}

const problems = [];
const notes = [];
function fail(msg) { problems.push(msg); }
function ok(msg) { notes.push(msg); }

function collapse(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

function parseXDate(raw) {
  if (!raw) return null;
  const d = new Date(/\d:\d/.test(raw) ? raw : `${raw} UTC`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* The X evidence ledger stores a human-readable DAY ("22 Jun 2026"), not an instant. That
 * day materialises as midnight UTC, so a naive instant comparison passes any article
 * published later on the SAME day — even though the post's true time is unknown and the
 * ordering therefore UNDEMONSTRABLE. Treating an unknowable ordering as a pass is fail-open,
 * so a day-precision origin is cleared only by a strictly LATER day. When the ledger does
 * carry a time the instant is demonstrable and is used as-is.
 */
function originBar(raw) {
  const at = parseXDate(raw);
  if (!at) return null;
  const dayPrecision = !/\d:\d/.test(String(raw));
  return { at, dayPrecision, bar: dayPrecision ? at.getTime() + 864e5 - 1 : at.getTime() };
}

async function main() {
  const root = __dirname;
  const predictions = JSON.parse(fs.readFileSync(path.join(root, 'predictions.json'), 'utf8'));
  const signals = JSON.parse(fs.readFileSync(path.join(root, 'signals.json'), 'utf8'));
  const { CURRENCY_SOURCES, CURRENCY_MAPPINGS } = require('./currency-evidence');

  // ---- the universe of valid prediction ids -------------------------------------------
  const ids = new Set();
  predictions.years.forEach(y => (y.events || []).forEach((_, i) => ids.add(`${y.year}-${i}`)));
  predictions.postSuperintelligence.items.forEach(h => ids.add(`horizon-${h.id}`));

  const sources = CURRENCY_SOURCES;
  const mappings = CURRENCY_MAPPINGS;
  const embeds = signals.embeds || {};

  // ---- STRUCTURAL: the currency layer must not disturb the X layer ---------------------
  if (Object.keys(embeds).length !== ids.size) {
    fail(`direct X coverage regressed: ${Object.keys(embeds).length} embeds for ${ids.size} predictions`);
  } else {
    ok(`all ${ids.size} predictions still carry reviewed direct X evidence`);
  }

  const reuse = {};
  let linkCount = 0;

  for (const [pid, list] of Object.entries(mappings)) {
    if (!ids.has(pid)) fail(`currency mapping references unknown prediction id ${pid}`);
    // A currency link is additive. It may only ever appear on a prediction that ALREADY has
    // its reviewed X origin evidence; it can never be the sole evidence for a prediction.
    if (!embeds[pid]) fail(`${pid}: has a currency link but no reviewed X origin evidence — currency must be additive, never a substitute`);
    for (const entry of list) {
      linkCount++;
      reuse[entry.source] = (reuse[entry.source] || 0) + 1;
      if (!sources[entry.source]) fail(`${pid}: references undefined currency source ${entry.source}`);
    }
  }

  const over = Object.entries(reuse).filter(([, n]) => n > REUSE_CEILING);
  if (over.length) over.forEach(([k, n]) => fail(`source ${k} reused ${n} times, ceiling ${REUSE_CEILING}`));
  else ok(`max reuse ${Math.max(0, ...Object.values(reuse))} within ceiling ${REUSE_CEILING}`);

  // ---- prediction text must be byte-identical wherever a currency link is attached -----
  // A citation is approved against a specific claim. If the claim is edited afterwards the
  // approval no longer means anything, so the text is pinned for any prediction we cite.
  const textByIdPath = path.join(root, 'currency-text-pins.json');
  const pins = fs.existsSync(textByIdPath) ? JSON.parse(fs.readFileSync(textByIdPath, 'utf8')) : null;
  const currentText = {};
  predictions.years.forEach(y => (y.events || []).forEach((e, i) => { currentText[`${y.year}-${i}`] = e.t; }));
  predictions.postSuperintelligence.items.forEach(h => { currentText[`horizon-${h.id}`] = h.t; });

  if (pins) {
    let drifted = 0;
    for (const [pid, pinned] of Object.entries(pins)) {
      if (currentText[pid] !== pinned) {
        fail(`${pid}: prediction text changed since its currency citation was approved — re-review the citation against the new wording`);
        drifted++;
      }
    }
    if (!drifted) ok(`prediction text byte-identical for all ${Object.keys(pins).length} cited predictions`);
  } else {
    const snapshot = {};
    for (const pid of Object.keys(mappings)) snapshot[pid] = currentText[pid];
    fs.writeFileSync(textByIdPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    ok(`created currency-text-pins.json pinning ${Object.keys(snapshot).length} cited prediction texts`);
  }

  // ---- SOURCE QUALITY ------------------------------------------------------------------
  /* Read the labels the UI can actually render straight out of app.js, so this gate tracks
     the real renderer rather than a copy of it that could drift out of step. */
  const APP_QUALITY_LABELS = (() => {
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const block = app.slice(app.indexOf('const QUALITY = {'));
    const body = block.slice(0, block.indexOf('};'));
    return new Set([...body.matchAll(/'([a-z-]+)'\s*:/g)].map(m => m[1]));
  })();
  if (APP_QUALITY_LABELS.size === 0) fail('could not read the currency source-quality label map out of app.js');

  for (const [key, s] of Object.entries(sources)) {
    const host = registrableHost(new URL(s.resolvedUrl).hostname);
    if (EXCLUDED_HOSTS.has(host)) fail(`${key}: ${host} is a preprint server and is inadmissible as currency evidence`);
    for (const field of ['publisher', 'headline', 'publishedAt', 'quote', 'textSha256', 'resolvedUrl']) {
      if (!s[field]) fail(`${key}: missing required captured field '${field}'`);
    }
    /* Quotes are rendered to readers as blockquotes. A fragment starting mid-clause reads
       as a truncation bug in our own UI, so completeness is a standing gate here as well as
       in the builder — a hand-edited ledger must not be able to bypass it. */
    if (s.quote && !/^["'\u201c(]?[A-Z0-9]/.test(s.quote)) {
      fail(`${key}: recorded quote starts mid-sentence ("${s.quote.slice(0, 32)}…")`);
    }
    if (s.quote && !/[.!?"'\u201d)]$/.test(s.quote)) {
      fail(`${key}: recorded quote has no terminal punctuation ("…${s.quote.slice(-32)}")`);
    }
    /* A source-quality value the UI cannot name renders as the generic "Verified
       publication", silently erasing the peer-reviewed / first-party-lab / independent-press
       distinction that is the whole point of declaring it. Caught here rather than by eye. */
    if (!APP_QUALITY_LABELS.has(s.sourceQuality)) {
      fail(`${key}: sourceQuality '${s.sourceQuality}' has no label in app.js and would render as generic "Verified publication"`);
    }
  }
  ok(`${Object.keys(sources).length} sources carry complete captured provenance, whole-sentence quotes and zero preprint hosts`);

  // ---- FRESHNESS + the gate that currency must be NEWER than the X post it refreshes ---
  /* AGE-OUT IS A DEMOTION, NOT AN EVIDENCE FAULT.
   *
   * An aged-out reference is not a damaged citation. The article is still genuine and still
   * says exactly what it said; it has simply stopped being CURRENT, which is the one job this
   * optional layer does. Wiring that to the mandatory publish gate meant a layer covering 8 of
   * 103 predictions could abort a publish carrying 95 predictions that never needed it, plus
   * every unrelated author and forecast change — an optional layer holding a mandatory gate
   * hostage.
   *
   * So the check is not deleted, it is RE-POINTED at the invariant that actually matters:
   * refresh-signals.js drops expired references at emission, and the two assertions below
   * prove that demotion genuinely happened rather than trusting that it did. An expired
   * reference still visible in signals.json, or a live reference silently missing from it,
   * is a real integrity fault and still fails closed. Quote drift, headline drift and
   * fabricated sources remain exit 1; unreachable hosts and bot challenges remain exit 75.
   *
   * Demotion is safe by construction: currency is refused unless its reviewed X origin exists
   * and can never satisfy a Peter floor or the ratchet, so dropping one cannot reduce coverage
   * or breach a gate. It degrades to the X-only state 95 predictions already occupy.
   */
  const now = new Date();
  const buckets = { '<=14d': 0, '15-30d': 0, '31-90d': 0, '91-365d': 0, '>1yr': 0 };
  const demoted = new Set();
  const ageing = [];
  const originChecked = { total: 0, published: 0, dayPrecision: 0, thinnestDays: null };
  const published = signals.currency || {};
  /* THE EXPIRY INSTANT MUST COME FROM THE BUILDER'S RULE, not from a second formula that merely
     agrees today. refresh-signals.js demotes when Math.round(ageDays) > ceiling, which fires at
     publishedAt + (ceiling + 0.5)d — that half day is a property of Math.round and of the strict
     `>`, and it moves if either changes. Both are therefore READ OUT of the builder and the
     offset derived from the pair; an unrecognised rule fails closed rather than printing a
     confident wrong instant. Measured on the line this replaces, which computed
     now + (ceiling - roundedAge)d: it put ferc a full day early (2026-08-23 for a row that
     survives the 08-23 build at 59.7d), and because it inherited the rounding of `age` it
     printed 2026-08-14 at 00:30Z and 2026-08-13 at 23:30Z ON THE SAME DAY for the same link —
     a date that changes with the hour the gate happens to run is not a deadline. */
  /* THE RULE SPACE, DECLARED ONCE. Every downstream question of the form "what else could the
     builder be doing?" — the expiry offset, and the discrimination counts far below — resolves
     against THIS table and nothing else. A second list of candidate rules written somewhere else
     would agree with this one today and diverge on exactly the edit that adds a rule. */
  const RULE_OFFSETS = { 'round>': 0.5, 'round>=': -0.5, 'floor>': 1, 'floor>=': 0, 'ceil>': 0, 'ceil>=': -1 };
  const AGE_RULES = [...new Set(Object.keys(RULE_OFFSETS).map(k => k.replace(/[><=]+$/, '')))];
  const DEMOTION_RULE = (() => {
    const builder = fs.readFileSync(path.join(root, 'refresh-signals.js'), 'utf8');
    const round = builder.match(/ageDays\s*=\s*Math\.(round|floor|ceil)\(\s*\(\s*currencyNow\s*-\s*new Date\(\s*src\.publishedAt\s*\)\.getTime\(\)\s*\)\s*\/\s*864e5\s*\)/);
    const cmp = builder.match(/if\s*\(\s*ageDays\s*(>=?)\s*CURRENCY_MAX_AGE_DAYS\s*\)/);
    if (!round || !cmp) return null;
    const offsets = RULE_OFFSETS;
    const key = `${round[1]}${cmp[1]}`;
    if (!Object.prototype.hasOwnProperty.call(offsets, key)) return null;
    /* ONE READING OF THE BUILDER, USED FOR BOTH THE DECISION AND THE DEADLINE. Hardcoding the
       rounding here while deriving it for the expiry would put a derived reading and a copied
       one inside a single instrument, agreeing today and diverging on exactly the edit that
       matters. MEASURED, and it is not hypothetical: at the pre-registered 2026-08-14T22:01Z
       build the Nature link sits at 60.917d, where round gives 61 (DEMOTED) and floor gives 60
       (NOT DEMOTED) — the rounding function alone decides Friday's verdict for the one link
       Friday is about. */
    return { key, offset: offsets[key], age: ms => Math[round[1]](ms / 864e5), past: a => (cmp[1] === '>' ? a > MAX_AGE_DAYS : a >= MAX_AGE_DAYS) };
  })();
  if (!DEMOTION_RULE) {
    fail('the currency demotion rule is UNREADABLE in refresh-signals.js (age rounding and/or the ceiling comparison did not match) — expiry instants cannot be derived from the rule that actually demotes, and the age decisions below fall back to an ASSUMED round/> and must not be read as agreeing with the builder');
  }
  for (const [pid, list] of Object.entries(mappings)) {
    for (const entry of list) {
      const s = sources[entry.source];
      if (!s) continue;
      const elapsed = now - new Date(s.publishedAt);
      const age = DEMOTION_RULE ? DEMOTION_RULE.age(elapsed) : Math.round(elapsed / 864e5);
      const livePublished = (published[pid] || []).some(c => c.key === entry.source);

      if (DEMOTION_RULE ? DEMOTION_RULE.past(age) : age > MAX_AGE_DAYS) {
        demoted.add(entry.source);
        if (livePublished) {
          fail(`${pid}: ${entry.source} is ${age} days old, past the ${MAX_AGE_DAYS}-day ceiling, yet is STILL PUBLISHED in signals.json — the age-out demotion did not take effect`);
        } else {
          ok(`demoted (not an evidence fault)  ${pid}  ${entry.source}  ${age}d > ${MAX_AGE_DAYS}d ceiling — absent from signals.json, X origin retained`);
        }
        continue;
      }

      // Within the ceiling, so it must actually be published in signals.json as it claims.
      if (!livePublished && embeds[pid]) {
        fail(`${pid}: ${entry.source} is ${age} days old and within the ceiling, but is MISSING from signals.json currency — a reviewed reference silently failed to publish`);
      }
      if (age >= REFRESH_AT_DAYS) {
        /* Days remaining is derived from the crossing instant, not from the rounded age, so it
           does not inherit the same drift the printed date used to. */
        const crossing = DEMOTION_RULE
          ? new Date(new Date(s.publishedAt).getTime() + (MAX_AGE_DAYS + DEMOTION_RULE.offset) * 864e5)
          : null;
        ageing.push(crossing
          ? `${pid}  ${entry.source}  ${age}d — ${((crossing - now) / 864e5).toFixed(1)}d remaining; demotes on the FIRST BUILD AFTER ${crossing.toISOString().replace('.000Z', 'Z')} (derived from the builder's ${DEMOTION_RULE.key} ceiling rule)`
          : `${pid}  ${entry.source}  ${age}d — EXPIRY UNKNOWN: the builder's demotion rule could not be read`);
      }

      if (age <= 14) buckets['<=14d']++;
      else if (age <= 30) buckets['15-30d']++;
      else if (age <= 90) buckets['31-90d']++;
      else if (age <= 365) buckets['91-365d']++;
      else buckets['>1yr']++;

      const originRaw = embeds[pid] && (embeds[pid].postedAt || embeds[pid].date);
      const origin = originBar(originRaw);
      if (!origin) {
        // An unpairable origin must never read as a pass: that is the shape that let a
        // missing field silently disable a guard everywhere else in this pipeline.
        fail(`${pid}: ${entry.source} is published but its X origin date could not be resolved (${JSON.stringify(originRaw)}) — the refresh relation is unverifiable, so it fails closed`);
      } else {
        originChecked.total++;
        if (livePublished) originChecked.published++;
        if (origin.dayPrecision) originChecked.dayPrecision++;
        const marginDays = (Date.parse(s.publishedAt) - origin.at.getTime()) / 864e5;
        if (originChecked.thinnestDays == null || marginDays < originChecked.thinnestDays) {
          originChecked.thinnestDays = marginDays;
        }
        if (Date.parse(s.publishedAt) <= origin.bar) {
          fail(`${pid}: ${entry.source} (${s.publishedAt.slice(0, 10)}) is not newer than its X origin evidence (${originRaw})${origin.dayPrecision ? ' — a day-precision origin is cleared only by a strictly later day, because same-day ordering is undemonstrable' : ''} — it cannot refresh evidence older than itself`);
        }
      }
    }
  }

  if (originChecked.total) {
    /* Count what is actually measured. This loop walks the LEDGER, so an entry within the
       ceiling is checked whether or not it reached signals.json; calling that total
       "published" made the line read "11 published link(s)" on a run where zero were
       published. The noun must match the number it is attached to. */
    ok(`refresh relation enforced  ${originChecked.total} ledger entr${originChecked.total === 1 ? 'y' : 'ies'} within the ceiling postdate the X evidence they refresh (${originChecked.published} of them live-published); ${originChecked.dayPrecision} carry a day-precision origin and so must clear a strictly later day; thinnest margin ${originChecked.thinnestDays.toFixed(1)}d`);
  } else {
    /* The pin was taught to announce its own inertness and this check was not, in the same
       file and the same commit — the instance was fixed and the class was not swept. A
       bare `if (count)` emits NOTHING at zero, so the run is silent about a check that did
       not run, and silence is indistinguishable from a check that ran and held. */
    ok('refresh relation is INERT on this run: no ledger entry is within the ceiling, so nothing was tested about currency postdating its X origin');
    inertAxes.push('refresh relation');
  }

  /* ---- PUBLISHED SET MUST BE A SUBSET OF THE REVIEWED LEDGER ---------------------------
   * Every check above walks the LEDGER and asks whether each reviewed entry reached
   * signals.json. That is one direction only. Nothing asked the converse: whether every
   * link the site actually publishes traces back to a reviewed entry at all.
   *
   * The gap is the exact failure this whole layer exists to prevent. A currency object
   * present in signals.json but absent from the ledger — through a publisher bug, a stale
   * emission, or a hand edit — carries a URL, headline, author and quote that no review
   * ever approved, and it renders on the page as evidence. Measured before this block
   * existed: an invented link with a fabricated URL, headline and quote passed
   * verify:currency, verify:matcher, verify:coverage, verify:peter, verify:external and
   * verify:news, all exit 0, none naming it. Counts did not catch it because it changes
   * no count the gates assert, and the card-count gates simply expected one more card and
   * found one more card.
   *
   * Key presence alone is not enough either: a known key with an altered URL or quote is
   * the same fabrication wearing a reviewed name. So the emitted fields are pinned to the
   * ledger values field by field.
   */
  {
    /* THE FIELD COUNT IN THE LINE BELOW USED TO BE PINNED_FIELDS.length — A CONSTANT PRINTED
       WHERE A MEASUREMENT BELONGED. The loop skipped any field the ledger did not define
       (`if (ledger[f] === undefined) continue`), so the number of comparisons actually made
       was never the number reported. Measured on the live ledger by dropping each pinned
       field in turn: 5 of the 8 are independently required elsewhere and a neighbour catches
       their absence, but url, publisherHost and author are NOT — for those three, absence in
       the ledger silently disabled the comparison while this line went on asserting that
       "an unreviewed or altered link cannot reach the page" over 8 fields it had not read.

       That is reachable, not theoretical. Measured end to end: with `author` absent from the
       ledger, a published link carrying "FABRICATED BYLINE — NOT REVIEWED" produced NO
       finding and the same exit code as a pristine run; with `url` absent, a link repointed
       at https://example-not-reviewed.test/article did the same. The identical mutation with
       the ledger field present is caught and named twice. So the only thing separating a
       fabricated byline or an arbitrary unreviewed host from the live page was whether the
       ledger happened to pin that field — and the forged count is precisely what made it
       invisible, because the verdict is correct on every run where the ledger is complete.

       Both halves are fixed here: comparisons are COUNTED rather than assumed, and a value
       the page emits for a field the ledger does not pin is a FAULT, not a skip — it is by
       definition unreviewed evidence on the page, which is the exact sentence this block
       claims to guarantee. A field absent from BOTH sides is legitimate (a genuinely
       by-line-less article) and is counted and reported rather than passed over in silence. */
    const PINNED_FIELDS = ['url', 'publisher', 'publisherHost', 'author', 'headline', 'publishedAt', 'sourceQuality', 'quote'];
    const present = v => v !== undefined && v !== null && String(v).trim() !== '';
    let traced = 0;
    let compared = 0;
    let absentBoth = 0;
    const unpinned = [];
    for (const [pid, list] of Object.entries(published)) {
      for (const c of list) {
        const ledger = sources[c.key];
        if (!ledger) {
          fail(`${pid}: published currency link ${JSON.stringify(c.key)} (${c.url}) has NO entry in the reviewed ledger — it is unreviewed evidence on the live page`);
          continue;
        }
        const mapped = (mappings[pid] || []).some(e => e.source === c.key);
        if (!mapped) {
          fail(`${pid}: published currency link ${c.key} exists in the ledger but is NOT mapped to this prediction — it was never reviewed as evidence for ${pid}`);
          continue;
        }
        traced++;
        for (const f of PINNED_FIELDS) {
          if (!present(ledger[f])) {
            if (present(c[f])) {
              unpinned.push(`${pid}/${c.key}/${f}`);
              fail(`${pid}: published currency link ${c.key} emits ${f} ${JSON.stringify(c[f])}, but the reviewed ledger PINS NO VALUE for ${f} — that value reached the live page without ever being reviewed, and the field-by-field trace could not compare it`);
            } else {
              absentBoth++;
            }
            continue;
          }
          compared++;
          if (collapse(c[f]) !== collapse(ledger[f])) {
            fail(`${pid}: published currency link ${c.key} emits ${f} ${JSON.stringify(c[f])}, but the reviewed ledger holds ${JSON.stringify(ledger[f])} — the published evidence does not match what was reviewed`);
          }
        }
      }
    }
    const publishedCount = Object.values(published).reduce((n, l) => n + l.length, 0);
    if (publishedCount) {
      const possible = traced * PINNED_FIELDS.length;
      ok(`published set traced to the ledger  ${traced} of ${publishedCount} published link(s) resolve to a reviewed, correctly-mapped ledger entry; ${compared} of ${possible} pinned-field comparison(s) WERE ACTUALLY MADE (${absentBoth} field(s) absent from both the ledger and the page, so nothing unreviewed reached it; ${unpinned.length} emitted with no ledger value, each failed above) — this count is measured, not PINNED_FIELDS.length`);
      if (unpinned.length) {
        fail(`the fabrication trace is INCOMPLETE on this run: ${unpinned.length} published field value(s) had no reviewed counterpart to compare against (${unpinned.slice(0, 6).join(', ')}${unpinned.length > 6 ? ', …' : ''}) — "an unreviewed or altered link cannot reach the page" DOES NOT HOLD for this run`);
      } else if (compared === possible) {
        ok(`  ...and the trace is COMPLETE: every one of the ${PINNED_FIELDS.length} pinned fields was present on both sides for all ${traced} link(s), so an unreviewed or altered link cannot reach the page`);
      } else {
        ok(`  ...trace complete over the fields that exist: ${absentBoth} pinned field(s) are absent from both sides and therefore carry nothing to the page; no emitted value went uncompared`);
      }
    } else {
      ok('published-set trace is INERT on this run: signals.json publishes no currency links, so this check establishes nothing about fabrication');
      inertAxes.push('fabrication trace');
    }
  }

  /* ---- EMITTED AGE PIN ----------------------------------------------------------------
   * Everything above RECOMPUTES age from the ledger and compares outcomes. That makes this
   * gate a second implementation rather than an independent check: signals.json emits
   * ageDays and freshness on every link plus a coverage histogram, and nothing asserted
   * those were derivable from publishedAt at all. A drift between the publisher's rounding
   * (refresh-signals.js) and this file's would therefore surface somewhere downstream as a
   * phantom histogram discrepancy instead of failing here with both values named.
   *
   * The epoch is signals.updated, not now. The emitted ages were computed at the publish
   * instant, so recomputing against the current clock would fail purely as a function of
   * how long after publication the gate happens to run.
   */
  const emittedAt = Date.parse(signals.updated);
  if (!Number.isFinite(emittedAt)) {
    fail('signals.updated is not a parseable timestamp — emitted currency ages cannot be reproduced');
  } else {
    const bandOf = a => (a <= 14 ? '<=14d' : a <= 30 ? '15-30d' : a <= 90 ? '31-90d' : a <= 365 ? '91-365d' : '>1yr');
    const impliedHist = { '<=14d': 0, '15-30d': 0, '31-90d': 0, '91-365d': 0, '>1yr': 0 };
    let pinned = 0;
    /* ONE COUNTER PER ALTERNATIVE, because no single counter can stand for the rule space.
       For non-integral elapsed the discriminating sets are DISJOINT AND EXHAUSTIVE: frac < .5
       makes round === floor so only ceil differs; frac > .5 makes round === ceil so only floor
       differs. A row therefore NEVER separates the pin from both rivals, which means a
       round-vs-floor count is not a weak measure of discriminating power against ceil — it is
       exactly the set of rows BLIND to ceil. Measured on the live artefact: 6 vs floor, 5 vs
       ceil, 0 both, 0 neither, and 6+5+0 === 11. Counting one rival and concluding about "a
       rounding drift" is the same widening as counting a ledger and naming a page. */
    const PINNED_RULE = 'round';
    const discrimVs = Object.fromEntries(AGE_RULES.filter(r => r !== PINNED_RULE).map(r => [r, 0]));
    let ageAxisFailures = 0;
    for (const [pid, list] of Object.entries(published)) {
      for (const c of list) {
        const at = Date.parse(c.publishedAt);
        if (!Number.isFinite(at)) { fail(`${pid}: ${c.key} has an unparseable publishedAt (${c.publishedAt})`); continue; }
        /* TWO INDEPENDENT AXES, AND THEIR DISAGREEMENT IS THE INFORMATIVE PART. `expected` is
           PINNED to round on purpose — it is the ratchet that catches a silent drift toward
           floor. `byBuilder` is DERIVED from whatever rule refresh-signals.js currently declares.
           Agreement between them is only worth something because they come from different
           places; when they part, which one the artefact follows says whether the rule changed
           or the artefact is stale, and neither check could tell those apart alone. */
        const expected = Math.round((emittedAt - at) / 864e5);
        const byBuilder = DEMOTION_RULE ? DEMOTION_RULE.age(emittedAt - at) : null;
        const pinOk = c.ageDays === expected;
        const builderOk = byBuilder === null || c.ageDays === byBuilder;
        if (!pinOk || !builderOk) {
          ageAxisFailures++;
          fail(!pinOk && builderOk
            ? `${pid}: ${c.key} RULE CHANGE — the artefact emits ageDays ${c.ageDays}, which reproduces under the rule refresh-signals.js now declares (${DEMOTION_RULE.key} gives ${byBuilder}) but NOT under this gate's pinned round (${expected}). The artefact follows the new rule and the pin asserts the superseded one; align them deliberately and do not relax the pin to make this pass`
            : pinOk && !builderOk
            ? `${pid}: ${c.key} STALE ARTEFACT — the artefact emits ageDays ${c.ageDays}, which reproduces under round, but refresh-signals.js now declares ${DEMOTION_RULE.key} which gives ${byBuilder}. signals.json was built by a rule the builder no longer contains and must be rebuilt before its ages mean anything`
            : `${pid}: ${c.key} emits ageDays ${c.ageDays}, but publishedAt ${c.publishedAt} against signals.updated ${signals.updated} gives ${expected} — publisher and verifier disagree on the definition of age`);
        }
        const band = bandOf(c.ageDays);
        if (c.freshness !== band) {
          fail(`${pid}: ${c.key} emits freshness "${c.freshness}", but its emitted ageDays ${c.ageDays} falls in ${band}`);
        }
        impliedHist[band]++;
        pinned++;
        for (const r of Object.keys(discrimVs)) {
          if (Math[r]((emittedAt - at) / 864e5) !== expected) discrimVs[r]++;
        }
      }
    }
    const coverageHist = signals.coverage && signals.coverage.currency && signals.coverage.currency.freshness;
    if (!coverageHist) {
      fail('coverage.currency.freshness is absent — the published freshness histogram cannot be checked against the links it summarises');
    } else if (JSON.stringify(coverageHist) !== JSON.stringify(impliedHist)) {
      fail(`coverage.currency.freshness ${JSON.stringify(coverageHist)} does not match the histogram implied by the emitted per-link ages ${JSON.stringify(impliedHist)}`);
    } else if (pinned) {
      /* The agreement claim is CONDITIONAL ON AGREEMENT. Printed unconditionally it appeared
         beside its own STALE ARTEFACT failures on the very battery that introduced it — a green
         sentence about two axes concurring, in a run where they had just been shown to differ. */
      ok(ageAxisFailures === 0 && DEMOTION_RULE
        ? `emitted ages pinned  ${pinned} link(s) reproduce both ageDays and freshness from publishedAt against signals.updated, and the coverage histogram matches [two independent axes agree: this gate's pinned round, and the ${DEMOTION_RULE.key} rule read out of refresh-signals.js]`
        : ageAxisFailures === 0
        ? `emitted ages pinned  ${pinned} link(s) reproduce ageDays and freshness against this gate's PINNED round, and the coverage histogram matches — but the builder's own rule is UNREADABLE, so the second axis was unavailable and this is ONE measurement, not two agreeing`
        : `emitted ages: the freshness histogram matches the emitted per-link ages, but ${ageAxisFailures} of ${pinned} link(s) FAILED the age axes above — this line reports the histogram only and asserts nothing about rounding`);
    } else {
      ok('emitted-age pin had NO published links to check on this run — it is INERT here and establishes nothing about rounding; a green chain does not mean this pin held');
      inertAxes.push('emitted-age pin');
    }
    /* A pin that a candidate definition also satisfies proves nothing against THAT definition.
       The claim is refused while ANY alternative is at zero, and the blind one is named — a
       general conclusion ("a rounding drift would fail here") is only available when every rule
       the reader above can return has been separated from the pin on this run. */
    if (pinned) {
      const blind = Object.entries(discrimVs).filter(([, n]) => n === 0).map(([r]) => r);
      const detail = Object.entries(discrimVs).map(([r, n]) => `${n} vs ${r}`).join(', ');
      ok(blind.length === Object.keys(discrimVs).length
        ? `emitted-age pin is NOT discriminating today: every link's age is identical under ${AGE_RULES.join('/')}, so this run could not detect a rounding drift of any kind`
        : blind.length
        ? `emitted-age pin is BLIND to ${blind.join(' and ')} on this run — ${detail} of ${pinned} link(s). It would catch a drift toward ${Object.keys(discrimVs).filter(r => !blind.includes(r)).join('/')} and NOT one toward ${blind.join('/')}; this run carries no general claim about rounding`
        : `emitted-age pin discriminates against every alternative rule refresh-signals.js could declare — ${detail} of ${pinned} link(s), so a drift to any of ${AGE_RULES.filter(r => r !== PINNED_RULE).join(' or ')} would fail here`);
    }
    /* Boundary proximity, in two KINDS that must not share a sentence. A band edge decides which
       histogram BUCKET a link is filed under; the demotion ceiling decides whether the link is
       PUBLISHED AT ALL. The edge list below is the band edges only — appending the ceiling to it
       would put a bucket-misfiling and a publication decision under one label, which is the same
       widening this section was just repaired for. The ceiling gets its own pass, derived from
       the demotion decision itself rather than from a proximity guess. */
    let bandEdge = 0;
    let ceilingSensitive = 0;
    /* THE INSTRUMENT DERIVES THE WINDOW; A HUMAN NO LONGER COMPUTES IT IN PROSE. This exists
       because I got it wrong in exactly the way this file keeps naming. Asked when the pass
       would first fire on live data, I hand-computed 59.5d (`round>=`) — the NEAREST NEIGHBOUR
       of the declared `round>`, whose crossing is easy to do in your head. The answer is the
       EXTREMUM of the space, `ceil>=` at 59.0d, and it is already sitting in RULE_OFFSETS,
       sorted, requiring no evaluation at all. So the alternatives were derived while the
       boundary of the derived set was copied by hand: one rule space wearing two names, the
       second copy living in prose where nothing executes it and no fixture can catch it.
       Verified against this code by driving publishedAt across 58.9/59.001/59.501/60.001/
       60.501/61.001d — silent, {ceil>=}, {round>=,ceil>=}, {round>=,floor>=,ceil>,ceil>=},
       {5 of 6}, silent — so the window is [59.0d, 61.0d] and both endpoints are measured. */
    let nextWindow = null;
    let unparseableDates = 0;
    for (const [pid, list] of Object.entries(published)) {
      for (const c of list) {
        /* NaN IS A CONSTANT, AND IT FALLS ON THE PASSING SIDE OF EVERY COMPARISON BELOW. An
           unparseable publishedAt makes `exact` NaN; `NaN > ceiling` and `NaN >= ceiling` are
           both false, so all six rules report KEEP, `demote.length` is 0, and the row reads as
           comfortably fresh and rule-insensitive — the strongest green this pass can emit — on
           the one input where nothing was measured at all. The band-edge test degrades the same
           way, since `Math.abs(NaN - x) < 0.5` is false. The pin at the top of this section does
           catch the same input, but this loop must not depend on a neighbour for its own
           population, and the excluded rows are counted and stated rather than skipped. */
        const pubAt = Date.parse(c.publishedAt);
        if (!Number.isFinite(pubAt)) { unparseableDates++; continue; }
        const exact = (emittedAt - pubAt) / 864e5;
        const edge = [14, 30, 90, 365].find(e => Math.abs(exact - (e + 0.5)) < 0.5);
        if (edge !== undefined) {
          bandEdge++;
          ok(`band-edge  ${pid}  ${c.key}  ${exact.toFixed(2)}d is within 12h of the ${edge}d band edge — publisher and verifier must agree on rounding or this link is filed in the wrong freshness BUCKET (it stays published either way)`);
        }
        /* Not a distance heuristic: run the actual demotion decision under every rule in the
           table and report only genuine disagreement. This fires when the RULE, not the data,
           decides whether the link is on the site. */
        const decided = Object.keys(RULE_OFFSETS).map(key => {
          const fn = key.replace(/[><=]+$/, '');
          const a = Math[fn](exact);
          return { key, demoted: key.endsWith('>=') ? a >= MAX_AGE_DAYS : a > MAX_AGE_DAYS };
        });
        const demote = decided.filter(d => d.demoted).map(d => d.key);
        const keep = decided.filter(d => !d.demoted).map(d => d.key);
        if (demote.length && keep.length) {
          ceilingSensitive++;
          ok(`CEILING-SENSITIVE  ${pid}  ${c.key}  ${exact.toFixed(3)}d against the ${MAX_AGE_DAYS}d ceiling — THE RULE DECIDES PUBLICATION on this row, not the data: ${demote.join('/')} demote it, ${keep.join('/')} keep it. Rounding agreement is load-bearing for whether this link appears at all`);
        } else if (!demote.length) {
          /* Not yet sensitive. The window opens when the FIRST rule in the space flips, which
             is the minimum over RULE_OFFSETS — never the neighbour of the declared rule. */
          const opens = Object.entries(RULE_OFFSETS)
            .map(([key, off]) => ({ key, when: pubAt + (MAX_AGE_DAYS + off) * 864e5 }))
            .sort((a, b) => a.when - b.when)[0];
          if (!nextWindow || opens.when < nextWindow.when) nextWindow = { ...opens, pid, key: c.key, rule: opens.key };
        }
      }
    }
    /* State the population even when nothing fired: a silent advisory is indistinguishable from
       one that never ran, which is the defect this file keeps finding elsewhere. */
    if (pinned) {
      ok(`boundary sweep  ${pinned} published link(s) checked — ${bandEdge} within 12h of a freshness band edge, ${ceilingSensitive} where the demotion rule itself decides publication at the ${MAX_AGE_DAYS}d ceiling${unparseableDates ? `, ${unparseableDates} EXCLUDED for an unparseable publishedAt and therefore NOT swept` : ''}`);
      if (!ceilingSensitive && nextWindow && Number.isFinite(nextWindow.when)) {
        ok(`  ...next ceiling-sensitivity window opens ${new Date(nextWindow.when).toISOString()} on ${nextWindow.pid}/${nextWindow.key}, driven by ${nextWindow.rule} — the EXTREMUM of the ${Object.keys(RULE_OFFSETS).length}-rule space, derived from RULE_OFFSETS rather than computed by hand`);
      }
    }
  }

  // ---- LIVE RE-VERIFICATION ------------------------------------------------------------
  /* Count what this section ACTUALLY fetched. Every branch below prints a reassuring green
     line — "skipped (demoted)", "UNREACHABLE but corroborated", "live OK" — but the section
     made no aggregate claim, so a run in which nothing was fetched at all was byte-for-byte
     as green as a run in which every link was re-verified. That matters on a schedule: each
     age-out moves one more source onto the demoted skip path, so the number of links this
     gate genuinely re-checks trends toward zero while its output stays entirely reassuring.
     A reader of a green chain must be able to see how much live verification stood behind
     it, so the count is stated and zero is announced rather than passed over in silence. */
  let liveFetched = 0;
  let liveSkippedDemoted = 0;
  if (OFFLINE) {
    ok('live re-verification is INERT: --offline skipped every fetch, so this run establishes NOTHING about headline, quote or date drift and is not valid for publish');
    inertAxes.push('live re-verification (--offline)');
  } else {
    for (const [key, s] of Object.entries(sources)) {
      /* A demoted source is not published, so its live state cannot affect a reader. Fetching
         it could only produce a drift or challenge failure on a link nobody can see — which is
         the same defect class as failing the publish because an optional layer aged out. Skip. */
      if (demoted.has(key)) {
        liveSkippedDemoted++;
        ok(`live re-fetch skipped  ${key}  (demoted for age; not published, so its live state cannot affect the page)`);
        continue;
      }
      liveFetched++;
      const got = await fetchArticleVerified(s.resolvedUrl);

      if (!got.ok) {
        /* THE CRITICAL DISTINCTION, now drawn in two places rather than one. A source that
           did not answer is the network's fault; a source that answered "there is nothing
           here" is the evidence's. Only the first is excusable, and the comment that used to
           sit here claimed both were. For DOI-bearing journal articles we still try an
           independent open API first — corroboration is positive evidence and outranks a
           dead publisher URL either way. */
        const cause = got.failure.kind === 'challenge' ? `a bot challenge — ${got.failure.detail}` : got.failure.detail;
        const unresolved = tail => {
          if (got.failure.terminal) {
            fail(`${key}: THE CITED ARTICLE IS GONE — ${cause} after ${got.attempts} attempt(s)${tail}. A 404, a 410 or an unresolvable host is a fact about the EVIDENCE, not about the network: retrying cannot make an article exist, so this is not deferrable as infrastructure and the citation must be re-reviewed or replaced`);
          } else {
            infrastructure.push(`${key}: could not verify (source returned ${cause} after ${got.attempts} attempts)${tail}`);
          }
        };
        const doi = doiFromUrl(s.resolvedUrl, s.headline);
        if (doi) {
          try {
            const pmc = await corroborateViaEuropePmc(doi, s.quote);
            if (pmc.ok && pmc.quoteFound) {
              ok(`live UNREACHABLE (${got.failure.detail}) but CORROBORATED independently via Europe PMC  ${key}  DOI ${doi}  ${pmc.journal}  ${pmc.firstPublicationDate}`);
              continue;
            }
            if (pmc.ok) {
              unresolved(`; Europe PMC confirmed the record (${pmc.journal}, ${pmc.firstPublicationDate}) but the quote is drawn from the full text, not the abstract, so it could not be re-attested`);
              continue;
            }
            unresolved(`; Europe PMC fallback also unavailable (${pmc.detail})`);
            continue;
          } catch (err) {
            unresolved(`; Europe PMC fallback threw ${err.message}`);
            continue;
          }
        }
        unresolved('');
        continue;
      }

      const ex = got.extracted;
      if (!ex.headline) fail(`${key}: headline could not be extracted from the live page`);
      else if (collapse(ex.headline) !== collapse(s.headline)) {
        fail(`${key}: HEADLINE DRIFT — stored "${collapse(s.headline)}" but live page now says "${collapse(ex.headline)}"`);
      }

      if (!quotePresent(ex.mainText, s.quote)) {
        fail(`${key}: the reviewed supporting quote is no longer present verbatim in the live article`);
      }

      if (ex.publishedAt && ex.publishedAt.slice(0, 10) !== s.publishedAt.slice(0, 10)) {
        fail(`${key}: DATE DRIFT — stored ${s.publishedAt.slice(0, 10)}, live page now reports ${ex.publishedAt.slice(0, 10)}`);
      }
      ok(`live OK  ${key}  ${s.publishedAt.slice(0, 10)}  ${collapse(s.publisher).split(' | ')[0]}${got.attempts > 1 ? `  (cleared after ${got.attempts} attempts)` : ''}`);
    }
    const totalSources = Object.keys(sources).length;
    if (liveFetched) {
      ok(`live re-verification covered ${liveFetched} of ${totalSources} source(s) — ${liveSkippedDemoted} skipped as demoted (absent from signals.json) — headline, verbatim quote and publication date were re-read from the live article for every covered source [NUMERATOR = reviewed ledger sources RE-FETCHED this run; DENOMINATOR = the reviewed ledger, which demotion never shrinks. Compare the NUMERATOR only, and never against a signals.json ROW count]`);
    } else {
      ok(`live re-verification is INERT on this run: 0 of ${totalSources} source(s) were fetched (${liveSkippedDemoted} demoted, none published), so a green result here establishes NOTHING about drift — no live article was read`);
      inertAxes.push('live re-verification');
    }
  }

  // ---- RENDER GATE ---------------------------------------------------------------------
  /* EVERY FIGURE IN THIS FILE IS ABOUT signals.json, NOT ABOUT THE PAGE. app.js publishes the
     currency layer only while hasCompleteSignalCoverage() holds and empties it to {} otherwise,
     so the demotion, freshness and coverage numbers below can all be exactly right about the
     artefact while a reader sees no currency evidence at all. This gate opens no browser, so
     that state is invisible to it by construction. The cheapest NECESSARY conditions of the
     predicate are therefore read straight out of the artefact. The predicate itself is
     deliberately NOT reimplemented — a second copy of a function this file does not own drifts
     silently — so a pass here is NECESSARY, NOT SUFFICIENT: verify-site.js and
     verify-observatory.js remain the only instruments that count rendered cards. */
  /* Anchors are IDENTIFIERS WITH A CLOSING BOUNDARY, not substrings. A bare .includes() is
     satisfied by any rename that merely APPENDS — 'hasCompleteSignalCoverageV2' contains
     'hasCompleteSignalCoverage' — so a prefix match would survive the exact edit it exists to
     detect, on all three anchors at once. Measured: a suffix rename left every anchor matching
     and this check silently green. */
  const RENDER_ANCHORS = [
    ['function hasCompleteSignalCoverage(', /function\s+hasCompleteSignalCoverage\s*\(/],
    ['signalCoverageReady = hasCompleteSignalCoverage(', /signalCoverageReady\s*=\s*hasCompleteSignalCoverage\s*\(/],
    ['currencySignals = signalCoverageReady &&', /currencySignals\s*=\s*signalCoverageReady\s*&&/],
  ];
  const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const anchorLines = [];
  const missingAnchors = [];
  for (const [label, re] of RENDER_ANCHORS) {
    const m = appSrc.match(re);
    if (!m) { missingAnchors.push(label); continue; }
    // Line numbers are REPORTED, never asserted: a located number helps a reader navigate,
    // a pinned one is still a number after the unrelated edit that invalidates it.
    anchorLines.push(`${label.replace(/\s*[({].*$/, '')} @${appSrc.slice(0, m.index).split('\n').length}`);
  }
  /* THE ARTEFACT CONDITIONS ARE EVALUATED UNCONDITIONALLY, NOT INSIDE THE ANCHOR RESULT. They are
     facts about signals.json and nothing in app.js can change them, so nesting them under a
     readable model would let an UNREADABLE MODEL SUPPRESS A REAL SHUT GATE — one fault masking
     another, inside the check written for a masking class. Both conditions can fire together and
     both are reported. The anchor result only qualifies what a PASS is worth. */
  const searchIds = signals.search && typeof signals.search === 'object' ? Object.keys(signals.search).length : 0;
  const embedIds = signals.embeds && typeof signals.embeds === 'object' ? Object.keys(signals.embeds).length : 0;
  const shut = [];
  if (signals.sourceFresh !== true) shut.push(`sourceFresh is ${JSON.stringify(signals.sourceFresh)}, not true`);
  if (!embedIds) shut.push('embeds is absent or empty');
  if (searchIds) shut.push(`${searchIds} search id(s) present`);
  if (shut.length) {
    fail(`render gate SHUT (${shut.join('; ')}): app.js sets currencySignals = {} on this artefact, so every count in the report below is true of signals.json and FALSE OF THE PAGE — the layer can be perfect in the file and absent for every reader`);
  }
  if (missingAnchors.length) {
    /* Fail CLOSED. A stale model that keeps returning green is worse than no model at all. */
    fail(`render gate model is UNREADABLE: app.js no longer contains ${missingAnchors.map(a => `'${a}'`).join(' or ')} — ${shut.length
      ? 'the SHUT verdict above is derived from signals.json alone and stands unaffected'
      : `the artefact conditions (sourceFresh === true, ${searchIds} search id(s), ${embedIds} embed id(s)) do pass, but with the model unreadable that carries NO CLAIM ABOUT THE PAGE`} — re-derive it before its result means anything`);
  } else if (!shut.length) {
    ok(`render gate is OPEN on its cheapest NECESSARY conditions (sourceFresh === true, 0 search id(s), ${embedIds} embed id(s)) so the signals.json figures below can reach the page — NECESSARY, NOT SUFFICIENT: hasCompleteSignalCoverage() is deliberately not reimplemented here, and verify-site.js / verify-observatory.js are the gates that count rendered cards [constructs located in app.js at ${anchorLines.join(', ')}]`);
  }

  // ---- REPORT --------------------------------------------------------------------------
  /* THREE POPULATIONS ARE IN PLAY AND THEY ONLY COINCIDE WHILE NOTHING IS DEMOTED: the reviewed
     ledger (which demotion never shrinks), signals.json (which it does), and the rendered page
     (which the render gate can empty independently of both). Until the first age-out every one
     of these numbers is the same under all three readings, so a label naming the wrong one is
     indistinguishable from a correct one — and becomes wrong silently, on a schedule, on the
     single day the layer changes. Each line therefore states which population it counted.
     NOTHING HERE MAY CLAIM THE PAGE: this gate never fetches it. */
  const citedInFile = Object.keys(published).length;
  const sourcesInFile = new Set(Object.values(published).flat().map(link => link.key)).size;
  const ledgerPredictions = Object.keys(mappings).length;
  const ledgerSources = Object.keys(sources).length;
  console.log('\ncurrency layer  [all counts are of signals.json — see RENDER GATE above]');
  console.log(`  predictions cited      ${citedInFile} of ${ids.size} in signals.json (reviewed ledger maps ${ledgerPredictions})`);
  const linksInFile = Object.values(published).flat().length;
  console.log(`  links / sources        ${linksInFile} link(s) across ${sourcesInFile} source(s) in signals.json (reviewed ledger maps ${linkCount} pair(s) across ${ledgerSources} source(s))`);
  console.log(`  X-only predictions     ${ids.size - citedInFile}`);
  console.log(`  demoted for age        ${demoted.size} of ${ledgerSources} ledger source(s) (ceiling ${MAX_AGE_DAYS}d) — X origin retained, publish proceeds`);
  /* Surface what is ABOUT to age out, so a scheduled run can refresh a reference while the
     existing one is still valid and there is never a gap. A rule the automation cannot see is
     a rule it will not follow, so the deadline is printed rather than left to be recomputed. */
  if (ageing.length) {
    console.log(`  approaching ceiling    ${ageing.length} source(s) within ${MAX_AGE_DAYS - REFRESH_AT_DAYS}d of demotion — REFRESH THESE NOW, while they are still valid:`);
    ageing.forEach(a => console.log(`      ${a}`));
  } else {
    console.log(`  approaching ceiling    none (refresh window opens at ${REFRESH_AT_DAYS}d)`);
  }
  console.log(`  freshness              ${Object.entries(buckets).map(([k, v]) => `${k} ${v}`).join(' | ')}`);
  notes.forEach(n => console.log(`  ok   ${n}`));

  if (problems.length) {
    console.error('\nFAILED');
    problems.forEach(p => console.error(`  - ${p}`));
    process.exit(1);
  }
  /* Reported AFTER genuine integrity problems, and with its own exit status, so a transient
     source outage is never mistaken for — or escalated to — an evidence fault. */
  if (infrastructure.length) {
    console.error('\nUNVERIFIABLE — INFRASTRUCTURE');
    console.error('  These citations could not be re-checked because the source did not serve its');
    console.error('  article. This is NOT evidence drift and no citation should be dropped for it.');
    infrastructure.forEach(p => console.error(`  - ${p}`));
    process.exit(EXIT_INFRASTRUCTURE);
  }
  if (inertAxes.length) {
    console.log('\nverify:currency PASSED BUT INERT');
    console.log('  Nothing failed, and nothing was verified on the following axes:');
    inertAxes.forEach(a => console.log(`    - ${a}`));
    console.log('  This is a legitimate state (an entirely demoted currency layer is honest, not broken)');
    console.log('  and publication PROCEEDS. It must not be recorded as a verified currency layer.');
    process.exit(EXIT_INERT);
  }
  console.log('\nverify:currency PASS');
}

main().catch(err => {
  if (problems.length) {
    console.error('\nFINDINGS RECORDED BEFORE THE INSTRUMENT FAILED (these are real and must not be discarded):');
    problems.forEach(p => console.error(`  - ${p}`));
  }
  if (notes.length) console.error(`\n${notes.length} check(s) had already passed before the failure; the run is INCOMPLETE and none of its counts are final.`);
  console.error('\nINSTRUMENT FAULT — verify-currency.js threw before completing. This is NOT an evidence');
  console.error('  fault and NOT a deferral: re-running will reproduce it. DISCARD EVERY FIGURE FROM THIS');
  console.error('  RUN, including any that looks right, and fix the instrument.');
  console.error(err && err.stack ? err.stack : err);
  process.exit(EXIT_INSTRUMENT);
});
