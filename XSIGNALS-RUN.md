# Monthly @peterxing trajectory-signal run (X archive) — Post-AGI Planning

**This file is the authoritative operational contract for the X trajectory-signal workflow.**
The scheduler prompt, if any, is a short pointer to it.

Same reasoning as `DAILY-RUN.md`: a contract stored in a scheduler field is not version-controlled,
not diffable, not reviewable and not mirrored. Here it is all four.

Change it by editing this file in a reviewed change, exactly like any other gate.

---

## What this job is, and what it must never become

The site owner instructed on 2026-08-26:

> use my x api to supplement the prediction evidence based on the posts and reposts from me
> (@peterxing), ensuring every prediction is mapped to an x post closest to the prediction to
> indicate the accuracy of its trajectory. make this a weekly automation.

On 2026-10-05, when paid API access lapsed, the owner chose the transport that replaces it:

> Use the free official route: my X data archive plus X's embed service.

So the supplement is now refreshed from the owner's own **official X data archive**, downloaded by
him, and each post the layer surfaces is confirmed through **X's official, unauthenticated oEmbed
service**. There is no API key, cookie, login, browser automation or scraping anywhere in this
workflow. The paid API collector (`x-harvest.js`) is dormant: it refuses to run without
`--legacy-paid-api` and is not extended.

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
5. **Egress is narrow and declared.** X's embed service (`publish.twitter.com`, which redirects to
   `publish.x.com`) is allow-listed for verification only, and only `x-oembed.js` may name it.
   `api.x.com` remains declared only for the dormant legacy collector. `x.com`/`twitter.com` remain
   retired evidence hosts and are never fetched: a status URL is never named in the tree's
   JavaScript, it is assembled from the status id, and embed HTML or the widget script is never
   stored or served — the site renders its own card from the archive text.
6. **The archive is private.** It also holds direct messages, email and phone records, devices, IP
   audits, likes and more. `x-archive-import.js` opens **only** `data/manifest.js` and the tweets
   files that manifest declares, and retains from the manifest only the owner handle, the generation
   date, X's partial flag and the declared tweets file list with its post counts (never the account
   id, display name or any other field); no other entry is inflated, read, hashed, logged or copied,
   and `verify-x-archive.js` proves it. Never unzip the archive, never copy it or any part of it into
   `pap-deploy`, `pap-github` or `pap-site`, never commit or upload it. Only the derived fields the
   supplement already published can leave `pap-secrets`.

## The owner's monthly step

1. On X: **Settings → Your account → Download an archive of your data**. X emails a link when the
   archive is ready.
