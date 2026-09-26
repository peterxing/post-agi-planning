# Daily actuals for both monthly timelines

This is the canonical contract for **Daily timeline news and facts**, the single
07:00 Sydney project automation. It updates reported news and facts, not the
author's predictions. The scheduler must stop if this file is missing or unreadable.
The job runs locally in `C:\Users\peterxing\pap-deploy`; a scheduled run requires
the host and its automation service to be available. A saved schedule is not proof
that a run occurred or that a deployment succeeded.

## Scope and ownership

The homepage reads reviewed canonical `signals.json` NEWS through `news-timeline.js`.
The standalone `ai-timeline.html` retains its own embedded scenario-comparison
snapshot. It is not a third canonical NEWS ledger, a prediction adjudicator, or an
automatic AGI detector. The same owner and scheduled run maintain both.

Reuse the source-quality, relevance, metadata, quote/hash, currency, reference,
METR, transport, publication, and interlock requirements in `DAILY-RUN.md`.
**Do not run that contract's forecast reassessment, probability changes, book
rewriting, author refresh, horizon editing, or X collection steps.** This narrower
contract governs the actuals-only job. Separate editorial work still needs its own
authorization; no conflicting second daily actuals workflow should be created.

Preserve `predictions.json`, `author.json`, the complete authored book, all tool
formulas/saved-state semantics, the base game and its rules, the cinematic parking
archive, and existing repairs/guards. Never read credentials for this feature or
invoke an X API/collector, paid source, new account, or new cloud service.

Acquire before protected reads and retain one owner through publication:

```powershell
$env:PAP_PIPELINE_OWNER = 'daily-timeline-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
node pipeline-lock.js acquire --owner=$env:PAP_PIPELINE_OWNER --purpose=scheduled-forecast --wait=0
```

Exit 75 means deferred: stop without a retry loop or lock override. Record that no
update was published. Always use this owner in subsequent command processes and
release it on success, refusal, or failure:

```powershell
node pipeline-lock.js release --owner=$env:PAP_PIPELINE_OWNER
```

## Establish the actual starting state

Record the current remote commit, live publication dates on both domains, source
collection dates, companion `actualsCheck`, and exact protected-file hashes in
session artifacts, never in the served directory. A prior failed/deferred run is
not a success because the old page still loads. Compare against the last successful
check, not the last attempted job. Use a seven-day overlapping discovery window;
widen up to 31 days after missed runs and explicitly report any remaining gap.

The independent X supplement remains subject to its existing validity guards.
Do not redate, delete, reconstruct, or recollect it to get a news update through.
If a producer refuses a retained dependency, record the exact reason and stop that
publication; a stale dependency is not permission to weaken its guard.

**Stale-X preservation (owner-approved, this job only).** The ordinary producer and
the weekly X workflow keep the 10-day ceiling. This job alone runs the producer with
`--actuals-preserve-stale-x`, which retains an older X layer only if all of these
hold, and otherwise refuses exactly as before:

- `x-signals.json` parses, has no future build/harvest/post date, and passes every
  current orphan, provenance-field and evidence-isolation check;
- the last-good local `signals.json` carries a byte-identical `xSignals` object and
  the same `forecastVersion.sha256` as the current `predictions.json`;
- the published mirror (`..\pap-github`, read-only `git rev-parse/log/show/merge-base`)
  carries the same X bytes at HEAD, and the earliest published commit introducing
  those bytes also published the identical X layer within 10 days of its `builtAt`
  together with a `predictions.json` whose full canonical fingerprint equals today's.

Changed, reordered or removed forecasts, a missing or corrupt mirror binding, an
unpublished pairing, or any integrity failure refuses. Matching IDs or counts are not
a binding, and a digest computed from today's forecasts is never accepted as history.
On success the X object, its built/harvest/post dates, metrics and assignments are
unchanged; `signals.xSignalsRetention` records the age, pairing commit and reason, and
each forecast's X dossier shows a visible stale-snapshot warning. Report the X age and
retention reason separately from the day's NEWS work. This is not renewed X
verification and never makes X evidence.

## Source discovery and canonical NEWS

Use the existing NEWS discovery and verification path, not a parallel feed writer.
Look for relevant original reporting and first-party research/policy announcements
within the bounded window. The feed or search result is discovery only: read the
original article before reviewing a fact or mapping. Do not search for filler just
because a calendar month has no recorded entry.

