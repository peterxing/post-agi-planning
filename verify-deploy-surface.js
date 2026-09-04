#!/usr/bin/env node
'use strict';
if (require.main === module) require('./pipeline-lock').guard('verify:surface');

/*
  verify-deploy-surface.js — proves the PUBLIC DEPLOY SURFACE is fail-closed.

  Why this exists
  ---------------
  Production is served by the Vercel Git integration from github.com/peterxing/
  post-agi-planning, so the repository mirror IS the deploy surface. The gate that
  decides what is published is .vercelignore. It used to be a DENY-list keyed to
  specific filenames, which meant any file matching no pattern was served BY
  DEFAULT. That is fail-open, and it was the only fail-open gate in a pipeline
  where everything else fails closed: news-evidence.js became publicly readable the
  moment it was created, purely because nobody added a line for it.

  .vercelignore is now an ALLOW-list: "*" excludes everything and each "!" line
  re-includes exactly one approved public file. This verifier enforces that shape,
  simulates the ignore rules against the real on-disk inventory so a NEWLY ADDED
  file is caught automatically rather than remembered, and — with --live — asserts
  the actual surface on both production domains.

  Usage
    node verify-deploy-surface.js                     static gate only (fail-closed)
    node verify-deploy-surface.js --live              static + both production domains
    node verify-deploy-surface.js --live https://host/ static + explicit base URLs

  Exit 0 pass · 1 fail.
*/

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const DIR = __dirname;
const SITE = 'C:\\Users\\peterxing\\pap-site';
const IGNORE_FILE = path.join(SITE, '.vercelignore');

const PRODUCTION = ['https://peterxing.com', 'https://post-agi-planning.vercel.app'];

// The approved public surface, in the exact order .vercelignore must re-include it.
const PUBLIC_SURFACE = [
  'index.html',
  'app.js',
  'styles.css',
  'signals.json',
  'predictions.json',
  'author.json',
  'vercel.json',
  'LICENSE',
];

// Uploaded so Vercel can read it as configuration, but consumed rather than
// served: it must answer 404 in production like any other non-public file.
const CONFIG_NOT_SERVED = new Set(['vercel.json']);

// Explicit trailing denies are allowed only for these highest-risk names. "*"
// already excludes them; listing them again is defence in depth and keeps
// verify-interlock.js's ".vercelignore excludes .pipeline.lock" assertion true.
const ALLOWED_TRAILING_DENIES = new Set(['.env*', '.vercel', '.pipeline.lock']);

/* ---------------------------------------------------------------------------------------------
   EGRESS ALLOW-LIST — the same rule as the deploy surface, pointed outward.

   The deploy surface was fail-OPEN until it became an allow-list: anything matching no deny pattern
   was served by default. Network egress had the identical shape — a host nobody had thought to
   forbid was callable by default — and it hid a live X API call on cdn.syndication.twimg.com for a
   full day, because every X search anyone ran looked for x.com and twitter.com.

   So this is default-DENY. Every https? host named anywhere in the tree's own JavaScript must appear
   below. Adding a publisher is a one-line reviewed edit; that IS the review event. A host nobody
   declared fails closed without anyone having had to predict it. */
