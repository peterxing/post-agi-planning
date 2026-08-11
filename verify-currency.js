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
const EXIT_INFRASTRUCTURE = 75;
const infrastructure = [];

/*
 * Fetch an article, distinguishing "the source is protecting itself from bots" from "the
 * evidence changed". Retries clear a transient challenge in most cases; only a persistent
 * one is reported, and it is reported as an infrastructure fault, never as quote drift.
 */
async function fetchArticleVerified(url, attempts = 4) {
  let last = null;
  for (let i = 1; i <= attempts; i++) {
    let res;
    try {
      res = await fetchArticle(url);
    } catch (err) {
      last = { kind: 'network', detail: err.message };
      await new Promise(r => setTimeout(r, 700 * i));
      continue;
    }
    if (!res.ok) {
      last = { kind: 'http', detail: `HTTP ${res.status}` };
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
  const originChecked = { total: 0, dayPrecision: 0, thinnestDays: null };
  const published = signals.currency || {};
  for (const [pid, list] of Object.entries(mappings)) {
    for (const entry of list) {
      const s = sources[entry.source];
      if (!s) continue;
      const age = Math.round((now - new Date(s.publishedAt)) / 864e5);
      const livePublished = (published[pid] || []).some(c => c.key === entry.source);

      if (age > MAX_AGE_DAYS) {
        demoted.add(entry.source);
        if (livePublished) {
          fail(`${pid}: ${entry.source} is ${age} days old, past the ${MAX_AGE_DAYS}-day ceiling, yet is STILL PUBLISHED in signals.json — the age-out demotion did not take effect`);
        } else {
          ok(`demoted (not an evidence fault)  ${pid}  ${entry.source}  ${age}d > ${MAX_AGE_DAYS}d ceiling — absent from signals.json, X origin retained`);
        }
        continue;
      }

      // Within the ceiling, so it must actually be on the page it claims to be on.
      if (!livePublished && embeds[pid]) {
        fail(`${pid}: ${entry.source} is ${age} days old and within the ceiling, but is MISSING from signals.json currency — a reviewed reference silently failed to publish`);
      }
      if (age >= REFRESH_AT_DAYS) {
        ageing.push(`${pid}  ${entry.source}  ${age}d — expires in ${MAX_AGE_DAYS - age}d (${new Date(Date.now() + (MAX_AGE_DAYS - age) * 864e5).toISOString().slice(0, 10)})`);
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
    ok(`refresh relation enforced  ${originChecked.total} published link(s) postdate the X evidence they refresh; ${originChecked.dayPrecision} carry a day-precision origin and so must clear a strictly later day; thinnest margin ${originChecked.thinnestDays.toFixed(1)}d`);
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
    let discriminating = 0;
    for (const [pid, list] of Object.entries(published)) {
      for (const c of list) {
        const at = Date.parse(c.publishedAt);
        if (!Number.isFinite(at)) { fail(`${pid}: ${c.key} has an unparseable publishedAt (${c.publishedAt})`); continue; }
        const expected = Math.round((emittedAt - at) / 864e5);
        if (c.ageDays !== expected) {
          fail(`${pid}: ${c.key} emits ageDays ${c.ageDays}, but publishedAt ${c.publishedAt} against signals.updated ${signals.updated} gives ${expected} — publisher and verifier disagree on the definition of age`);
        }
        const band = bandOf(c.ageDays);
        if (c.freshness !== band) {
          fail(`${pid}: ${c.key} emits freshness "${c.freshness}", but its emitted ageDays ${c.ageDays} falls in ${band}`);
        }
        impliedHist[band]++;
        pinned++;
        if (Math.floor((emittedAt - at) / 864e5) !== expected) discriminating++;
      }
    }
    const coverageHist = signals.coverage && signals.coverage.currency && signals.coverage.currency.freshness;
    if (!coverageHist) {
      fail('coverage.currency.freshness is absent — the published freshness histogram cannot be checked against the links it summarises');
    } else if (JSON.stringify(coverageHist) !== JSON.stringify(impliedHist)) {
      fail(`coverage.currency.freshness ${JSON.stringify(coverageHist)} does not match the histogram implied by the emitted per-link ages ${JSON.stringify(impliedHist)}`);
    } else if (pinned) {
      ok(`emitted ages pinned  ${pinned} link(s) reproduce both ageDays and freshness from publishedAt against signals.updated, and the coverage histogram matches`);
    }
    /* A pin that both candidate definitions satisfy proves nothing on that run. Say so,
       rather than letting a vacuous pass read as a discriminating one. */
    if (pinned && !discriminating) {
      ok(`emitted-age pin is NOT discriminating today: every link's age is identical under round and floor, so this run could not detect a rounding drift`);
    } else if (pinned) {
      ok(`emitted-age pin discriminates on ${discriminating} of ${pinned} link(s) where round and floor differ — a rounding drift would fail here`);
    }
    /* Boundary proximity: within 12h of a band edge, publisher and verifier must agree on
       rounding or the histogram splits. Surfaced so a boundary-sensitive run is known in
       advance rather than diagnosed from a failed assertion afterwards. */
    for (const [pid, list] of Object.entries(published)) {
      for (const c of list) {
        const exact = (emittedAt - Date.parse(c.publishedAt)) / 864e5;
        const edge = [14, 30, 90, 365].find(e => Math.abs(exact - (e + 0.5)) < 0.5);
        if (edge !== undefined) {
          ok(`boundary-sensitive  ${pid}  ${c.key}  ${exact.toFixed(2)}d is within 12h of the ${edge}d band edge — rounding agreement is load-bearing on this run`);
        }
      }
    }
  }

  // ---- LIVE RE-VERIFICATION ------------------------------------------------------------
  if (OFFLINE) {
    ok('offline mode: skipped live re-fetch (not valid for publish)');
  } else {
    for (const [key, s] of Object.entries(sources)) {
      /* A demoted source is not published, so its live state cannot affect a reader. Fetching
         it could only produce a drift or challenge failure on a link nobody can see — which is
         the same defect class as failing the publish because an optional layer aged out. Skip. */
      if (demoted.has(key)) {
        ok(`live re-fetch skipped  ${key}  (demoted for age; not published, so its live state cannot affect the page)`);
        continue;
      }
      const got = await fetchArticleVerified(s.resolvedUrl);

      if (!got.ok) {
        /* THE CRITICAL DISTINCTION. The source did not answer with its article. That is the
           network's fault, not the evidence's. We do NOT say the quote vanished, we do NOT
           demote the citation, and we do NOT silently pass. For DOI-bearing journal articles
           we first try an independent open API before giving up. */
        const doi = doiFromUrl(s.resolvedUrl, s.headline);
        if (doi) {
          try {
            const pmc = await corroborateViaEuropePmc(doi, s.quote);
            if (pmc.ok && pmc.quoteFound) {
              ok(`live UNREACHABLE (${got.failure.detail}) but CORROBORATED independently via Europe PMC  ${key}  DOI ${doi}  ${pmc.journal}  ${pmc.firstPublicationDate}`);
              continue;
            }
            if (pmc.ok) {
              infrastructure.push(`${key}: could not verify (source returned ${got.failure.kind === 'challenge' ? 'a bot challenge' : got.failure.detail} after ${got.attempts} attempts); Europe PMC confirmed the record (${pmc.journal}, ${pmc.firstPublicationDate}) but the quote is drawn from the full text, not the abstract, so it could not be re-attested`);
              continue;
            }
            infrastructure.push(`${key}: could not verify (source returned ${got.failure.kind === 'challenge' ? 'a bot challenge' : got.failure.detail} after ${got.attempts} attempts); Europe PMC fallback also unavailable (${pmc.detail})`);
            continue;
          } catch (err) {
            infrastructure.push(`${key}: could not verify (${got.failure.detail}); Europe PMC fallback threw ${err.message}`);
            continue;
          }
        }
        infrastructure.push(`${key}: could not verify (source returned ${got.failure.kind === 'challenge' ? `a bot challenge — ${got.failure.detail}` : got.failure.detail} after ${got.attempts} attempts)`);
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
  }

  // ---- REPORT --------------------------------------------------------------------------
  console.log('\ncurrency layer');
  console.log(`  predictions cited      ${Object.keys(mappings).length} of ${ids.size}`);
  console.log(`  links / sources        ${linkCount} / ${Object.keys(sources).length}`);
  console.log(`  X-only predictions     ${ids.size - Object.keys(mappings).length}`);
  console.log(`  demoted for age        ${demoted.size} of ${Object.keys(sources).length} sources (ceiling ${MAX_AGE_DAYS}d) — X origin retained, publish proceeds`);
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
  console.log('\nverify:currency PASS');
}

main().catch(err => { console.error(err); process.exit(1); });