Run the existing collectors under the same owner, judging each exit separately:

```powershell
node refresh-metr.js
node refresh-reference-points.js --refresh
node refresh-signals.js --actuals-preserve-stale-x
```

Follow the METR collector's documented exit-10 last-good/health behavior; exit 75
always defers. Other failed integrity or schema checks stop publication. Do not
freshen last-good measurement dates when a request fails or returns 304.

Inspect the existing discovery outputs and, where warranted, run the existing
operator-local `node news-backfill.js --propose` and browser discovery path described
in `DAILY-RUN.md`. Discovery files are proposals, not evidence. Review each candidate
on its merits before promoting into `news-evidence.js`: exact fetched headline,
publisher, actual publication date, verbatim probative quote, source-text hash, and
an individually justified mapping to the unchanged forecast text. State what the
article does **not** establish. Preserve counterevidence, author attribution, and
announcements-versus-deployments distinctions. Existing source-family/reuse gates
remain in force. An undeclared publisher host requires an explicit reviewed
allow-list edit and the existing host gate; never allow arbitrary origins.

After an authorized reviewed-ledger change, rerun `node refresh-signals.js --actuals-preserve-stale-x`. It
rechecks the sources and maintains the cited/context/uncited partition. Passing
outside the current-news window moves valid reporting into dated context; it does
not change the article's publication date or erase historical background.

The producer records `signals.actualsRefresh.checkedAt` independently from
`contentChangedAt`. Its digest covers substantive reviewed article/mapping fields,
not retrieval time, channel aging, or a regenerated snapshot timestamp. A successful
unchanged check keeps the prior content-change time. Older snapshots with no such
timestamp remain explicitly unrecorded rather than receiving an invented date.

**NEWS access-challenge last-good (owner-approved 2026-09-24).** When an
existing published NEWS record's live read hits a positively identified
publisher bot-protection challenge, `refresh-signals.js` and `verify:news` may
keep it as a dated last-good **warning**, never a PASS. The code is
`verifyNewsSourceAllowingLastGood` / `assessNewsLastGood` in `news-evidence.js`.
Every condition must hold, otherwise the ordinary failure stands:

- The challenge marker is one of exactly three. AWS WAF: header
  `x-amzn-waf-action: captcha|challenge`. Akamai: a 3xx to
  `/apology_objects/abuse-detection-apology.html` on the same registrable host; the
  redirect is not followed. Cloudflare: `cf-mitigated: challenge`. A plain
  404/405/410/5xx, a timeout, a WAF `block`, or an apology redirect to another site
  still fails.
- The challenge is the record's only problem, read over the declared plain https
  transport.
- The record already exists and is byte-identical to the last published record:
  `newsRecordIdentity` covers the full source and every one of its mappings. Two
  commits are compared, the published mirror HEAD (`..\pap-github`, or
  `PAP_NEWS_MIRROR` for curated candidates; read-only git) and the commit of the
  newest durable live verification in `NEWS_LIVE_VERIFICATIONS`. Today that is the
  released 2026-09-22 `verify:news` PASS at `93a31786…`, which must be a mirror
  ancestor committed that UTC day.
- The age is counted in UTC calendar days from that verification and may be at most
  14. So 2026-09-22 is retained through 2026-10-06 and fails from 2026-10-07.

New, changed, never-verified or expired records cannot use the mode. Today's date is
never minted as a verification. A new verification row may be added only by a
reviewed edit after a real full live `verify:news` PASS that is then published. No
bypass: no UA/header spoofing, proxy/VPN, captcha solving, cookie replay, or
cache/archive substitution.

A retained record keeps every reviewed field and date, and follows the normal
window split. It carries `health` = `{status:'last-good', label:"Couldn't recheck
today", reason:'publisher bot protection', challenge, lastCheckedAt, lastVerifiedAt,
verifiedBy, retainedUntil, ageDays}`. The reader shows that label, the reason, the
last-verified date and the expiry in the item's "Source record & limits"
provenance (the summary line shows the label). `verify` asserts this. The companion
selected-source check (`refresh-timeline-actuals.js`) does **not** use this mode:
there, a challenged or text-drifted source fails.

**Honest empty-current mode (owner-approved 2026-09-26).** On a quiet fortnight every
reviewed NEWS mapping can age past the 14-day window into dated context, leaving
`embeds` empty. That state is published as a **warning**, never a PASS, and only when
`classifyNewsCurrency` in `news-evidence.js` proves window aging alone explains it:

