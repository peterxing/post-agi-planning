# Post-AGI Planning

A living, data-driven civilization-forecast for the post-AGI transition — a REHOBOAM-style
predictive timeline spanning **2026–2036** across six domains (Individual, Social, Technology,
Economic, Geopolitical, Governance), paired with a long-form book and a **Reality Signals** grid.

**Live:** [peterxing.com](https://peterxing.com) · [post-agi-planning.vercel.app](https://post-agi-planning.vercel.app)

Every individual prediction is continuously matched to the single most relevant **real** post or
repost from [@peterxing](https://x.com/peterxing)'s realtime X (Twitter) activity, and the
"Reality Signals" section is refreshed from his most notable recent posts/reposts per theme — so the
timeline visibly evolves as the future arrives.

---

## How it works

The site is a single self-contained `index.html` (no build step) that fetches two JSON sidecars at
runtime and renders the timeline + signal cards. A Node engine regenerates those sidecars from live
data:

```
index.html ──fetch──▶ predictions.json   (the forecast: source of truth, evolves as reality moves)
            └─fetch──▶ signals.json       (per-prediction X matches + the Reality Signals grid)
                              ▲
                              │  rewritten by
                  refresh-signals.js ──uses──▶ x-client.js  (authenticated X API v2 harvest)
```

- **`predictions.json`** — the curated forecast. Each year has a `summary`, an `events[]` list (each
  `{ t, d, high?, prob? }`), and a `match` block of keywords. This is the single source of truth for
  the timeline; editing it changes the site (no HTML edit needed).
- **`refresh-signals.js`** — expands `predictions.json` into one matcher *per individual prediction*
  (keyed `"YEAR-INDEX"`), harvests @peterxing's realtime timeline via the X API v2 (posts + reposts
  always; likes + bookmarks when a user-context token is configured), greedily assigns each prediction
  its most relevant distinct post/repost (preferring the past week, otherwise his most recent on-topic
  item, honestly dated), and also builds the **Reality Signals** grid (one card per theme). It writes
  `signals.json` (public) and `signals-debug.json` (local). If the X API is unavailable it falls back
  to an auth-free syndication scrape, so the site never blanks.
- **`x-client.js` / `x-auth.js`** — the X API v2 client and the one-time OAuth2 PKCE login. Credentials
  are loaded from a `.env` file kept **outside** this repo (see Security below); nothing is hardcoded.

## Repository layout

| File | Purpose |
|------|---------|
| `index.html` | The entire site (timeline, book, Reality Signals). Clawpilot theme, light/dark. |
| `predictions.json` | The forecast — source of truth for the timeline. |
| `signals.json` | Per-prediction X matches + the Reality Signals grid (generated). |
| `refresh-signals.js` | The matching + reality-grid engine. |
| `x-client.js`, `x-auth.js` | X API v2 client + OAuth2 login helper. |
| `harvest-loop.js` | Optional continuous-harvest helper. |
| `validate-predictions.js` | Schema validator for `predictions.json`. |
| `verify-site.js`, `verify-perpred.js`, `verify-reality.js`, `verify-id.js` | Headless (Edge/Playwright) checks. |
| `server.js` | Minimal hardened static server for local preview (default-deny). |
| `launch.ps1`, `watchdog.ps1` | Local server + Cloudflare tunnel launcher / watchdog. |
| `deploy.ps1`, `vercel.json`, `_headers` | Vercel production deploy + caching/headers. |
| `REVISE-PREDICTIONS.md` | Schema + rules for evolving the forecast. |
| `X-API-SETUP.md` | How to provision X API credentials (incl. likes/bookmarks). |
| `.env.example` | Template for the credentials file (copy outside the repo). |

## Local preview

```bash
node server.js
# → serves the site on http://127.0.0.1:8787/
```

`index.html` validates the JSON at runtime and falls back to an inline baseline if a sidecar is
missing or malformed, so it renders even offline.

## Refreshing the data

1. Provision X API credentials — copy `.env.example` to a secrets location **outside** this repo
   (e.g. `../pap-secrets/.env`) and fill it in. See `X-API-SETUP.md`.
2. (Optional) Run `node x-auth.js` once to add likes + bookmarks via OAuth2.
3. Edit `predictions.json` if reality has moved (see `REVISE-PREDICTIONS.md`), then
   `node validate-predictions.js`.
4. `node refresh-signals.js` — rewrites `signals.json` from his realtime activity.
5. Verify: `node verify-perpred.js http://127.0.0.1:8787/` and
   `node verify-reality.js http://127.0.0.1:8787/` (both print `RESULT: PASS`).

## Deploy

Static deploy to Vercel (production is aliased to `peterxing.com` and `post-agi-planning.vercel.app`):

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy.ps1
```

There is no build step — `index.html` + the JSON sidecars are served as-is.

## Security

- **Secrets never live in this repo.** X API keys/tokens are read from a `.env` file kept outside the
  repository; `.gitignore` ignores all `.env*` (except `.env.example`). The engine loads them at
  runtime via `x-client.js` — nothing is hardcoded, printed, served, or committed.
- The harvested raw activity dump (which may include private bookmarks) and other generated artifacts
  (`x-activity.json`, `signals-debug.json`, `timeline-raw.json`, logs) are git-ignored and never
  published. Only the curated, public `signals.json` ships.
- `server.js` is default-deny: it serves only `index.html` + the JSON sidecars + static assets, and
  404s any server-side script.

## License

[MIT](./LICENSE)