const ALLOWED_EGRESS_HOSTS = new Set([
  // local verification and the two production domains
  '127.0.0.1', 'peterxing.com', 'post-agi-planning.vercel.app',
  // Reviewed 2026-09-05: first-party benchmark measurements, never news citations.
  'metr.org',
  // reviewed news + currency publishers (primary reporting, journals, labs, agencies, regulators)
  'arstechnica.com', 'feeds.arstechnica.com', 'arxiv.org', 'rss.arxiv.org', 'bair.berkeley.edu',
  'blogs.nvidia.com', 'deepmind.google', 'digital-strategy.ec.europa.eu', 'huggingface.co',
  'news.mit.edu', 'news.un.org', 'openai.com', 'research.google', 'spacenews.com',
  'spectrum.ieee.org', 'www.aisi.gov.uk', 'www.anthropic.com', 'www.bls.gov',
  'www.challengergray.com', 'www.ebi.ac.uk', 'www.eia.gov', 'www.esa.int', 'www.fda.gov',
  'www.federalreserve.gov', 'www.iea.org', 'www.imf.org', 'www.microsoft.com', 'www.nasa.gov',
  'www.nature.com', 'www.nih.gov', 'www.nist.gov', 'www.science.org', 'www.technologyreview.com',
  'www.theverge.com', 'www.who.int',
  /* REVIEWED EDIT 2026-08-17 — declared for the 2026-08-15 currency-harvest feed widening, which
     added the feeds but never declared their hosts and left the surface verifier failing closed for
     two days. That is the allow-list working as designed, not a defect in it. Every host below is a
     peer-reviewed journal, a primary news organisation, or a first-party government/agency source,
     which is the same bar the evidence contract already applies to a citation; none is an aggregator,
     syndicator, press-release mill or preprint server. Declared as DISCOVERY egress only: reaching a
     feed here never makes its contents admissible, which is still decided per-article by the fetch,
     quote-match and source-quality gates. */
  // peer-reviewed journals
  'www.cell.com', 'www.thelancet.com', 'www.nejm.org', 'www.pnas.org', 'journals.plos.org',
  'elifesciences.org', 'iopscience.iop.org',
  // primary news organisations
  'www.wired.com', 'feeds.npr.org', 'www.theguardian.com', 'feeds.bbci.co.uk', 'rss.nytimes.com',
  // first-party government, agency and institutional sources
  'www.sec.gov', 'www.darpa.mil', 'www.energy.gov', 'www.planetary.org',
  /* REVIEWED EDIT 2026-08-24 — declared for evidence promoted while closing the uncited channel at
     the site owner's instruction ("match it to the closest news article you can find online that
     points towards that trajectory"). CNBC is a primary news organisation with named editorial
     responsibility, which is the same bar every other publisher on this list meets; it is not an
     aggregator, syndicator, press-release mill or preprint server. Declared because two reviewed
     citations resolve there — AI-lab federal lobbying disclosures and the US–China intergovernmental
     AI talks — and an undeclared host fails this gate closed, which is the gate working. */
  'www.cnbc.com',
  /* REVIEWED EDIT 2026-08-25 — declared because deepmind.google, already on this list, CANONICALISES
     to blog.google: the Gemini Robotics ER 2 announcement fetched from deepmind.google resolves to
     blog.google, so the reviewed citation records that host and an undeclared one fails this gate
     closed. It is the same first-party publisher under its canonical name, not a new organisation
     and not an aggregator, syndicator, press-release mill or preprint server. Declaring the host
     never makes its contents admissible; that stays with the per-article fetch, quote-match and
     source-quality gates. */
  'blog.google',
  /* NEGATIVE fixtures. These exist so the news verifier can PROVE it rejects an aggregator, a
     shortener, a press-release mill and a fabricated URL. They are named in order to be refused. */
  'bit.ly', 'example.org', 'example-not-reviewed.test', 'news.google.com', 'www.prnewswire.com',
  // a neutral placeholder used in a usage example
  'host',
  /* REVIEWED EDIT 2026-08-26 — X PARTIALLY REINSTATED, AS A SUPPLEMENT ONLY.
     The owner instructed: "use my x api to supplement the prediction evidence based on the posts and
     reposts from me (@peterxing)". api.x.com therefore moves from RETIRED_EGRESS_HOSTS to this
     allow-list, because we are deliberately calling it again.
     WHAT DID *NOT* COME BACK, AND IS STILL REFUSED BELOW: X as an EVIDENCE medium. x.com and
     twitter.com remain retired as citation hosts; the syndication, oEmbed and widget endpoints
     remain retired; Wayback discovery remains retired. The reinstated call is one authenticated
     read of Peter's own timeline, whose output is published in a separate `xSignals` layer that
     carries no provenance fields and never enters `embeds`. verify-x-signals.js asserts that
     boundary and every X refusal added on 2026-08-13 still passes unchanged. */
  'api.x.com',
  /* REVIEWED EDIT 2026-09-03 — declared because feeds.bbci.co.uk, already on this list as a DISCOVERY
     feed, RESOLVES ITS ITEMS to www.bbc.co.uk: the reviewed citation for 2029-6 (the Bank of England
     governor's warning to the G20, promoted this run) records that article host, and an undeclared
     host fails this gate closed — which is the gate working, not a defect in it. It is the same
     first-party publisher already trusted for discovery, under the host where its articles actually
     live; BBC News is a primary news organisation with named editorial responsibility, which is the
     same bar every other publisher here meets, and is not an aggregator, syndicator, press-release
     mill or preprint server. Declaring the host never makes its contents admissible; that stays with
     the per-article fetch, quote-match and source-quality gates. */
  'www.bbc.co.uk',
]);

/* Named rather than merely absent, so the failure says WHY. Bare hostnames, so this declaration
   cannot itself trip the scanner that reads https? URLs. */
