# Post-AGI Planning

A timeline planning app that combines:

- **Base forecast timeline** (AI Futures Model + Future Timeline style predictions)
- **Live signal feed** from **X API** and **Polymarket API**
- **Probability overlay engine** that shifts month/domain probabilities from incoming market + event signals

---

## What’s new in this update

### 1) Live Signals Feed tab
- New **Signals** tab shows significant events in near-real-time
- Includes source, domain mapping, significance score, target month, and delta impact
- Displays domain-level rollup of net pressure (`+/-` percentage points)

### 2) Timeline probability impact overlay
- Live signals now affect the timeline probabilities via bounded deltas
- Effects decay over subsequent months (default 3-month horizon)
- Signal items are also injected into month predictions as `[Signal] ...` entries with source links

### 3) Signal ingestion pipeline
- New script: `scripts/update-live-signals.mjs`
- Pulls:
  - **X API** (`/2/tweets/search/recent`) when `X_BEARER_TOKEN` is provided
  - **Polymarket Gamma API** (`/markets`) for active AI-related markets
- Writes snapshot to:
  - `public/data/live-signals.json`

---

## Quick start

```bash
npm install
npm run signals:update
npm run dev
```

Open the app and go to the **Signals** tab.

---

## Environment variables

Create a `.env` file (optional but recommended):

```bash
# Required for X ingestion
X_BEARER_TOKEN=...

# Optional tuning
X_QUERY=(AGI OR ASI OR "artificial general intelligence" OR OpenAI OR Anthropic OR DeepMind OR xAI) lang:en -is:retweet
X_MAX_RESULTS=40

POLYMARKET_API_BASE=https://gamma-api.polymarket.com
POLYMARKET_LIMIT=400

SIGNAL_WINDOW_HOURS=24
SIGNAL_MAX_ITEMS=120
```

If `X_BEARER_TOKEN` is missing, the script still runs and ingests Polymarket-only signals.

---

## NPM scripts

```bash
npm run dev
npm run build
npm run signals:update
npm run signals:update:with-build
```

---

## Notes

- This is a **decision-support signal layer**, not an oracle.
- Deltas are intentionally bounded to avoid runaway probability swings.
- Improve calibration by tuning keyword maps, significance formulas, and per-domain weighting over time.