- `sourceFresh` is true, there are no search ids, and `coverage` is complete with
  `cited: 0`, `searches: 0`, and 103 kept / 103 total / 0 dropped.
- `coverage.byEvidenceOwner.news` is an explicit `0`. The producer always emits the
  key; a missing key is a fault, not a zero.
- The `context | uncited` partition covers every forecast exactly once, and its counts
  match its items.
- Every reviewed mapping is a context row for its own ledger source. Each row is aged
  past the window by both its `ageDays` and its `publishedAt` against `updated`, and
  no future-dated row qualifies. There is no context row without a reviewed mapping.

Both `verify:currency` and `verify:news` then exit 70 with an EMPTY-CURRENT WARNING
naming the last linked news date. The main reader's "What this record contains"
panel shows one line: "No news from the last 14 days is linked yet — last linked
news: <date>". `verify` asserts the line is present exactly when `coverage.cited`
is 0.

These empty states still FAIL:

- a missing or malformed `embeds`/`context`/`uncited` partition;
- a missing or nonzero news tally;
- incomplete coverage or a stale build;
- a dropped or unaccounted mapping;
- a context row inside the window, with a forged age or future-dated;
- any live verification or schema failure. Those problems are ranked before the
  warning.

A non-empty cited channel keeps every existing check unchanged. This mode never
promotes, re-dates or pads news. New cited items come only from the reviewed
promotion path described next, at the full evidence bar.

**Reviewed recent-news promotion (2026-09-26 precedent).** New NEWS rows enter only
through `assess-url.js` → `promote-from-assessed.js`:

- the live page is re-fetched and the quote checked;
- the publisher's original date and precision are kept;
- the quote is exact and carried by index, never retyped;
- the stable text hash is recorded;
- each rationale is individual and states what the article does not show;
- company claims are labelled as the company's own;
- there is at most one new mapping per previously uncited forecast.

Refused candidates stay refused. That includes HTTP 403/406, a publisher challenge
(no bypass), an unextractable quote, a same-event duplicate or no fitting forecast.
A new article host is declared by a reviewed edit in `verify-deploy-surface.js`.

**Reviewed stable-text refresh.** When the companion check refuses a source for
stable-text drift, the source may be re-read live. If its headline, date, verbatim
quote and every relied-on claim are unchanged in meaning, a reviewed edit records the
new `textSha256`, the `previousTextSha256`, `textReviewedAt` and `textReviewReason`
("publisher page text changed; supporting quote/claim re-verified"). If the meaning
changed, revise or withdraw it instead. A hash is never refreshed blind.

## Independently review companion connections

Existing companion source/event IDs, historical dates and limitations survive.
Its original scenario/checkpoint/branch text and time assumptions must not be
rewritten by this job. The homepage forecast mapping is **not** automatic approval
for a connection to AI 2027 or AI 2040.

Prepare an explicit review JSON in the current session artifact directory. New
companion facts use existing, approved `NEWS_SOURCES` keys, not another collector
or a third ledger. Each proposed connection requires its own editorial rationale
and limitation. Do not import all canonical articles mechanically. Check 1-12
selected canonical sources per run; an empty check cannot be called successful.
The check's published scope is selected sources, not a claim to recheck every
historical companion source or every publisher on the internet.

The review document has this shape (replace all example values with actual review
results, never use them as evidence):

```json
{
  "schemaVersion": 1,
  "expectedPageSha256": "SHA256 of the current UTF-8 ai-timeline.html bytes",
  "checkpointSha256": "SHA256 of JSON.stringify(the current embedded checkpoints)",
  "reviewedBy": "Owner-authorized editorial review",
  "windowStart": "YYYY-MM-DD",
  "windowEnd": "YYYY-MM-DD",
  "summary": "Which publishers/topics were inspected, what was reviewed or rejected, and limitations.",
  "checkedSources": ["an-existing-reviewed-NEWS_SOURCES-key"],
  "entries": []
}
```

`entries: []` is the normal no-addition result when nothing qualifies. Do not
invent new facts to make a daily run look productive. To add a reviewed event,
include an object with `action: "add"`, stable `id`, `sourceKey`, original `title`
and `summary`, explicit `limitation`, `topics` drawn from capabilities/compute/work/
safety/governance, and `maps: [{checkpoint, note}]`. Those checkpoint IDs must
already exist. The helper takes publication metadata from the reviewed source,
never the mapped forecast year or check date.