const RETIRED_EGRESS_HOSTS = new Map([
  /* x.com and twitter.com stay retired AS EVIDENCE HOSTS. The 2026-08-26 supplement reads Peter's
     own timeline through api.x.com (declared above) and publishes it as a labelled trajectory
     layer; it never fetches or cites an x.com article page, so naming x.com in the tree's
     JavaScript would still mean an X citation was being built. Permalinks rendered by app.js are
     constructed from a status id, not fetched, and app.js is scanned here like every other file. */
  ['x.com', 'X evidence retired 2026-08-13; api.x.com is allow-listed for the trajectory-signal supplement only'],
  ['twitter.com', 'X evidence retired 2026-08-13'],
  ['api.twitter.com', 'the X API was retired 2026-08-13'],
  ['api.x.com', 'the X API was retired 2026-08-13'],
  ['cdn.syndication.twimg.com', 'the X syndication API was retired 2026-08-13'],
  ['publish.twitter.com', 'the X oEmbed endpoint was retired 2026-08-13'],
  ['platform.twitter.com', 'the X widget script was retired 2026-08-13'],
  ['web.archive.org', 'Wayback activity discovery was retired with the X archive on 2026-08-13'],
]);

function assertEgressHosts() {
  const scanned = [];
  let filesRead = 0;
  for (const name of fs.readdirSync(DIR)) {
    if (!name.endsWith('.js')) continue;
    if (!fs.statSync(path.join(DIR, name)).isFile()) continue;
    const text = fs.readFileSync(path.join(DIR, name), 'utf8');
    filesRead++;
    for (const match of text.matchAll(/https?:\/\/([A-Za-z0-9.\-]+)/g)) {
      scanned.push([match[1].toLowerCase(), name]);
    }
  }
  /* TOTALITY. This sweep is a DETECTOR, not a roster — a host absent from `scanned` was not
     found, so an empty result and a clean result print the same reassuring sentence: "0 distinct
     host(s) named across the tree's JavaScript, all declared". Nothing distinguished a gate that
     examined everything and approved it from one that examined nothing. An input that could not be
     examined is an error, not a zero. */
  check(filesRead > 0, 'egress sweep read 0 JavaScript files; it cannot have verified anything');
  check(scanned.length > 0,
    `egress sweep read ${filesRead} JavaScript file(s) and found no http(s) host at all; the tree `
    + 'makes network calls, so this is an instrument fault, not a clean result');
  const seen = new Set();
  for (const [host, file] of scanned) {
    if (seen.has(`${host}|${file}`)) continue;
    seen.add(`${host}|${file}`);
    if (RETIRED_EGRESS_HOSTS.has(host)) {
      problems.push(`${file} names the retired host ${host} — ${RETIRED_EGRESS_HOSTS.get(host)}`);
    } else if (!ALLOWED_EGRESS_HOSTS.has(host)) {
      problems.push(`${file} names undeclared network host ${host}; egress is an allow-list, so add it `
        + 'to ALLOWED_EGRESS_HOSTS as a reviewed edit or remove the call');
    }
  }
  notes.push(`Egress allow-list: ${new Set(scanned.map(([h]) => h)).size} distinct host(s) named across `
    + `${filesRead} JavaScript file(s), all declared; ${RETIRED_EGRESS_HOSTS.size} retired host(s) `
    + 'explicitly refused. DECLARED LIMIT: .js only — hosts named in .ps1, .json, .html or .css are '
    + 'outside this sweep.');
}

const problems = [];
const notes = [];
function check(condition, message) {
  if (!condition) problems.push(message);
  return condition;
}

// ------------------------------------------------------------------- INVENTORY

// Directories whose contents must never be part of the publishable universe.
const SKIP_DIRS = new Set(['.git', '.vercel', 'node_modules']);

function rootFiles(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter(e => e.isFile()).map(e => e.name);
}

