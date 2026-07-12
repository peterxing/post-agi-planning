# REVISE-PREDICTIONS.md — daily evolution of the REHOBOAM timeline

`predictions.json` (in `C:\Users\peterxing\pap-deploy`, mirrored to `pap-site` and the session
`files/`) is the **single source of truth** for the timeline shown on the Post-AGI Planning site.
Both `index.html` (display) and `refresh-signals.js` (post matching) read it at runtime. The daily
job REVISES it — **adds new predictions, updates existing ones, and removes outdated ones** — from
the latest information online and from @peterxing's X posts/reposts. Editing this file changes the
site; no HTML edit is needed. The hourly job reassesses it, but the anti-thrash rule means most
hours update signals only and leave the forecast unchanged.

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
      ],
      "match": {                             // how refresh-signals.js maps his posts to THIS year
        "headline": "short topic label used in the from:peterxing search chip",
        "search":   "the exact from:peterxing search query for the chip",
        "phrases":  ["multi-word phrases", "weighted 3"],
        "strong":   ["strong-prefix terms", "weighted 2"],
        "weak":     ["single", "words", "weighted 1"]
      }
    }
    // ... one object per year (currently 2026-2040)
  ]
}
```

If a newly-added year/prediction has no curated `match` terms, `refresh-signals.js` auto-derives
weak keywords from its `summary`/`headline`/event titles, so it can still match his posts — but
**curating `phrases`/`strong`/`weak` gives far better matches**, so add them when you can.

## Daily revision rules

1. **Ground every change.** Base edits on (a) the latest news/research you can verify online and
   (b) @peterxing's recent X posts/reposts (see `signals-debug.json` for source freshness and match
   details; raw authenticated activity stays outside the repo). Put a short, specific justification
   in `basis`. Never invent his posts or activity.
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
11. **Keep X matching fresh and conservative.** `refresh-signals.js` must try the authenticated X API,
   then the live public profile feed, before caches. Reject caches older than the configured 36-hour
   limit and reject the legacy syndication feed when its newest item is stale. For each prediction,
   apply relevance, solidity, and claim-facet guards before ranking valid matches by recency and
   timestamp. Never force a weak or stale embed: use the live `from:peterxing` search fallback.

## Procedure

```powershell
cd C:\Users\peterxing\pap-deploy
# 1. Edit predictions.json (add/update/remove years & events; set updated + basis).
# 2. Validate it:
node validate-predictions.js          # must print "RESULT: PASS"
# 3. Re-run matching so signals.json re-maps his posts to the revised predictions:
node refresh-signals.js               # exits 0; rewrites signals.json + signals-debug.json
# 4. Mirror to the public bundle (so peterxing.com / Vercel serves the same data):
Copy-Item predictions.json C:\Users\peterxing\pap-site\predictions.json -Force
# (index.html + signals.json are copied in the workflow's PUBLISH step too)
```

`validate-predictions.js` checks: valid JSON, required top-level keys, every year has a numeric
unique `year`, a string `summary`, an array of events each with a non-empty `t` and a `d` that
exists in `domains`, and any `prob` in 0-100. If it FAILs, fix the JSON before publishing — a broken
`predictions.json` makes `index.html` fall back to its inline baseline (the site won't show your
revision).

## Failure-safety

- `index.html` validates `predictions.json` at runtime and **falls back to its inline baseline** if
  the fetch fails or the data is malformed — so a bad file degrades gracefully (old timeline) rather
  than blanking the site. Still, always run `validate-predictions.js` before publishing.
- `refresh-signals.js` falls back to its built-in `DEFAULT_PREDICTIONS` if `predictions.json` can't
  be read — matching keeps working even if the file is temporarily missing.
- A 404 on `predictions.json` logs a browser console error that fails `verify-site.js`, so always
  keep the file present in **both** `pap-deploy` and `pap-site`.
