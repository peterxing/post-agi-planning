# Weekly @peterxing trajectory-signal run — Post-AGI Planning

**This file is the authoritative operational contract for the weekly X trajectory-signal workflow.**
The scheduler prompt is a short pointer to it.

Same reasoning as `DAILY-RUN.md`: a contract stored in a scheduler field is not version-controlled,
not diffable, not reviewable and not mirrored. Here it is all four.

Change it by editing this file in a reviewed change, exactly like any other gate.

---

## What this job is, and what it must never become

The site owner instructed on 2026-08-26:

> use my x api to supplement the prediction evidence based on the posts and reposts from me
> (@peterxing), ensuring every prediction is mapped to an x post closest to the prediction to
> indicate the accuracy of its trajectory. make this a weekly automation.

**This is a declared, narrow reversal of the 2026-08-13 X retirement — and the retirement of
X-as-evidence still stands.** Those are not in conflict, because they answer different questions:

| | Question | Channel |
| --- | --- | --- |
| News evidence | Does an authoritative source *support* this prediction? | `signals.embeds` (cited/context/uncited) |
| X trajectory signal | What has Peter been *posting and amplifying* on this trajectory? | `signals.xSignals` |

An X post carries no editorial responsibility, no byline standard and no publication-date
provenance. That is why it cannot be a citation here and why the supplement is structurally
separate. **A prediction can be UNCITED and still carry an X signal**, and both statements stay true
and visible on the card.

### Non-negotiable boundaries

1. **X never enters `embeds`.** No `evidenceOwner`, `sourceQuality`, `publisher`, `verifiedThrough`
   or `textSha256` on a trajectory signal. `refresh-signals.js` refuses to build if one appears.
2. **`coverage.byEvidenceMedium.x` stays 0** and `coverage.byEvidenceOwner.peterxing` stays 0. Every
   X refusal added at the retirement keeps passing unchanged; if one starts failing, something has
   crossed the boundary — fix the crossing, never the assertion.
3. **The supplement is appended, never substituted.** It renders *after* the evidence state. An
   uncited prediction still says in full that a search ran and found nothing.
4. **Two tiers, labelled differently.** `TRACKED` passed the shared 253-fixture matcher.
   `NEAREST` is topical proximity only and says so. Never let NEAREST borrow TRACKED's wording.
5. **`api.x.com` is allow-listed; `x.com`/`twitter.com` remain retired evidence hosts.** Do not name
   a status URL in the tree's JavaScript — it is assembled at render time from the status id.
   Measured twice: both the harvester's code *and a comment explaining the trap* tripped this gate.

## The weekly run

```powershell
cd C:\Users\peterxing\pap-deploy
$env:PAP_PIPELINE_OWNER = "scheduled-xsignals-yyyyMMddHHmm"
node pipeline-lock.js acquire --owner=$env:PAP_PIPELINE_OWNER --purpose=scheduled-xsignals --wait=600
npm run x:harvest          # authenticated read of @peterxing's timeline -> pap-secrets (private)
npm run x:signals          # match against predictions -> x-signals.json
node refresh-signals.js    # folds the layer into signals.json
powershell -File .\run-gates.ps1
```

Then publish via `pap-site\deploy.ps1` and mirror via `publish-github.ps1`, exactly as the daily run
does. Release the lock at the end, on success, failure and abort alike.

## Rules that came out of building this

- **An empty harvest is an outage, not silence.** MEASURED 2026-08-27: a mid-run rate limit made
  page 1 fail, the loop broke, and a perfectly well-formed cache containing **zero items** was
  written — indistinguishable from "Peter posted nothing". `x-harvest.js` now refuses to overwrite
  the cache on an empty result and records per-page failures in `caps.timelinePageFailures`. If the
  harvest fails, **leave the previous cache in place and let next week retry**; never publish an
  empty or partial layer as if it were the account's real activity.
- **The layer goes stale and the build knows it.** `refresh-signals.js` refuses an `x-signals.json`
  older than 10 days, because prediction text is revised daily and a signal matched against old
  wording can attach a post to a forecast that has since changed. A weekly cadence sits inside that
  ceiling with room for one missed run; two consecutive misses will fail the daily build, which is
  the intended signal that this job has stopped.
- **Word overlap is not aboutness.** Two rounds of threshold tuning failed before the fix landed.
  Measured collisions: `stem` → "stem cells" vs. STEM compression; `cross` → "crossed a line" vs.
  cross-border wealth; `annual` → "annual output" vs. annual alignment spending; `emulation` →
  Optimus video emulation vs. whole-brain emulation. A NEAREST match therefore requires a shared
  **concept** from the vetted ontology, not merely shared words.
- **Refusal is the feature.** 12 predictions currently get no signal at all — the horizon items and
  the alignment-science claims Peter does not post about. That number should stay non-zero. If
  every prediction suddenly matches, the proximity bar has gone slack: investigate before accepting.
- **Likes and bookmarks are unavailable, not empty.** The stored credential is app-only;
  `/2/users/me`, likes and bookmarks require OAuth 2.0 user context. This is recorded in `caps` so
  an unavailable source can never look like an absent one. If Peter supplies a user-context token,
  those become reachable and the caps block should stop saying otherwise.

## Report

State: lock disposition; items harvested and whether the harvest was complete or partial (with page
failures named); TRACKED vs. NEAREST counts; unique posts used and observed reuse against the
ceiling; how many predictions received **no** signal, **by id**; the age distribution; and every
gate result with its exit code distinguished (0 PASS, 70 INERT, 75 DEFERRED, other FAIL). Report the
evidence accounting separately and confirm it is unchanged — this job must never move it.