For a genuine correction, use `action: "update"` with the existing event ID and a
`correctionNote`. The same original source and event date are retained; corrections
are recorded rather than silently replacing history. New article duplicates are
refused by canonical URL. Month-only historical dates stay month-only; a new
canonical NEWS admission must satisfy the existing precise-date gate.

Apply the review through the guarded helper:

```powershell
node refresh-timeline-actuals.js --review=ABSOLUTE_REVIEW_JSON --dry-run
node refresh-timeline-actuals.js --review=ABSOLUTE_REVIEW_JSON
```

The helper reruns `verifyNewsSource` with `requireStableText: true`, using the
existing bounded HTTPS transport (20 seconds, 4 MiB decoded body, at most six
approved redirects) or an explicitly declared existing browser transport. It
checks the page identity and scenario fingerprint before editing; unexpected
concurrent changes abort. It modifies embedded actuals only, atomically, with no
forecast/checkpoint mutation. It preserves the original source/mapping review date
for untouched entries.

`actualsCheck.checkedAt` records a completed selected-source check, while
`contentChangedAt` advances only if the reviewed facts or connections change.
The browser shows these separately and marks checks over 36 hours old as overdue.
A failed source check retains the previous facts and last successful check time,
records a failed attempt locally and exits nonzero. **Do not deploy a partial
run.** Production then retains its last published status and becomes visibly
overdue; do not claim the local failure status reached production.

For transient transport failures only, retry the same unchanged operation at most
three times with approximately 30-second, 2-minute, and 5-minute backoff, respecting
Retry-After. Never retry past a changed quote/hash/headline, failed relevance review,
invalid mapping, concurrency refusal, or forbidden surface. Never replace or drop
a source because its transport failed.

## Verify the combined result and publish once

Verify protected hashes and confirm no source date was replaced by a check date.
Run the current commands; do not hardcode an outdated list of gate counts:

```powershell
node validate-predictions.js
node build-game.js --write
node verify-ai-timeline.js
powershell -ExecutionPolicy Bypass -File .\run-gates.ps1 -IsolatedPreview -CandidateSurface
```

`-CandidateSurface` points `verify:surface:live` at the owned loopback candidate, because
production cannot already serve the new companion/check bytes before deployment. It is
explicitly labelled NOT production; `deploy.ps1` then runs the same verifier with
`--live` against both domains, and the postflights below remain mandatory.

The game rebuild is a deterministic source-index projection only, not gameplay
work. The derived suite includes both monthly UIs, exact forecast joins, source
accounting, provenance, freshness, preservation, budgets, and public-surface checks.
Currency exit 70 remains **inert**, not a verified currency result or a failure.
`verify:news` exit 70 with named `LAST-GOOD WARNING` lines is likewise a warning
state (publication may proceed); exit 1 still blocks. Report each retained key, its
challenge marker, last verified date and `retainedUntil`; never report those keys as
live-verified.
Record every refusal explicitly. Do not increase budgets, drop fixtures, suppress
source errors, or promote private operator tools to make publication pass.

Check the exact curated mirror candidate, then run its derived suite as well. Build
it from this tree only, outside every source root, with the publisher's own inventory
and generated public package (operator-only commands remain omitted). Run this block
from `C:\Users\peterxing\pap-deploy` under the same owner. It needs no session or
helper files:

```powershell
$candidate = Join-Path $env:LOCALAPPDATA ('Temp\pap-curated-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmss'))   # long path; not the 8.3 %TEMP% form
$publisher = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PWD 'publish-github.ps1'), [ref]$null, [ref]$null)
function Get-PublisherList([string]$Name) {
  @($publisher.Find({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.VariablePath.UserPath -eq $Name }, $true).Right.Expression.SafeGetValue())
}
. ([scriptblock]::Create($publisher.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'ConvertTo-PublicPackage' }, $true).Extent.Text))
$fromDeploy = Get-PublisherList 'fromDeploy'; $fromSite = Get-PublisherList 'fromSite'; $baseline = Get-PublisherList 'repositoryBaseline'
New-Item -ItemType Directory -Path $candidate | Out-Null
foreach ($set in @(@($PWD.Path, $fromDeploy), @('C:\Users\peterxing\pap-site', $fromSite), @('C:\Users\peterxing\pap-github', $baseline))) {
  foreach ($name in $set[1]) { Copy-Item -LiteralPath (Join-Path $set[0] $name) -Destination (Join-Path $candidate $name) -ErrorAction Stop }
}
$package = ConvertTo-PublicPackage -Source (Join-Path $PWD 'package.json') -AllowList @($fromDeploy + $fromSite + $baseline)
[IO.File]::WriteAllText((Join-Path $candidate 'package.json'), (($package | ConvertTo-Json -Depth 20) + "`n"), (New-Object Text.UTF8Encoding($false)))
Push-Location $candidate
npm ci --ignore-scripts --no-audit --no-fund
Pop-Location
@(Get-ChildItem -LiteralPath (Join-Path $candidate 'node_modules') -Recurse -Force -Attributes ReparsePoint).Count   # must be 0
```

The harness install is the only addition to the candidate:

- `npm ci` reads the candidate's own curated `package-lock.json`. Record its sha256
  together with the `node` and `npm` versions.
- `--ignore-scripts` runs no install script and downloads no browser. The browser
  gates launch the installed Microsoft Edge channel.
- Never create a junction, symlink or hardlink to `pap-deploy\node_modules`. A
  recursive clean-up can follow a link and delete its target. The reparse-point
  count above must be 0.
- `node_modules` is harness-only and never published. The publisher copies only its
  explicit inventory and refuses `node_modules`.

Close this run's own browsers and previews and let the host idle for about three
minutes. Then run `verify:game-performance` first, against an owned preview of the
candidate, and the full derived suite after it:

```powershell
$env:PAP_NEWS_MIRROR = 'C:\Users\peterxing\pap-github'   # read-only last-good provenance
Start-Sleep -Seconds 180
$port = 8796
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "port $port is busy" }
$preview = Start-Process -FilePath node -ArgumentList 'server.js', "--port=$port" -WorkingDirectory $candidate -PassThru -WindowStyle Hidden
for ($i = 0; $i -lt 50 -and -not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 200 }
$env:PAP_SITE_URL = "http://127.0.0.1:$port"
$env:PAP_GAME_PERFORMANCE_RECEIPT = "$candidate-game-performance.json"
Push-Location $candidate; npm run verify:game-performance; $gameExit = $LASTEXITCODE; Pop-Location
$preview.Kill()   # this run's own preview process only
Remove-Item Env:PAP_SITE_URL, Env:PAP_GAME_PERFORMANCE_RECEIPT
powershell -ExecutionPolicy Bypass -File (Join-Path $candidate 'run-gates.ps1') -IsolatedPreview -CandidateSurface
```

Both game measurements are recorded. The receipt from the first run sits beside the
candidate. No gate is rerun after a failure.

**Game-performance metric fallback (user-approved 26 September 2026).** One narrow case
may count the same run's earlier pass instead of stopping. All of these must hold:

- the failure is in `verify:game-performance`, and only on its startup or frame-p95
  budget;
- it happens in the curated replay or a production postflight;
- the nine game runtime files are hash-identical to the bytes that passed earlier in
  this run, and to the live and mirror bytes. The nine are `game.html`, `game.css`,
  `game-entry.js`, `game-core.mjs`, `game-data.mjs`, `game-ui.mjs`, `game-world.mjs`,
  `three.webgpu.min.js` and `three.core.min.js`.

Record both measurements. Every other failure still stops the run. That includes a
functional `verify:game` failure and any byte, surface, source or UI failure. No
budget changes.

`deploy.ps1` and `publish-github.ps1` both accept `verify:news` exit 70 and abort on
any other non-zero code. Exit 70 has exactly three routes, and the gate names every
item in each:

- `couldn't recheck today` last-good keys, each with its expiry;
- the `EMPTY-CURRENT WARNING`;
- proofs that were not exercised.

The run report states which route fired. A candidate-surface test is not a production
postflight.

