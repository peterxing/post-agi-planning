# Post-AGI Planning

A living, data-driven civilization forecast and long-form guide to the post-AGI transition. The
REHOBOAM timeline spans **2026–2040** across six domains and is published at
[peterxing.com](https://peterxing.com).

Every individual prediction must have a reviewed, direct post/repost observed in
[@peterxing](https://x.com/peterxing)'s activity. The matching engine confirms a fresh authenticated
or public source, then searches a private deduplicated history built from supported X API pagination
and the project's public archives. Source freshness is tracked separately from the age of evergreen
evidence. `refresh-signals.js` exits nonzero and leaves `signals.json` unchanged unless direct
coverage is complete; prediction search fallbacks are prohibited.

## How it works

```text
index.html ──fetch──> predictions.json   (forecast source of truth)
           └─fetch──> signals.json       (generated X matches + Reality Signals)
                              ^
                              |
                  refresh-signals.js ──> x-client.js / live public RSS
```

- **`predictions.json`** contains the probabilistic 2026–2040 forecast.
- **`validate-predictions.js`** enforces schema plus portfolio coherence: exact/near duplicates,
  repeated valuation/science/AI-R&D endpoints, conventional career milestones after full
  automation, and unlabelled top-expert milestones after an earlier ungoverned ASI branch all fail
  publication. Similar later events must advance a threshold, scope, deployment stage, or branch.
- **`refresh-signals.js`** expands the forecast into one matcher per event. Literal scoring is
  supplemented by a bounded concept ontology for semantically equivalent evidence (such as
  tape-out/semiconductors, physicians/health, FSD/robotics, and UHI/dividends). Claim-specific facet
  guards remain mandatory. Assignment maximizes unique reviewed posts first, then permits reuse only
  inside a declared compatible evidence family.
- **`evidence-families.js`** declares the only families within which threshold-series reuse is
  compatible. Cross-family reuse fails publication.
- **`evidence-approvals.json`** is the public-safe reviewed prediction/post-pair ledger. New automatic
  candidates cannot publish until their specific pair is manually approved.
- **`verify-signal-matcher.js`** runs positive and negative regression fixtures for the concept
  matcher, including J-space vs off-world space, building permits vs compute permits, market cap vs
  compute caps, political vs electrical power, and quantitative labor thresholds.
- **`signals.json`** is written only at complete direct coverage. `signals-debug.json` remains local
  and records source freshness, historical span, missing IDs, reviewed mappings, and reuse audits
  without storing the raw activity corpus.
- **`author.json`** drives the daily-refreshed About the Author section.

## Data-source safety

The source order is:

1. Authenticated X API v2.
2. Live read-only public RSS profile.
3. A fresh local API/RSS snapshot no older than 36 hours.

Historical matching additionally uses private X API full-archive/topic-query results and previously
observed public project archives. A fresh source is still mandatory before publication.

The legacy public syndication feed is accepted only when its newest item is no more than 30 days
old. Raw activity and credentials stay outside the repository.

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
npm run verify:coverage
```

`X_SKIP_API=1 node refresh-signals.js` exercises the live public-feed fallback.
`X_SKIP_LIVE=1 node refresh-signals.js` performs deterministic matching from fresh local caches.
`X_HISTORY_BACKFILL=1 node refresh-signals.js` exhausts supported full-archive pagination and merges
public project archives into the private history. It still publishes only at reviewed N/N coverage.

## Deploy

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy.ps1
```

There is no build step. Vercel serves `index.html` and the JSON sidecars as static files.

## Security

- Credentials are loaded from `C:\Users\peterxing\pap-secrets\.env` and are never served or
  committed.
- Raw caches, debug output, logs, `.vercel`, and `node_modules` are excluded from GitHub.
- `server.js` is default-deny and serves only the site, public JSON sidecars, and static assets.

See `X-API-SETUP.md` for X authentication and `REVISE-PREDICTIONS.md` for forecast revision rules.
