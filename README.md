# Post-AGI Planning

A living, data-driven civilization forecast and long-form guide to the post-AGI transition. The
REHOBOAM timeline spans **2026–2040** across six domains and is published at
[peterxing.com](https://peterxing.com).

Every individual prediction is checked hourly against the newest relevant verified activity from
[@peterxing](https://x.com/peterxing). The matching engine uses the authenticated X API first, then
a live read-only public profile feed. Stale caches are rejected rather than presented as current.
When no fresh relevant post exists, the prediction links to a live X search instead of forcing a
weak match.

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
- **`refresh-signals.js`** expands the forecast into one matcher per event. Relevance, solidity, and
  claim-specific facet guards run first; valid candidates then rank by recency tier and timestamp.
  One post can support at most three closely related predictions.
- **`signals.json`** is the generated public output. `signals-debug.json` remains local and records
  source freshness, rejected stale sources, match coverage, and assignment details.
- **`author.json`** drives the daily-refreshed About the Author section.

## Data-source safety

The source order is:

1. Authenticated X API v2.
2. Live read-only public RSS profile.
3. A fresh local API/RSS snapshot no older than 36 hours.
4. Live X search links when no fresh verified activity source is available.

The legacy public syndication feed is accepted only when its newest item is no more than 30 days
old. Raw activity and credentials stay outside the repository.

## Local use

```powershell
npm install
npm run validate
npm run refresh
npm run serve
```

In a second terminal:

```powershell
npm run verify
npm run verify:predictions
npm run verify:reality
npm run verify:author
```

`X_SKIP_API=1 node refresh-signals.js` exercises the live public-feed fallback.
`X_SKIP_LIVE=1 node refresh-signals.js` performs deterministic matching from fresh local caches.

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