Only after eligibility and preservation are established, use the existing order:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\peterxing\pap-site\deploy.ps1 -RequireGameReady
powershell -ExecutionPolicy Bypass -File .\publish-github.ps1 -RequireGameReady
```

Require both-domain real runtime/data/companion hash, monthly UI, source/dossier,
author, game and surface postflights after deployment and again after the Git
triggered deployment. Confirm the actual remote commit and READY deployment; do
not infer them from helper invocation. Exact same-origin clean-URL redirects must
end in the approved canonical bytes, not arbitrary redirect acceptance. Run the
postflight from this tree. The runtime list is derived from `deploy.ps1`, never
restated:

```powershell
$deployAst = [System.Management.Automation.Language.Parser]::ParseFile('C:\Users\peterxing\pap-site\deploy.ps1', [ref]$null, [ref]$null)
$runtime = @($deployAst.Find({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.VariablePath.UserPath -eq 'runtimeFiles' }, $true).Right.Expression.SafeGetValue())
$handler = [System.Net.Http.HttpClientHandler]::new(); $handler.AllowAutoRedirect = $false
$http = [System.Net.Http.HttpClient]::new($handler); $http.DefaultRequestHeaders.CacheControl = [System.Net.Http.Headers.CacheControlHeaderValue]::Parse('no-cache')
$sha = [System.Security.Cryptography.SHA256]::Create(); $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); $bad = @()
foreach ($base in 'https://peterxing.com', 'https://post-agi-planning.vercel.app') {
  foreach ($name in $runtime) {
    $route = if ($name -eq 'index.html') { '/' } elseif ($name -like '*.html') { '/' + $name.Substring(0, $name.Length - 5) } else { "/$name" }
    $expected = (Get-FileHash -LiteralPath (Join-Path $PWD $name) -Algorithm SHA256).Hash
    $response = $http.GetAsync("$base$($route)?pf=$stamp").Result
    $actual = [BitConverter]::ToString($sha.ComputeHash($response.Content.ReadAsByteArrayAsync().Result)).Replace('-', '')
    if ([int]$response.StatusCode -ne 200 -or $actual -ne $expected) { $bad += "$base$route HTTP $([int]$response.StatusCode)" }
    if ($name -like '*.html') {
      $direct = $http.GetAsync("$base/$name").Result
      $status = [int]$direct.StatusCode
      if ($status -in 301, 308) {
        $target = [Uri]::new([Uri]"$base/$name", $direct.Headers.Location).AbsoluteUri
        if ($target -ne ([Uri]"$base$route").AbsoluteUri) { $bad += "$base/$name redirects to $target" }
      } elseif ($status -ne 200 -or [BitConverter]::ToString($sha.ComputeHash($direct.Content.ReadAsByteArrayAsync().Result)).Replace('-', '') -ne $expected) {
        $bad += "$base/$name HTTP $status"
      }
    }
  }
}
if ($bad.Count) { throw "Production bytes differ: $($bad -join '; ')" }
foreach ($base in 'https://peterxing.com/', 'https://post-agi-planning.vercel.app/') {
  $env:PAP_SITE_URL = $base
  foreach ($gate in 'verify-site.js', 'verify-observatory.js', 'verify-reality.js', 'verify-perpred.js', 'verify-author.js',
                    'verify-metr.js', 'verify-reference-points.js', 'verify-game.js', 'verify-game-performance.js') {
    node $gate; if ($LASTEXITCODE -ne 0) { throw "$gate failed on $base (exit $LASTEXITCODE)" }
  }
}
Remove-Item Env:PAP_SITE_URL
node verify-deploy-surface.js --live
```

The byte check covers every runtime file on both domains. Each `.html` file is checked
through its clean route, and a redirect must name exactly that same-origin route. The
companion's `308 -> 200` is also asserted by `verify-deploy-surface.js --live`, with
the reviewed hash. Only the fallback above may count an earlier pass, and only for a
`verify-game-performance.js` startup or frame-p95 failure. Record the measurement.
Confirm the remote commit with
`git ls-remote https://github.com/peterxing/post-agi-planning.git refs/heads/main`.

The hardened publisher must retain clean expected branch/remote checks, ff-only
updates, and data preservation on commit/push failures. Never reset, stash, clean,
delete a root, stop another owner's preview, or modify the scheduler here.

If deployment succeeds but Git publication fails, say **live deployed / mirror
pending** and preserve the local commit and receipts. Do not call the whole run
complete or roll back unrelated work. Finish by reporting actual new/revised facts
versus unchanged checks, NEWS last-good warnings ("couldn't recheck today": key,
reason, last verified date, expiry), any EMPTY-CURRENT WARNING (with the last linked
news date), search/source limits, independent timestamps,
real URLs/commit or the precise blocker, and the normal lock release.
