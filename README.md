# Post-AGI Planning

A living, data-driven civilization forecast and long-form guide to the post-AGI transition. The
REHOBOAM timeline spans **2026–2040** across six domains, plus an undated, dependency-gated
post-superintelligence horizon, and is published at [peterxing.com](https://peterxing.com).

## Evidence contract

Every prediction is accounted for in exactly one of three channels. A **cited** prediction carries
authoritative news or research published inside a 14-day **currency window**. Where nothing qualifies
inside that window, a **context** entry may carry the most recent genuinely-supporting article found at
any age — held to the identical relevance bar, verified by the same live fetch and verbatim quote, and
rendered with its true publication date and age so dated background can never be read as current
evidence. Everything else is published as an explicit **uncited** record carrying its reason and search
statement — never left blank, never padded with a weaker source, never stretched to improve the ratio.

Today that is **6 cited, 5 carrying dated background and 92 uncited of 103**, drawn from 6 distinct
publishers. Those numbers are generated rather than asserted: the page renders them from
`signals.json`, so they cannot drift from what actually shipped.

A citation must clear all of the following, at review time **and** again at publish time:

- live fetch of the URL, HTTP 200 on the resolved address after redirects;
- headline, publisher, byline and date extracted from the fetched page, not from a feed;
- an exact verbatim supporting quote located in that extracted text;
- a SHA-256 of the extracted main text re-checked against the reviewed hash;
- rejection of aggregators, shorteners, press-release mills and content farms;
- no auto-approval — every mapping is reviewed by a human before it can publish.

`refresh-signals.js` exits nonzero and leaves the last complete `signals.json` untouched if any of
this fails. Prediction search fallbacks are forbidden: `signals.search` must remain empty.

## Browser discovery (2026-08-18)

An uncited record used to say *"No authoritative source published in the last 14 days was found."*
That reads as a statement about the world, and it was partly a statement about the **transport**:
discovery reached publishers only through a fixed feed harvest, and every candidate was read with a
plain HTTPS GET. A publisher with no feed for the relevant section, or one that refuses non-browser
clients, was never seen — not judged and rejected, simply unreachable.

> if you can't match any news sources or x posts, try using computer use to scrape the information
> through browsing. include this in the daily automations

`browse-evidence.js` closes that gap by looking the way a reader looks — a real browser, on the
publishers' own on-site search pages — and `browse-transport.js` renders a candidate so a
JavaScript-only or challenge-walled article can be read at all. What it deliberately does **not**
do is make anything new admissible:

| Unchanged (imported whole) | Changed |
| --- | --- |
| GATE 1 curated subject + GATE 2 distinctive term, at `DEFAULT_MIN_SCORE` | what can be **reached** |
| source-quality gate, extraction chain, verbatim quote, text hash | how a page is **read** |
| the 14-day currency window, enforced at the producer | nothing |
| promotion into `news-evidence.js` stays a **human act** | nothing |

- **It cannot publish.** It writes proposals; nothing in the build reads that file. `verify-browse-evidence.js`
  asserts this rather than describing it.
- **It cannot admit the archive.** A publisher's site search reaches fifteen years of reporting,
  where the imported gates were built to rank a pool of *recent* feed items. Measured on the first
  working run: a 2011 primer on corporate valuation cleared both gates for a 2026 trillion-dollar
  valuation prediction. A **365-day discovery ceiling** now bounds the channel. It is a tightening,
  never a widening, and it is not the currency window — the context channel legitimately carries
  older background, but its published sentence is *"the most recent authoritative source found"*,
  and an article from the previous decade cannot make that sentence true.
- **Transport is declared, per source, and fails closed.** A reviewed row may declare
  `transport: "browser"`; anything else takes the ordinary fetch. The build opens a browser **only**
  if such a row exists, and refuses to verify one with a plain fetch it is declared to fail.
  Provenance then records `browser-render+quote-match`, so a browser-read citation is never
  indistinguishable from a fetched one.
- **The search surface is first-party.** Publishers' own search pages, every host already on the
  egress allow-list. Never a web search engine: its results page is exactly the aggregator hop the
  source-quality gate exists to refuse.

## X retirement (2026-08-13)

This site previously required exactly one reviewed **direct X (Twitter) evidence card** per
prediction, sourced from @peterxing's posts and reposts plus authoritative external X statuses, and
backed by a private Wayback/first-party/oEmbed archive corpus. **That contract is retired in full**,
at the site owner's instruction:

> remove all references to x posts and stop using the x api for the predictions — replace and add any
> references based on the latest news from the last 2 weeks instead

| Retired | Replaced by |
| --- | --- |
| `x-archive.js` — Wayback CDX discovery, first-party hydration, oEmbed cross-check | `news-evidence.js` — the reviewed, live-verified news ledger |
| `verify-peter-evidence.js`, `verify-archive-corpus.js`, `verify-external-evidence.js` | `verify-news-evidence.js`, `verify-currency.js` |
| `verify-id.js` — a live `cdn.syndication.twimg.com` call | deleted; network egress is now an allow-list (below) |
| `evidence-approvals.json` (sticky X ledger) and the `external-evidence.js` X statuses | asserted **empty**; a non-empty ledger fails publication |
| `peterTotal` / `peterAuthored` / `maxReuse` floors in `evidence-floors.json` | removed rather than zeroed — a floor of 0 reads as a *satisfied* gate |
| X API credentials and the private `pap-secrets` corpus | the build no longer names or opens that directory at all |

**The retirement is enforced by inversion, not by deletion.** Reinstating X is what fails now:

- `assertNoXIngestFiles()` fails the build if any retired X ingest file reappears — the previous
  invariant rested on a file's *absence*, which is not enforcement;
- the coverage, per-prediction and observatory verifiers assert **zero** X links, **zero**
  `from:peterxing` requirements and **zero** X-owned embeds;
- any embed claiming `evidenceOwner: "peterxing"` or `"external"` is rejected **by name**, so a
  reinstatement fails as a reinstatement rather than as a generic schema error;
- the retired X hosts are listed explicitly in the egress allow-list and refused with a reason.

Surviving references to X in this repository record the retirement itself. That is the intended end
state: state what went, and state what replaced it.

## How it works

```text
index.html ──loads──> styles.css + app.js
           ├─fetch──> predictions.json   (forecast source of truth)
           ├─fetch──> signals.json       (generated evidence + Reality Signals)
           └─fetch──> author.json        (About the Author)
                              ^
                              |
                  refresh-signals.js ──> news-evidence.js      (reviewed news ledger)
                                     ├──> currency-evidence.js (currency ledger)
                                     ├──> browse-transport.js  (browser re-read, if declared)
                                     └──> evidence-families.js (declared reuse families)

browse-evidence.js ──browses──> publishers' own search pages ──> proposals ──human review──> news-evidence.js
```

- **`predictions.json`** contains the probabilistic 2026–2040 forecast and the undated horizon.
- **`validate-predictions.js`** enforces schema plus portfolio coherence: exact/near duplicates,
  repeated valuation/science/AI-R&D endpoints, conventional career milestones after full automation,
  and unlabelled top-expert milestones after an earlier ungoverned ASI branch all fail publication.
  Similar later events must advance a threshold, scope, deployment stage, or branch.
- **`refresh-signals.js`** builds `signals.json`: it verifies every reviewed news citation live,
  publishes an uncited record for every prediction without one, and fails closed rather than
  approximating.
- **`news-evidence.js`** is the reviewed news ledger. Each entry binds a prediction to one article
  with its publisher, published date, date provenance, verbatim quote and text hash.
- **`currency-evidence.js`** is the reviewed currency ledger — the published half of a
  secondary layer of *newer* references. It is fed by two **operator-local** tools,
  `currency-harvest.js` and `currency-build-ledger.js`, which are deliberately *not* in this
  repository: each reads `currency-candidates.json`, a generated review intermediate, so
  publishing them would put a file here whose input nobody could fetch. They discover and stage
  candidates; only a human-reviewed entry ever reaches `currency-evidence.js`, which is published
  in full. A currency link must be **strictly later** (day precision)
  than the origin evidence it claims to refresh; one that is not is withheld and reported, because a
  same-day link cannot demonstrate anything. With origin evidence now always inside the 14-day
  window, this layer is legitimately empty and is reported as inert rather than as verified.
- **`evidence-families.js`** declares the only families within which reuse is compatible. A **source**
  is the resolved article URL, never the ledger row name: two reviewed rows quoting different
  sentences of one article are one source used twice.
- **`browse-evidence.js`** is the browser discovery channel described above. It runs against the
  predictions carrying **no** reviewed mapping, emits proposals only, and refuses (exit 6) rather
  than reporting an empty success. Like `currency-harvest.js` and `currency-build-ledger.js` it is
  **operator-local and deliberately not in this repository**: it imports `currency-match.js`, which
  reads `currency-candidates.json` — a generated review intermediate — so publishing it would put a
  file here whose input nobody could fetch. `verify-browse-evidence.js`, the executable proof that
  the channel cannot lower the bar, stays local **with its subject**, because a proof published
  without the thing it proves is unfalsifiable from the mirror.
- **`browse-transport.js`** *is* published, because `refresh-signals.js` imports it: it is the
  browser read itself, shaped as a drop-in for the plain fetch so discovery and publish-time
  re-verification cannot diverge. Its published behaviour is gated from the published set —
  `verify-news-evidence.js` refuses an unknown `transport`, and `verify-deploy-surface.js` holds
  every host it names to the egress allow-list.
- **`evidence-floors.json`** is a committed, public-safe monotonic ratchet. Environment variables may
  tighten a gate but can never loosen one, and lowering a registered value is a reviewed manual edit.
- **`pipeline-lock.js`** is a crash-safe advisory lock. Guarded entry points claim the tree before
  their first read, so nothing verifies or publishes from a half-applied state. A scheduled run that
  finds a live holder exits 75 = DEFERRED: it publishes nothing and never force-breaks a live lock.
- **`index.html`**, **`styles.css`** and **`app.js`** are the cacheable static shell. Forecast data is
  never duplicated inline; a missing sidecar produces an explicit unavailable state.
- **`author.json`** drives the daily-refreshed About the Author section.

## Boundaries

Both of the tree's external boundaries are **allow-lists**, because both were previously fail-open.

- **Deploy surface** — `.vercelignore` excludes everything with `*` and then re-includes exactly the
  public files. `verify-deploy-surface.js` simulates those rules against the real on-disk inventory,
  so a newly added file is caught automatically rather than remembered.
- **Network egress** — every `http(s)` host named anywhere in the tree's JavaScript must appear in
  `ALLOWED_EGRESS_HOSTS`. Adding a publisher is a one-line reviewed edit; an undeclared host fails
  closed. Retired X hosts are listed separately and refused with a stated reason. This exists because
  the X API is not on `x.com` — it was on `cdn.syndication.twimg.com`, and a deny-list built from the
  hosts anyone happened to think of did not see it.

Credentials and any private material stay outside the repository and are never served, deployed or
committed.

## Mission-control workspace

The dashboard records four **planning activities**, a self-reported checklist and a prediction
watchlist. These are completion records, not a scientific readiness score. Reading is recorded only
with the reader's explicit confirmation; selecting a preparation step does not mean it was performed.
The versioned `pap-mission-control:v1` browser-storage record is never sent to a server. Unavailable,
corrupt or unsupported storage is labelled session-only without overwriting the old record. Reset
requires confirmation and affects only this workspace's planning data.

The observation desk keeps published probabilities separate from assessed trajectory. News and X
presence never determine direction. In the absence of a reviewed measurement and criterion, the
desk says **Trajectory not yet assessed**. A saved forecast retains its original content identity
and observation snapshot; reused IDs, removed forecasts and changed observations are surfaced
rather than silently treated as the same forecast.

### Published updates, not real-time upstream ingestion

While visible, the reader checks the existing same-origin JSON artifacts every five minutes, with
a manual check, a 12-second timeout, cancellation on hiding and exponential backoff capped at
30 minutes. It retains the last valid bundle on errors and defers applying updates while the reader
or an evidence control has focus. Updates patch evidence rather than rebuilding timeline or reader
containers. The displayed request duration measures the browser round trip only, **not** how fresh
the underlying news is. The daily operator-side collection/review/publication schedule is unchanged.

`signals.forecastVersion = { schemaVersion: 1, sha256 }` binds the bundle to the SHA-256 of
`JSON.stringify(JSON.parse(predictions.json))`. The producer emits it on every build. The client
rejects mismatches and older bundles; a changed forecast requires an explicit reload, never a
silent probability update. The redesign added this binding to the existing artifact without changing
its source dates, review dates or published timestamp. A browser check cannot advance those dates.
Both publication and collection must be within 36 hours for the freshness label; article timestamps
and date-only review records retain their original precision.

An optional future `signals.observations` layer must declare `schemaVersion: 1`,
`forecastSha256` matching the same fingerprint, and an `items` map of prediction IDs to observation
arrays. Every observation requires `reviewed: true`, `reviewedBy`, `reviewedAt`, a `direction`
of `supporting`, `mixed` or `challenging`, `criterion: { id, version, description }`,
`measurement: { value, unit, observedAt }`, `source: { name, url, publishedAt, fetchedAt }`,
`rationale` and `limitations`. Conflicting directions display as mixed. Invalid or absent records
remain unassessed. This is a rendering contract, not an automated assessor or a connected feed;
no observation records were invented or added in the redesign.

### Connected METR capability instrument

`npm run refresh:metr` collects the primary
[METR v1.1 YAML](https://metr.org/assets/benchmark_results_1_1.yaml). The existing daily contract
calls it before `refresh-signals.js`; the latter validates and preserves the independent
`signals.capabilities.metr` layer on every build. It never adds a news citation, changes news
accounting/timestamps, edits a forecast or asserts a trajectory verdict.

The unit is **human-expert minutes**, at **50% or 80% task success**, with **95% confidence
intervals**. Reviewed source: the [official chart implementation](https://metr.org/assets/js/time-horizon-chart.js)
divides each horizon/interval by 60 to display hours and labels the tooltip "95% CI".
YAML does not declare a unit, so this is an explicit version-pinned adapter contract, not a
guessed field. [METR's methodology](https://metr.org/time-horizons/) limits the interpretation
to primarily self-contained software, ML and cybersecurity tasks. Estimates above 16 hours
are unreliable with the current task suite. These are neither autonomous runtimes nor proof
of general AGI or all-job automation.

The normalized payload retains exact source numeric values, model identifiers/release dates,
scaffolds, task revisions and the response SHA-256. It excludes legacy v1.0 rows from v1.1
comparisons. The context-only relation to 2026-0 is pinned to its exact text hash and full
forecast fingerprint; it covers software-task capability, not human review, persistent monitored
operation or safeguards. No criterion resolving that composite forecast is assigned. All other
forecasts remain unrelated, and every whole-forecast trajectory remains unassessed.

Source checks and successful 200 fetches have separate timestamps. A 304 advances check/health,
not source dates or snapshots. Model release is not evaluation/publication time; those dates
remain null because this dataset does not supply them. HTTP Last-Modified is labelled as a
file timestamp only. Two successful 200 snapshots are required for site change history;
304 does not invent one. Task revision or scaffold changes prevent like-for-like comparisons.

The collector uses exact-URL redirect approval, a 256 KiB body limit, 12-second requests,
conditional ETag/Last-Modified, up to three attempts and persisted Retry-After cooldowns.
Malformed/version/unit/interval failures never replace last-good data. Collector exit 10 reports
an unavailable/refused source and atomically saves explicit health plus retained data; daily
news collection continues. Exit 75 still means interlock deferral and stops the run. Other
collector errors fail closed. No raw cache, secrets, new served file, cloud resource or scheduler
was introduced: replay state is the normalized layer already mirrored in signals.json.
The pinned `yaml` parser and `package-lock.json` support `npm ci` in the source mirror.
`npm run verify:metr` exercises schema, transport, dates, retention and UI controls.

Collection is daily and source releases are periodic, not real-time. Browser polling still
retrieves only the latest published artifact. ClinicalTrials.gov remains unconnected.

### Proposed collection adapters (not enabled)

| Source | Bounded collection proposal | What it could measure | What it cannot establish |
| --- | --- | --- | --- |
| ClinicalTrials.gov | Check its version/data timestamp daily, then fetch only curated NCT IDs when the source changes. Deduplicate by NCT ID plus registry update version. | Registered trial phase/status and posted results for the exact intervention under review. | Clinical efficacy from registration alone, or regulatory approval from trial phase. |
| EIA / BLS / ABS | Select specific series and their actual release calendar first; collection must not outrun publication. EIA requires a separately approved free key; no key or adapter was added. | Geography-specific capacity, electricity demand or employment, with units and revisions kept distinct. | That capacity equals demand, or that an employment movement was caused by AI. |

An adapter should preserve a last-good observation on HTTP errors, honour Retry-After, use bounded
exponential backoff, and retain source-specific error and last-success timestamps. A 304 response
advances `checkedAt`, not the measurement's `observedAt` or the publisher's date. Deduplicate news
by canonical story URL, and measurements by source ID, metric, release/version and observation
period; syndication and reposts are not independent confirmations.

Before promotion, a reviewer must bind the metric (unit, geography, population and uncertainty) to a
versioned criterion for an exact prediction fingerprint, explain supporting **and** conflicting
observations, and state what is still missing. Keep original publication, retrieval, measurement and
review timestamps separate. A source-specific expected update cadence determines staleness; an
outage does not change direction, and a missing measurement is unknown, not off-track. Publish the
reviewed normalized records through the existing `signals.json`/allow-listed pipeline only after its
gates pass. Raw collection remains operator-local and cannot rewrite authored probabilities.

These remaining adapters are proposals, not background jobs. The present
UI can discover a *published* update on its next visible-page check; the time from upstream release
to reviewed publication remains governed by collection, review and deployment, not the browser
request duration. No additional scheduler or paid provider access has been enabled.

The existing UI runner includes the mission tests:

```powershell
node verify-observatory.js http://127.0.0.1:8787 --mission-only
```

Optional `PAP_UI_ARTIFACT_DIR` saves responsive screenshots outside the public tree.
`PAP_CONTENT_BASELINE` compares immutable-content snapshots during a preserve-content redesign.

## Local commands

```powershell
npm install
npm run validate
npm run refresh
npm run verify:matcher
npm run verify:coverage
npm run verify:news
npm run verify:currency
npm run verify:browse
npm run verify:surface
npm run serve
```

Browser discovery is run on demand (and daily), never as part of the build:

```powershell
npm run browse:report                                  # which predictions carry no mapping
npm run browse -- --limit=12 --searches=6              # propose, for review only
```

In a second terminal, against the local server:

```powershell
npm run verify
npm run verify:predictions
npm run verify:reality
npm run verify:author
npm run verify:ui
npm run verify:performance
npm run verify:interlock
```

`npm run verify:currency` exits **70** when the currency layer is entirely demoted. That is
`PASSED BUT INERT`: nothing failed, nothing was verified, publication proceeds, and it must not be
recorded as a verified currency layer. `npm run verify:surface:live` probes the production domains.

## Deploy

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy.ps1
```

There is no build step. Vercel serves the split HTML/CSS/JS shell and the JSON sidecars as static
files. Production is a Vercel **Git-integration** deployment, so the repository mirror is the deploy
surface and the repository copy of `.vercelignore` is the live gate.

## Security

- Credentials are loaded from outside the repository and are never served or committed.
- Raw caches, debug output, logs, `.vercel`, `.pipeline.lock` and `node_modules` are excluded from
  GitHub and refused by `server.js`.
- `server.js` is default-deny and serves only the site, the public JSON sidecars and static assets.

See `REVISE-PREDICTIONS.md` for the forecast revision rules.