/*
  The publishable universe is everything that could plausibly end up in the
  deployed tree: the working source directory, the Vercel bundle directory, and
  the file names the GitHub publisher is allowed to mirror. Enumerating from disk
  is the point — a script added tomorrow appears here without anyone updating a
  list, so it is checked automatically instead of being remembered.
*/
function publisherAllowlist() {
  const text = safeRead(path.join(DIR, 'publish-github.ps1'));
  const names = new Set();
  for (const m of text.matchAll(/'([A-Za-z0-9._-]+\.(?:js|json|md|ps1|html|css)|LICENSE|\.gitignore|\.env\.example|\.vercelignore|_headers)'/g)) {
    names.add(m[1]);
  }
  return [...names];
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

// ------------------------------------------------------------- IGNORE MATCHING

/*
  A deliberately small .gitignore-subset matcher. The static shape check below
  guarantees .vercelignore only ever uses this subset (a bare "*", "!name"
  re-includes, and a fixed set of literal/prefix denies), so the simulation and
  the real Vercel behaviour cannot drift apart through an exotic pattern.
*/
function patternMatches(pattern, name) {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern === name;
  const rx = new RegExp('^' + pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
  return rx.test(name);
}

function parseIgnore(text) {
  return text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

function isExcluded(rules, name) {
  let excluded = false;
  for (const rule of rules) {
    const negated = rule.startsWith('!');
    const pattern = negated ? rule.slice(1) : rule;
    if (patternMatches(pattern, name)) excluded = !negated;
  }
  return excluded;
}

// ------------------------------------------------------------- STATIC GATE

const ignoreText = safeRead(IGNORE_FILE);
check(ignoreText.length > 0, `.vercelignore is missing or empty at ${IGNORE_FILE}`);
const rules = parseIgnore(ignoreText);

check(rules[0] === '*', '.vercelignore must start with a bare "*" so the surface is fail-closed (deny everything, then re-include)');

const reincluded = rules.filter(r => r.startsWith('!')).map(r => r.slice(1));
check(
  JSON.stringify(reincluded) === JSON.stringify(PUBLIC_SURFACE),
  `.vercelignore re-includes ${JSON.stringify(reincluded)} but the approved public surface is ${JSON.stringify(PUBLIC_SURFACE)}`,
);

const trailing = rules.slice(1).filter(r => !r.startsWith('!'));
for (const rule of trailing) {
  check(ALLOWED_TRAILING_DENIES.has(rule), `.vercelignore contains an unapproved extra rule "${rule}"; only ${[...ALLOWED_TRAILING_DENIES].join(', ')} may be repeated as explicit denies`);
}
for (const rule of trailing) {
  check(!PUBLIC_SURFACE.includes(rule), `.vercelignore denies "${rule}" after re-including it; the last matching rule wins and would break the site`);
}

// The fail-open regression test: an unknown, never-before-seen file must be
// excluded without anyone adding a rule for it.
for (const invented of ['zz-new-script.js', 'new-corpus.json', 'notes.txt', 'secrets.env', 'debug.log']) {
  check(isExcluded(rules, invented), `a newly added file "${invented}" would be PUBLISHED by default — the surface is still fail-open`);
}

// Every approved public file must survive the rules, or the site breaks.
for (const name of PUBLIC_SURFACE) {
  check(!isExcluded(rules, name), `approved public file "${name}" is excluded by .vercelignore and the site would break`);
}

// Simulate the rules against the real inventory.
const universe = [...new Set([...rootFiles(DIR), ...rootFiles(SITE), ...publisherAllowlist()])]
  .filter(n => !SKIP_DIRS.has(n))
  .sort();
const wouldPublish = universe.filter(n => !isExcluded(rules, n));
const unexpectedPublish = wouldPublish.filter(n => !PUBLIC_SURFACE.includes(n));
check(
  unexpectedPublish.length === 0,
  `these files would be published but are not on the approved public surface: ${unexpectedPublish.join(', ')}`,
);
notes.push(`Publishable universe scanned: ${universe.length} distinct names across pap-deploy, pap-site and the GitHub publisher allow-list.`);
notes.push(`Effective published set: ${wouldPublish.join(', ')}`);

// The repository mirror is the real deploy surface, so the copy the publisher
// ships must be the same file we just validated.
const publisher = safeRead(path.join(DIR, 'publish-github.ps1'));
check(/\$fromSite\s*=\s*@\([^)]*'\.vercelignore'/.test(publisher),
  'publish-github.ps1 must mirror .vercelignore from pap-site — the Git deployment reads the repository copy');

// ------------------------------------------------------------------ LIVE GATE

function head(url) {
  return new Promise(resolve => {
    const lib = url.startsWith('https:') ? https : http;
    const request = lib.request(url, { method: 'GET', headers: { 'user-agent': 'pap-verify-deploy-surface', 'cache-control': 'no-cache' } }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', () => resolve(0));
    request.setTimeout(20000, () => { request.destroy(); resolve(0); });
    request.end();
  });
}

async function pool(items, size, worker) {
  const results = new Array(items.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await worker(items[i]);
    }
  }));
  /* Completeness here is true BY CONSTRUCTION — pre-sized array, every index claimed exactly once,
     Promise.all propagating any rejection — so no caller need check it. That is precisely why this
     assertion is worth its two lines: by-construction guarantees are invisible to a reader and to
     any external audit, and they stop being true the moment someone rewrites this with `push` or
     swallows a worker rejection. The invariant is now checked rather than merely explained, so a
     future refactor that breaks it fails here instead of silently handing every caller a short
     population. */
  if (results.length !== items.length || results.some(entry => entry === undefined)) {
    throw new Error(`pool lost entries: ${items.length} in, `
      + `${results.filter(entry => entry !== undefined).length} out`);
  }
  return results;
}

async function assertLive(base) {
  const cb = Date.now();
  // Probe the full inventory, plus paths that must never exist regardless of disk state.
  const targets = [...new Set([...universe, '.pipeline.lock', '.env', '.vercel/project.json', 'signals-debug.json'])].sort();
  const statuses = await pool(targets, 6, async name => ({ name, status: await head(`${base}/${name}?cb=${cb}`) }));
  const served = new Set(PUBLIC_SURFACE.filter(n => !CONFIG_NOT_SERVED.has(n)));
  const reachable = [];
  let confirmedServed = 0;
  for (const { name, status } of statuses) {
    if (served.has(name)) {
      // vercel.json sets cleanUrls, so /index.html legitimately redirects to /.
      const ok = name === 'index.html' ? (status === 200 || status === 301 || status === 308) : status === 200;
      if (!ok) problems.push(`${base}/${name} must be served but returned ${status || 'no response'}`);
      else confirmedServed++;
    } else if (status === 200) {
      reachable.push(`${name} (${status})`);
    } else if (status !== 404 && status !== 403 && status !== 0) {
      problems.push(`${base}/${name} returned an unexpected ${status}; expected 404`);
    }
  }
  const rootStatus = await head(`${base}/?cb=${cb}`);
  check(rootStatus === 200, `${base}/ must serve the site but returned ${rootStatus || 'no response'}`);
  check(reachable.length === 0, `${base} exposes non-public paths: ${reachable.join(', ')}`);
  /* ABSENT IS NOT FAILED, the same shape found in the news gate's proof harness. A served file is
     only checked if its name reaches this loop, and `targets` is built from what EXISTS on disk
     plus a regex scrape of the publisher — `safeRead` returns '' silently, so a scrape that fails
     shrinks the roster with no signal at all. An approved public file missing from all three
     sources is never probed, pushes no problem, and leaves confirmedServed quietly short while the
     note below prints the shortfall as though it were an observation. The ratio was REPORTED and
     never CHECKED, so the reader was handed the discrepancy and the exit code was not. Today the
     gap is closed only by redundancy between the two trees; that is a coincidence of inventory, not
     a guarantee, and it is the file-missing-from-a-deploy-path case this gate exists for. Named,
     never counted: a count cannot tell you which file went unverified. */
  const unprobed = [...served].filter(name => !statuses.some(entry => entry.name === name));
  check(confirmedServed === served.size,
    `${base}: only ${confirmedServed} of ${served.size} approved public files were confirmed served`
    + `${unprobed.length ? `; never probed at all: ${unprobed.join(', ')}` : ''}`);
  notes.push(`${base}: ${targets.length} paths probed · document root ${rootStatus} · ${confirmedServed}/${served.size} approved public files served · ${reachable.length} unexpected reachable.`);
}

// ----------------------------------------------------------------------- MAIN

(async () => {
  const argv = process.argv.slice(2);
  const live = argv.includes('--live');
  const bases = argv.filter(a => /^https?:\/\//i.test(a)).map(a => a.replace(/\/+$/, ''));

  assertEgressHosts();

  if (live || bases.length) {
    for (const base of (bases.length ? bases : PRODUCTION)) {
      // eslint-disable-next-line no-await-in-loop
      await assertLive(base);
    }
  } else {
    notes.push('Live surface assertion skipped (pass --live or a base URL to run it).');
  }

  for (const note of notes) console.log(note);
  if (problems.length) {
    for (const problem of problems) console.error(`  FAIL ${problem}`);
    console.error(`RESULT: FAIL — ${problems.length} deploy-surface problem(s).`);
    process.exit(1);
  }
  console.log('RESULT: PASS — the deploy surface is an enforced allow-list; unknown files are excluded by default and no non-public path is reachable.');
})().catch(error => {
  console.error(`verify-deploy-surface: ${error && error.message}`);
  process.exit(1);
});
