# REVISE-PREDICTIONS.md — daily evolution of the REHOBOAM timeline

`predictions.json` (in `C:\Users\peterxing\pap-deploy`, mirrored to `pap-site` and the session
`files/`) is the **single source of truth** for the dated timeline and undated
post-superintelligence horizon shown on the Post-AGI Planning site.
Both `index.html` (display) and `refresh-signals.js` (post matching) read it at runtime. The daily
job REVISES it — **adds new predictions, updates existing ones, and removes outdated ones** — from
the latest verifiable reporting and research online. Editing this file changes the
site; no HTML edit is needed. The hourly job reassesses it, but the anti-thrash rule means most
hours update signals only and leave the forecast unchanged.

## X retirement (2026-08-13)

**This file previously ordered the next reviser to preserve a direct-X evidence contract. It does
not any more, and reinstating one is now a publication failure.** The site owner's instruction:

> remove all references to x posts and stop using the x api for the predictions — replace and add any
> references based on the latest news from the last 2 weeks instead

| Retired | Replaced by |
| --- | --- |
| one reviewed direct X evidence card per prediction | one reviewed **news** citation per prediction where a qualifying source exists, and an explicit **uncited** record where none does |
| `x-archive.js`, `verify-peter-evidence.js`, `verify-archive-corpus.js`, `verify-external-evidence.js`, `verify-id.js` | `news-evidence.js`, `verify-news-evidence.js`, `verify-currency.js` |
| `evidence-approvals.json` and the `external-evidence.js` X statuses | asserted **empty**; a non-empty ledger fails publication |
| the `peterTotal` / `peterAuthored` / `maxReuse` floors | removed, not zeroed — a floor of 0 reads as a *satisfied* gate |
| the X API and the private @peterxing corpus | live news fetch inside a 14-day window; the build no longer names the secrets directory |

**Do not restore any of the above.** The commands are gone, so an instruction to run them cannot be
obeyed — and improvising a substitute is how a fabricated source enters a forecast. If evidence is
missing, the correct outcome is an **uncited** record with its reason stated, not a weaker citation.
Coverage is currently 7 cited / 96 uncited of 103; that ratio is a measurement, and it must never be
improved by widening the window, lowering the source bar, or reusing a source across unrelated
claims.

## Schema

```jsonc
{
  "updated": "2026-06-16T12:01:53.642Z",   // ISO timestamp of the last revision
  "basis": "one-paragraph note on what changed today and the grounding (cite the evidence)",
  "domains": {                               // domain key -> label (drives the filter chips)
    "individual": "Individual", "social": "Social", "technology": "Technology",
    "economic": "Economic", "geopolitical": "Geopolitical", "governance": "Governance"
  },
  "years": [
    {
      "year": 2026,                          // unique integer, list is sorted ascending
      "summary": "1-2 sentence framing for the year (renders under the year heading)",
      "events": [
        { "t": "Event title shown on the card", "d": "technology", "high": true, "prob": 64 }
        // t = text (required); d = domain key (required, must exist in domains);
        // high = bool high-impact (optional); prob = 0-100 likelihood (optional);
        // signal = true marks the year's live-signal anchor row (optional)
        // simAnchor is reserved for the five stable probability-simulator anchors below
      ],
      "match": {                             // how refresh-signals.js maps his posts to THIS year
        "headline": "short topic label used by matching diagnostics",
        "search":   "topic terms used only as a matcher diagnostic; never a public fallback",
        "phrases":  ["multi-word phrases", "weighted 3"],
        "strong":   ["strong-prefix terms", "weighted 2"],
        "weak":     ["single", "words", "weighted 1"]
      }
    }
    // ... one object per year (exactly 2026-2040)
  ],
  "postSuperintelligence": {
    "title": "Post-superintelligence horizon",
    "summary": "Undated, dependency-gated possibilities rather than calendar forecasts.",
    "items": [{
      "id": "stable-kebab-case-id",
      "t": "Concise conditional scenario",
      "d": "technology",
      "epistemic": "conditional",
      "conditionalProb": 50,
      "dependencies": ["2-4 explicit prerequisites"],
      "indicators": ["2-4 observable precursor signals"],
      "caveat": "What remains unknown or unvalidated",
      "match": {
        "headline": "Short topic label",
        "search": "topic terms used only as a matcher diagnostic",
        "phrases": [], "strong": [], "weak": []
      }
    }]
  }
}
```

