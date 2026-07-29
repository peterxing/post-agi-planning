# Post-AGI Planning

A living, data-driven civilization forecast and long-form guide to the post-AGI transition. The
REHOBOAM timeline spans **2026–2040** across six domains and is published at
[peterxing.com](https://peterxing.com).

Every individual prediction must have exactly one reviewed direct X evidence card. The matcher
prefers a defensible post/repost observed in
[@peterxing](https://x.com/peterxing)'s activity, then retains a reviewed authoritative external post
labeled as direct, scenario, or leading-indicator evidence. Source freshness is tracked separately
from evergreen evidence age. `refresh-signals.js` exits nonzero and leaves `signals.json` unchanged
unless direct coverage is complete and `signals.search` is empty.

## How it works

```text
index.html ──loads──> styles.css + app.js
           ├─fetch──> predictions.json   (forecast source of truth)
           └─fetch──> signals.json       (generated X matches + Reality Signals)
                              ^
                              |
                  refresh-signals.js ──> x-archive.js
                                           ├─ Wayback CDX ID discovery
                                           ├─ X first-party tweet-result hydration
                                           └─ X oEmbed authorship cross-check
```

- **`predictions.json`** contains the probabilistic 2026–2040 forecast.
- **`validate-predictions.js`** enforces schema plus portfolio coherence: exact/near duplicates,
  repeated valuation/science/AI-R&D endpoints, conventional career milestones after full
  automation, and unlabelled top-expert milestones after an earlier ungoverned ASI branch all fail
  publication. Similar later events must advance a threshold, scope, deployment stage, or branch.
- **`refresh-signals.js`** expands the forecast into one matcher per event. Literal scoring is
  supplemented by a bounded concept ontology for semantically equivalent evidence (such as
  tape-out/semiconductors, physicians/health, FSD/robotics, and UHI/dividends). Claim-specific facet
  guards remain mandatory for literal, semantic, hybrid, and family matches. Assignment maximizes
  unique reviewed posts first, then permits reuse only inside a declared compatible evidence family
  or reviewed threshold/scenario series. Publication fails when one status supports more than 10
  predictions.
- **`x-archive.js`** discovers Peter activity IDs through fully paginated Wayback CDX queries for
  both `twitter.com`/`x.com` and both handle case variants. It merges API-era private history and
  public historical signal bundles, numerically stratifies IDs across 2015–2026, hydrates through X's
  first-party per-status endpoint at least 600 ms apart, cross-checks through X oEmbed, and stores the
  deduplicated authored/quote/reply/repost corpus only under `pap-secrets`.
- **`evidence-families.js`** declares the only families within which threshold-series reuse is
  compatible. Cross-family reuse fails publication.
- **`evidence-approvals.json`** is the public-safe, sticky reviewed prediction/post-pair ledger. Each
  approval is bound to the exact prediction text and retains public provenance plus review and
  verification dates. New automatic candidates cannot self-approve, and publication fails below the
  reviewed 24-mapping Peter floor and 10-mapping Peter-authored floor.
- **`external-evidence.js`** is the reviewed authoritative-source ledger. It stores only public-safe
  status metadata, source-quality classification, scenario/leading-indicator labels, rationale, and
  compatible reuse groups.
- **`verify-signal-matcher.js`** runs positive and negative regression fixtures for the concept
  matcher, including J-space vs off-world space, building permits vs compute permits, market cap vs
  compute caps, political vs electrical power, and quantitative labor thresholds.
- **`signals.json`** is written only at complete direct-only coverage. `signals-debug.json`
  remains local and records source freshness, historical span, missing direct IDs, reviewed mappings,
  source-failure class, guard rejections, and reuse audits without storing the raw activity corpus.
- **`index.html`**, **`styles.css`**, and **`app.js`** form the cacheable static shell. Forecast data is
  not duplicated inline; a missing sidecar produces an explicit unavailable state.
- **`author.json`** drives the daily-refreshed About the Author section.

## Data-source safety

Bulk profile retrieval is not a publication dependency: the former nitter/RSS and legacy syndication
paths are unavailable, and X API quota/auth/plan failures are diagnostic only. The durable chain is:

1. Wayback CDX activity-ID discovery, fully paginated across both hosts and handle case variants.
2. Existing private API-era history and public historical `signals.json` IDs.
3. X first-party `tweet-result` hydration for public status IDs, paced at least 600 ms.
4. X oEmbed cross-check of original authorship and Peter's activity relationship.
5. Manual prediction/status approval with strict concept and facet guards.

Reviewed evergreen evidence age is separate from the current verification sweep. Every publish
re-hydrates all selected original statuses and cross-checks their authors; deleted/protected records
fail closed. `signals.sourceStatus`, `signals.sourceAttempts`, and the UI expose the archive-verified
chain and any X API diagnostic failure.

Raw activity and credentials stay outside the repository.

## Local use

```powershell
npm install
npm run validate
npm run refresh
npm run verify:matcher
npm run serve
```

In a second terminal:

```powershell
npm run verify
npm run verify:predictions
npm run verify:reality
npm run verify:author
npm run verify:ui
npm run verify:performance
npm run verify:coverage
npm run verify:archive
npm run verify:peter
npm run verify:external
```

`npm run refresh:archive` advances a cache-aware 120-status verification batch.
`X_ARCHIVE_BACKFILL=1 X_ARCHIVE_HYDRATE_LIMIT=400 node refresh-signals.js` imports historical public
signal versions and advances a larger, numerically stratified batch. `X_ARCHIVE_DISCOVERY_FORCE=1`
refreshes every Wayback page. `X_SKIP_API=1` proves publication does not depend on authenticated X.
For reviewed external-source research, `node x-archive.js --account=HANDLE --hydrate=120` uses the
same private Wayback/first-party/oEmbed chain without adding anything to the public ledger.
`npm run review:candidates` emits ID-only, strict-guard candidate diagnostics; inspect an individual
public post with `node review-evidence-candidates.js --show-public=STATUS_ID` before editing an
approval. Candidate generation never edits either evidence ledger.

## Deploy

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy.ps1
```

There is no build step. Vercel serves the split HTML/CSS/JS shell and JSON sidecars as static files.

## Security

- Credentials are loaded from `C:\Users\peterxing\pap-secrets\.env` and are never served or
  committed.
- Raw caches, debug output, logs, `.vercel`, and `node_modules` are excluded from GitHub.
- `server.js` is default-deny and serves only the site, public JSON sidecars, and static assets.

See `X-API-SETUP.md` for X authentication and `REVISE-PREDICTIONS.md` for forecast revision rules.
