# Post-AGI Planning

A living, data-driven civilization forecast and long-form guide to the post-AGI transition. The
REHOBOAM timeline spans **2026–2040** across six domains, plus an undated, dependency-gated
post-superintelligence horizon, and is published at [peterxing.com](https://peterxing.com).

## Evidence contract

Every prediction is evidenced only by **authoritative news and research published inside a 14-day
currency window**. A prediction with no qualifying source in that window is published as an explicit
**uncited** record carrying its reason and search statement — never left blank, never padded with a
weaker source, and never backfilled with an older one to improve the ratio.

Today that is **7 cited and 96 uncited of 103**, drawn from 6 distinct publishers. Those numbers are
generated rather than asserted: the page renders them from `signals.json`, so they cannot drift from
what actually shipped.

A citation must clear all of the following, at review time **and** again at publish time:

- live fetch of the URL, HTTP 200 on the resolved address after redirects;
- headline, publisher, byline and date extracted from the fetched page, not from a feed;
- an exact verbatim supporting quote located in that extracted text;
- a SHA-256 of the extracted main text re-checked against the reviewed hash;
- rejection of aggregators, shorteners, press-release mills and content farms;
- no auto-approval — every mapping is reviewed by a human before it can publish.

`refresh-signals.js` exits nonzero and leaves the last complete `signals.json` untouched if any of
this fails. Prediction search fallbacks are forbidden: `signals.search` must remain empty.

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
                                     └──> evidence-families.js (declared reuse families)
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

## Local use

```powershell
npm install
npm run validate
npm run refresh
npm run verify:matcher
npm run verify:coverage
npm run verify:news
npm run verify:currency
npm run verify:surface
npm run serve
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