If a newly-added year/prediction has no curated `match` terms, `refresh-signals.js` auto-derives
weak keywords from its `summary`/`headline`/event titles, so it can still match his posts — but
**curating `phrases`/`strong`/`weak` gives far better matches**, so add them when you can.

## Undated post-superintelligence horizon

The dated forecast stops at 2040. Developments that require aligned superintelligence plus several
unvalidated prerequisite technologies belong in `postSuperintelligence`, never in a year beyond
2040. `conditionalProb` is the item's plausibility **conditional on aligned superintelligence and
every listed dependency**. It is not a probability by 2040, and the site must say so.

Every item follows an evidence ladder:

1. **Observed precursor** — a real, accurately described result, registration, launch or measurement.
2. **Demonstrated subsystem** — a reproducible component result with disclosed limitations.
3. **Scalable system** — validated integration, economics, safety and deployment at useful scale.
4. **Conditional ASI-enabled outcome** — the undated possibility, reached only if the prior gates hold.

Dependencies and indicators must make those stages auditable. A company announcement can be an
indicator, but cannot substitute for a clinical result, deployment, measured engineering result or
theoretical validation. Horizon wording and `conditionalProb` change only when evidence or a
dependency changes materially; never rewrite them for daily novelty.

Maintain explicit coverage of these families:

- **Neural symbiosis:** implantable and genuinely non-invasive pathways remain separate. Cover
  bidirectional communication, sensory restoration/augmentation and possible aligned-ASI
  acceleration of materials, decoding and stimulation. Do not imply current external systems match
  implants.
- **Whole-brain emulation, mind uploading and digital immortality:** require validated
  scanning/preservation fidelity, dynamic biochemical-state capture and functional emulation.
  Keep digital replicas/chatbots separate, and state that identity continuity is unresolved.
- **Orbital compute to proto-Dyson infrastructure:** require autonomous off-world mining,
  manufacturing, solar collection and bounded self-expansion. Small clusters are not a Dyson swarm,
  and a proto-Dyson trajectory is not a complete stellar enclosure.
- **Kardashev scaling:** express progress through measured energy capture/use in watts and sustained
  orders of magnitude. Type I/II are classifications and long-horizon reference points, not
  evidence of progress or near-term achievements.
- **Transcension Hypothesis:** an inward STEM-compression/densification alternative to outward
  expansion. Label it a speculative futures/astrobiology hypothesis with no empirical confirmation.
- **Ruliad:** a computational-metaphysics/foundational-physics research branch that becomes
  forecast-relevant only after discriminating, testable predictions or engineering consequences.
  It is not established physical theory, a destination, a simulation to enter or a proven ASI
  roadmap.

Outward proto-Dyson expansion and inward Transcension may be mutually exclusive. The horizon is
allowed to retain both branches because it is a dependency map, not a single linear prediction.

## Technology watchlist and strict terminology

On every warranted forecast reassessment, check primary sources first and record exact evidence dates
and links in `basis`:

- **BCI:** Neuralink Updates and PRIME, CONVOY, GB-PRIME, CAN-PRIME and related registrations;
  Synchron, Precision Neuroscience,
  BrainGate/Blackrock and Paradromics papers/registrations; and genuine EEG, MEG, fNIRS, ultrasound
  or optical systems. Intracortical and cortical-surface devices are invasive; endovascular devices
  are minimally invasive; only external sensing/stimulation is non-invasive. Patient count, safety,
  bandwidth, home use, functional outcomes, regulatory status and independent reproducibility matter.
  Wrist sEMG and other peripheral muscle/nerve interfaces are not BCIs.