2. Download the zip and save it, unopened, to **`C:\Users\peterxing\pap-x-archive\`** — a folder
   outside every published, deployed or mirrored tree. Keep one archive there, or name it explicitly
   with `--archive=`. Deleting older archives after a successful import is the owner's choice.

## The monthly run

```powershell
cd C:\Users\peterxing\pap-deploy
$env:PAP_PIPELINE_OWNER = "xarchive-yyyyMMddHHmm"
node pipeline-lock.js acquire --owner=$env:PAP_PIPELINE_OWNER --purpose=manual --wait=600
npm run verify:xarchive    # fixtures only: allow-list, refusals, oEmbed handling; no network
npm run x:import           # archive -> pap-secrets/x-signal-cache.json (private)
npm run x:oembed           # official oEmbed: confirm surfaced posts are public; reposted display names
npm run x:signals          # match against the CURRENT forecasts -> x-signals.json
```

If `x-signals-state.json` declares the layer **withheld**, set it back to
`{"schemaVersion":1,"state":"published"}` in the same reviewed change, because the fresh import has
just been matched to the current forecasts. Then:

```powershell
node refresh-signals.js    # folds the layer into signals.json
node build-game.js --write # canonical game projection only; never rewrites evidence or gameplay rules
powershell -File .\run-gates.ps1 -IsolatedPreview
```

Then publish via `pap-site\deploy.ps1` and mirror via `publish-github.ps1`, exactly as the daily run
does. Release the lock at the end, on success, failure and abort alike.

The game reads the preserved `signals.xSignals` supplement; it neither collects X nor treats it
as NEWS, a reference point, a measurement or a game score. Preserve the exact approved game files
and budgets in `game-policy.json`. Valid gameplay-only mapping gaps pause new campaigns. The user
deferred the unpublished cinematic extension: its complete candidate and seven optional files
are preserved outside this release and must not be restored, downloaded or regenerated.
Preserve the reader-first UI, optional Explore tools and separate AI timeline companion;
X remains discussion only and cannot change their reviewed source dates or NEWS ledger.
Canonical book/tool projection, campaign rules and save bindings remain unchanged. Every
existing NEWS/reference/X integrity guard still applies. Do not invent replacement gameplay
bindings to bypass review. The isolated gate preview belongs only to its runner; existing previews
must not be terminated.

## Between imports, and when forecasts change

- **Between monthly imports** the layer is older than the 10-day build ceiling, so the daily
  actuals job retains it only through the existing stale-X binding (`--actuals-preserve-stale-x`):
  identical bytes, published pairing, identical forecast set. The visible note names the archive:
  "X snapshot from archive dated …".
- **When the forecasts are revised before the next archive arrives**, that binding correctly
  refuses. Do not delete or edit `x-signals.json`. Declare the reviewed **withheld** state in
  `x-signals-state.json` with one of the reasons `refresh-signals.js` lists, today's date and the
  exact SHA-256 of `x-signals.json`. `signals.json` then carries no `xSignals` and shows the one named
  notice; every other X fault still fails the build.

## Rules that came out of building this

- **A refused import is an outage, not silence.** The importer refuses a truncated, corrupt, partial
  (X's own flag), foreign-account, ambiguous or older archive, and a post dated after the archive.
  Every refusal leaves the previous cache in place; the same shared contract
  (`x-harvest-contract.js`) that refused empty or partial API harvests refuses it before any write.
- **The archive is not the API, and the differences are recorded rather than hidden.** X stores a
  repost as its own "RT @handle: …" record cut to 140 characters, with 0 likes and 0 reposts and no
  origin id. So repost text is that stored excerpt, `sourceId` is null rather than invented, the
  reposted handle is taken only when the archive's own mention entity confirms it, and the caps say
  so. A quote keeps Peter's own text; the quoted post's text is not in the archive. Likes and
  reposts are labelled "as recorded in the X archive dated …".
- **Verification is official, polite and bound to the import.** `x-oembed.js` makes one
  unauthenticated request per surfaced post, at least 1.5 s apart, under an honest User-Agent. A
  404, 410 or 403, or an embed attributed to a different post or author, drops the post with a named
  reason and the matcher picks the next candidate. A 429 honours Retry-After once (up to two
  minutes); if X is still limiting, a post keeps its last-good verification unchanged and never
  freshened, and a post with no last-good record leaves the run unfinished so nothing is published
  unverified. `x-signals.js` refuses an archive layer whose verification belongs to another import.
- **Word overlap is not aboutness.** Two rounds of threshold tuning failed before the fix landed.
  Measured collisions: `stem` → "stem cells" vs. STEM compression; `cross` → "crossed a line" vs.
  cross-border wealth; `annual` → "annual output" vs. annual alignment spending; `emulation` →
  Optimus video emulation vs. whole-brain emulation. A NEAREST match therefore requires a shared
  **concept** from the vetted ontology, not merely shared words.
- **Refusal is the feature.** Some predictions get no signal at all — the horizon items and the
  alignment-science claims Peter does not post about. That number should stay non-zero. If every
  prediction suddenly matches, the proximity bar has gone slack: investigate before accepting.
- **Likes and bookmarks are unavailable, not empty.** They are user-context data inside the archive
  and are never opened. This is recorded in `caps` so an unavailable source can never look like an
  absent one.

## Report

State: lock disposition; the archive's generation date; posts in the archive, items kept in the
window and items dropped with their named reasons; oEmbed outcomes (verified, last-good, gone, with
reasons) and request count; TRACKED vs. NEAREST counts; unique posts used and observed reuse against
the ceiling; how many predictions received **no** signal, **by id**; the age distribution; the
`x-signals-state.json` state before and after; and every gate result with its exit code
distinguished (0 PASS, 70 INERT, 75 DEFERRED, other FAIL). Report the evidence accounting separately
and confirm it is unchanged — this job must never move it.
