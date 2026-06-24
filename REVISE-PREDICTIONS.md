# REVISE-PREDICTIONS.md — daily evolution of the REHOBOAM timeline

`predictions.json` (in `C:\Users\peterxing\pap-deploy`, mirrored to `pap-site` and the session
`files/`) is the **single source of truth** for the timeline shown on the Post-AGI Planning site.
Both `index.html` (display) and `refresh-signals.js` (post matching) read it at runtime. The daily
job REVISES it — **adds new predictions, updates existing ones, and removes outdated ones** — from
the latest information online and from @peterxing's X posts/reposts. Editing this file changes the
site; no HTML edit is needed.

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
    // ... one object per year (currently 2026-2036)
  ]
}
```

If a newly-added year/prediction has no curated `match` terms, `refresh-signals.js` auto-derives
weak keywords from its `summary`/`headline`/event titles, so it can still match his posts — but
**curating `phrases`/`strong`/`weak` gives far better matches**, so add them when you can.

## Daily revision rules

1. **Ground every change.** Base edits on (a) the latest news/research you can verify online and
   (b) @peterxing's recent X posts/reposts (see `signals-debug.json` for his newest activity and the
   harvested `timeline-raw.json`). Put a short, specific justification in `basis`. Never invent his
   posts or activity.
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