- **Orbital compute:** Starcloud/NVIDIA, Axiom/Kepler, Google Project Suncatcher, SpaceX/FCC,
  Lonestar and comparable primary/technical sources. Separate launched hardware and named workloads
  from ground tests, launch targets, filings and aspirational constellations. Track deployed power,
  compute class, optical throughput, radiation tolerance, radiator/cooling mass, launch cost, debris,
  licensing and named customers. Lunar storage and single-satellite edge inference are not
  hyperscale orbital compute; a filing is not deployed capacity.
- **Connectomics/WBE:** peer-reviewed whole-organism connectomes, MICrONS-scale mammalian
  structure/function datasets, functional models, scanning, preservation, simulation cost and
  behavioral validation. A wiring diagram is not a running emulation; a person's chatbot is not an
  upload.
- **Dyson/Kardashev:** date only measurable off-world mining, autonomous manufacturing, power
  collection/transmission, orbital compute or bounded replication demonstrations. Never date a
  Dyson swarm or Type I/II transition through 2040 without extraordinary direct evidence.

The matcher guards embody these distinctions. Add a positive and negative fixture for each new
claim class or newly discovered false positive; never weaken a guard, freshness limit or declared-family reuse rule
to raise coverage.

## Latest-news forecast sweep

Every run sweeps recent authoritative reporting across the watchlist above plus frontier capability,
agents, robotics, compute/energy and labour/economic indicators. This is the reassessment side of the
news work and is separate from news *evidence*: it can move a forecast, it never assigns an evidence
card by itself.

Where verified reporting materially moves a forecast, update it under the existing anti-churn rules:
no daily wording churn, only material verifiable change, preserve monotonicity and portfolio
coherence, keep Peter's anchor unless he explicitly changes it, and set `revisedAt` + `changeNote`
citing the specific verified source. Only primary/original reporting, official lab/company/agency/
regulator announcements, peer-reviewed journals or named expert analysis qualify — the same
source-quality bar as published news evidence. Aggregators, syndicators, press-release mills and content
farms are never a basis for a forecast change.

Then re-run `node validate-predictions.js`. **Changing a prediction's text invalidates the reviewed
evidence binding for it**, so re-run `node refresh-signals.js` and `node verify-news-evidence.js`
afterwards. A prediction whose binding no longer holds becomes **uncited** until a qualifying source
is reviewed for its new wording — it must never keep a citation that was approved against different
text.

## Daily revision rules

1. **Ground every change.** Base edits on the latest news and research you can verify online: primary
   reporting, official lab/company/agency/regulator announcements, peer-reviewed journals, or named
   expert analysis. See `signals-debug.json` for source freshness and match diagnostics. Put a short,
   specific justification in `basis`. **Never invent a source, quote, date or provenance** — an
   unsupported prediction is published as uncited, which is an honest outcome and always available.
2. **Add** genuinely new, well-sourced predictions to the right year/domain (e.g. a newly-credible
   milestone). Keep titles crisp and falsifiable; set a realistic `prob`.
3. **Update** predictions when reality moves: recalibrate dates/probabilities, sharpen wording, or
   move an event to a different year. (E.g. trillion-dollar AI valuations; humanoid-robot ramp;
   fusion net-gain milestones.)
4. **Remove** predictions that are outdated, falsified, or no longer credible (e.g. a debunked claim,
   or a milestone that already happened and is no longer "future"). Removing the last stale event in
   a year is fine; keep at least the year's `summary` and `match`.
5. **Keep it honest and grounded.** No hype, no fabricated certainty. Probabilities should reflect
   real uncertainty. Don't fabricate sources.
6. **Preserve structure.** Keep all six domains; keep years sorted and unique; keep each event's `d`
   pointing at a real domain key. Don't rename domain keys.
7. **Stay on theme.** This file carries no styling — the Clawpilot theme lives in `index.html`. Never
   add colors/markup here.
8. **Anchor the AGI timeline to Peter's on-record call — do NOT revert it to a "2030s AGI" consensus.**
   The timeline must stay consistent with the book's Chapter 07 thesis: AI reaches genuine human-level
   capability (AGI) by the **END OF 2026**; it becomes disruptive for **EVERY industry throughout
   2027**; and the first **superintelligent** systems emerge in the **2028–2030 window** — posture
   "hope for the best, but prepare for the worst." Keep the 2026 live-signal row and the 2028 anchor
   event expressing THIS call (not the old "AGI consensus slips to the early-2030s" / "true AGI in the
   2030s" framing). You may recalibrate the probabilities as reality moves and add well-sourced
   nuance, but do not reframe these back to a mainstream 2030s-AGI timeline.
9. **Use AI 2040 as a standing scenario-scrutiny source.** On every warranted forecast revision,
   re-check the direct AI Futures Project material at `https://ai-2040.com/`, especially
   `/supplements/plan-a-assumptions`, `/supplements/takeoff-supplement`,
   `/supplements/economics-of-plan-a`, and `/supplements/capability-scaling-strategy`.
   Preserve its crucial epistemic distinction: **Plan A's implementation is a recommendation and
   conditional scenario, not the authors' literal base-case prediction.** Import robust forecast
   claims (for example: >80% confidence that AI R&D is fully automated within ~15 years absent major
   interruption; roughly 2 months–5 years from automated coding to top-expert AI; automation of
   economically relevant labor soon after) as evidence. Label the specific 2029 deal, 2030
   transparency regime, 2035 top-expert pause, and 2040 controlled handoff as a **managed/Plan A
   branch**, never as certain history. Keep Peter's faster 2026/2027/2028–2030 call as the
   ungoverned anchor, and use AI 2040 to stress-test the governance, labor, compute, distribution,
   alignment, and post-work consequences through 2040. If AI 2040 has not changed and no new
   evidence warrants a revision, the anti-thrash rule still wins: leave `predictions.json` untouched.
10. **Run a portfolio-wide deduplication and chronology pass on every reassessment.** Flatten every
   event across every year and compare the whole sequence—not only the year being edited. Remove or
   merge exact duplicates, near-synonyms, and repeated endpoints at different dates. A later event
   may resemble an earlier one only when it clearly advances a measurable threshold, expands the
   scope, or names a genuinely different conditional branch. Remove weaker later milestones and any
   event whose premise has already been eliminated by an earlier forecast (for example, conventional
   career churn or AI-assisted reskilling after the timeline predicts full AI-R&D automation and
   economy-wide job disruption). Keep quantitative series monotonic: cognitive/physical automation,
   AI labor share, GDP growth, agent/robot scale, redistribution, scientific acceleration, and
   capability levels must move forward rather than repeat or regress. Label managed, default, and
   Peter-ungoverned branches explicitly so a later top-expert milestone does not appear to follow an
   earlier unqualified superintelligence milestone in the same world. Run `validate-predictions.js`;
   its duplicate-family, near-overlap, post-automation-career, and branch-order checks must pass.
11. **Keep evidence matching verified, narrow, and conservative.** Every citation is a reviewed news
   article, fetched live at review time and again at publish time, with its verbatim quote re-located
   in the fetched text and a SHA-256 of that text re-checked. Aggregators, shorteners, press-release
   mills and content farms are refused. Literal title terms may be supplemented by the controlled
   concept ontology, but one distinctive shared concept or two substantive corroborating concepts are
   required, and every applicable claim-facet guard remains mandatory. Generic capability, computation,
   energy, space, economy, infrastructure, institutions, governance, scaling and AI overlap supports a
   match but never qualifies by itself. Allocate unique-source-first, then permit reuse only inside an
   explicitly reviewed compatible evidence family — where a **source** is the resolved article URL,
   never the ledger row name, so two rows quoting one article are one source used twice. Run
   `node verify-signal-matcher.js` and inspect `signals-debug.json` for method counts, candidate
   samples and guard rejections. **Never weaken a freshness or facet guard to increase the count**:
   fix the data, or accept the uncited record. An unsupported claim is published as **uncited** with
   its reason stated — that is a correct outcome, not a gap to be filled. Nothing self-approves.
12. **Keep the horizon dependency-gated and undated.** Do not add years after 2040. Every horizon
   item needs a stable ID, epistemic label, conditional plausibility, 2-4 dependencies, 2-4
   indicators, a caveat and a curated topic-term match definition. Run the same unique-source-first
   allocation across dated and horizon items; horizon keys are `horizon-STABLE-ID`.
13. **Preserve the five probability-simulator anchors.** Exactly one dated event must retain each
   stable `simAnchor`: `agi` in 2026, `ungoverned` in 2028, `managed` in 2029, `default` in 2030,
   and `handoff` in 2040. Their wording and probabilities may evolve, but do not rename, duplicate,
   remove or move these machine keys. `validate-predictions.js` fails publication if the contract
   breaks.
14. **Preserve the news evidence contract.** Every dated event and horizon item must have exactly one
   entry in `evidence-families.js` and exactly one of the following: a reviewed news citation in
   `news-evidence.js`, or an **uncited** record stating the reason and the search actually performed.
   There is no third state, and there is no fallback: `signals.search` must remain absent, null or
   empty. A citation must be published inside the 14-day currency window, must resolve HTTP 200 live
   at publish time, and must carry publisher, published date, **date provenance**, verbatim quote and
   text hash. Reuse is permitted only inside one explicitly reviewed compatible evidence family, and
   two rows quoting one article count as **one source used twice**.

   `refresh-signals.js` must exit nonzero and leave the last complete `signals.json` untouched
   whenever a citation fails live verification, a quote or hash drifts, provenance is incomplete,
   reuse crosses a reviewed family, or the cited-plus-uncited total does not exactly equal the
   prediction count. **Reinstating X evidence is itself a failure**: a retired X ingest file, an
   `evidenceOwner` of `peterxing` or `external`, a `from:peterxing` requirement, an x.com link, or
   any undeclared network host each fail publication by name.


## Procedure

```powershell
cd C:\Users\peterxing\pap-deploy
# 1. Edit predictions.json only for a material dated or horizon change; then set updated + basis.
# 2. Validate it:
node validate-predictions.js          # must print "RESULT: PASS"
# 3. Re-run matching so signals.json re-maps his posts to the revised predictions:
node refresh-signals.js               # exits 0; rewrites signals.json + signals-debug.json
node verify-signal-matcher.js          # semantic positive/negative fixtures must pass
node verify-direct-coverage.js         # cited + uncited must account for every prediction exactly
node verify-news-evidence.js           # every citation re-resolves, quote-matches and fails closed
node verify-currency.js                # exit 70 = PASSED BUT INERT, a legitimate empty layer
node verify-deploy-surface.js          # deploy surface and network egress are both allow-lists
node verify-performance.js             # split-asset, transfer, DOM and render budgets
# 4. Hash-sync and deploy only through the guarded helper:
C:\Users\peterxing\pap-site\deploy.ps1
```

`validate-predictions.js` checks: valid JSON, required top-level keys, the strict 2026-2040 year
range, unique years, event schema/probabilities, the five stable simulator anchors, complete
evidence-family coverage, portfolio
duplicates/chronology, and the complete horizon schema, labels, dependency counts, caveats and
terminology. If it FAILs, fix the source rather than weakening the validator. A broken
`predictions.json` makes `index.html` display an explicit unavailable state.

## Failure-safety

- `index.html` validates `predictions.json` at runtime and displays an explicit unavailable state if
  the fetch fails. Malformed or misleading horizon data emits a console error and hides stale horizon
  cards rather than silently overstating the section.
- `refresh-signals.js` falls back to its built-in `DEFAULT_PREDICTIONS` if `predictions.json` can't
  be read — matching keeps working even if the file is temporarily missing.
- If `signals.json` is missing or incomplete, the UI reports prediction evidence as unavailable.
  It never manufactures a mapping or renders prediction search chips.
- A 404 on `predictions.json` logs a browser console error that fails `verify-site.js`, so always
  keep the file present in **both** `pap-deploy` and `pap-site`.
