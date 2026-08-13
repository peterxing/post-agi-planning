<#
  publish-github.ps1 — mirror the curated, SECRET-FREE public file set into the
  GitHub repo peterxing/post-agi-planning and push to main.

  Used by the hourly automation (and runnable by hand). It NEVER copies anything
  from the secrets store and only ever copies an explicit allow-list of public files,
  so credentials/caches/logs/binaries can never leak. The auth token is used only
  as an ephemeral push URL (never written into .git/config), and is scrubbed from
  any printed output.

  Token resolution is delegated to publish-credentials.ps1, which is deliberately NOT on
  the allow-list and therefore never published. The split is drawn on AUTHORITY, not on
  secrecy: this file decides WHAT is published and is itself published so that the four
  verifiers which read it as their subject can be falsified from the mirror alone; the
  helper decides only WHO WE AUTHENTICATE AS and can neither add, remove nor rename a
  published file. A missing or malformed helper is fail-closed as exit 2.

  ENCODING CONTRACT: this file MUST keep its UTF-8 BOM. Windows PowerShell 5.1 decodes a
  BOM-less file as ANSI/CP1252, where the three bytes of an em dash become a-circumflex,
  euro, and 0x94 - and CP1252 0x94 is a RIGHT DOUBLE QUOTATION MARK, which PowerShell honours
  as a string delimiter. Every em dash inside a double-quoted string therefore terminates that
  string early and the whole script fails to parse at RUN time. That is not hypothetical: this
  script was unrunnable on 2026-08-13 for exactly this reason. The trap is silent because the
  four verifiers that read this file read it as TEXT and pass on a file that cannot parse, and
  because ParseFile called from a UTF-8 host reports it clean. Verify with the 5.1 host itself.
  Keep the BOM, or keep every string ASCII-only. Do not do neither.

  EXIT CODES — two outcomes share a code only if they imply the SAME NEXT ACTION. Severity is
  not the criterion; remedy is. A code whose members demand opposite responses is empty, because
  the reader must go and establish the fact the code was supposed to carry.
    0  ok (pushed, or nothing to push)
    2  no token                         -> supply one; nothing was attempted
    3  ALLOW-LIST BOUNDARY: an approved source is missing, or a path outside the public
       allow-list is present/staged     -> TERMINAL. A human reconciles the tree with the
                                           allow-list. NEVER retry past this: it is the
                                           fail-closed deploy-surface gate.
    4  git push failed                  -> re-run
    5  git clone/fetch/reset/add failed -> re-run (git transport; stages nothing, decides nothing)
    6  EVIDENCE: a gate ran and rejected the site -> a human fixes the evidence; re-running
                                           changes nothing
    7  INSTRUMENT: a preflight verifier is absent -> restore the gate. The chain never ran, so
                                           this is not a finding about the evidence
    75 DEFERRED: another live actor holds the pap-deploy tree, or a cited currency source was
       unreachable                      -> re-run; published nothing, changed nothing, and the
                                           next scheduled run must treat it as a MISSED RUN
  `git add` failing is a git transport fact like clone/fetch/reset, not an allow-list breach; it
  was under 3, which taught a reader that 3 means "a git hiccup, re-run it" — the one code here
  that must never be retried past.
#>
[CmdletBinding()]
param(
  [string]$Clone  = 'C:\Users\peterxing\pap-github',
  [string]$Deploy = 'C:\Users\peterxing\pap-deploy',
  [string]$Site   = 'C:\Users\peterxing\pap-site',
  [string]$Repo   = 'github.com/peterxing/post-agi-planning',
  [string]$Branch = 'main'
)
# NOTE: git/node write progress + harmless warnings (e.g. "LF will be replaced by
# CRLF") to stderr; under 'Stop' PowerShell turns those into fatal errors. So run
# with 'Continue' and judge every git command by its exit code ($LASTEXITCODE).
$ErrorActionPreference = 'Continue'

$coverageVerifier = Join-Path $Deploy 'verify-direct-coverage.js'
$newsVerifier = Join-Path $Deploy 'verify-news-evidence.js'
$currencyVerifier = Join-Path $Deploy 'verify-currency.js'
$surfaceVerifier = Join-Path $Deploy 'verify-deploy-surface.js'
$interlockVerifier = Join-Path $Deploy 'verify-interlock.js'
if (-not (Test-Path $coverageVerifier) -or -not (Test-Path $newsVerifier) -or -not (Test-Path $currencyVerifier) -or -not (Test-Path $surfaceVerifier) -or -not (Test-Path $interlockVerifier)) {
  Write-Error 'publish-github: evidence preflight verifier is missing; publication aborted.'
  exit 7
}
Push-Location $Deploy
# A GATE THAT NEVER RAN HAS NO RESULT. Skips were recorded as 1, so one gate returning non-zero
# made the abort message assert a failure for up to seven programs that were never executed --
# evidence naming something that did not happen. A skip is $null and renders as 'skipped'.
# Control flow is unchanged: PowerShell evaluates `$null -eq 0` and `1 -eq 0` both as False, so
# every gating condition below behaves exactly as before; only what is REPORTED changes.
# X RETIREMENT 2026-08-13 — the archive, Peter and external gates verified X evidence that no longer
# exists. They are removed, not stubbed: a gate kept alive over an empty subject reports green for
# having nothing to check, which is the one reading this chain must never produce. Coverage, news,
# currency, surface and interlock are unchanged and still gate publication.
& node $coverageVerifier
$coverageExit = $LASTEXITCODE
if ($coverageExit -eq 0) {
  & node $newsVerifier
  $newsExit = $LASTEXITCODE
  if ($newsExit -eq 0) {
    & node $currencyVerifier
    $currencyExit = $LASTEXITCODE
  } else {
    $currencyExit = $null
  }
  if ($currencyExit -eq 0 -or $currencyExit -eq 70) {
    & node $surfaceVerifier
    $surfaceExit = $LASTEXITCODE
  } else {
    $surfaceExit = $null
  }
  if ($surfaceExit -eq 0) {
    & node $interlockVerifier
    $interlockExit = $LASTEXITCODE
  } else {
    $interlockExit = $null
  }
} else {
  $newsExit = $null
  $currencyExit = $null
  $surfaceExit = $null
  $interlockExit = $null
}
Pop-Location
# Exit 70 from the currency verifier is PASSED BUT INERT: nothing failed, and nothing was
# verified on one or more axes. That is a legitimate, truthful state and it must NOT block
# publication — refusing to publish because an optional layer aged out is the same defect as
# demoting evidence for a network fault. But it must not be counted as a verified currency
# layer either. The gate announces its own inertness on stdout; this chain decides on
# $LASTEXITCODE alone, so without a distinct code an inert gate and a verified gate are the
# same byte here.
# THIS WARNING USED TO NAME BOTH THE CAUSE ("the currency layer is empty") AND THE AXES
# ("fabrication, age-pin, refresh-relation and live-drift"). Both were hand-maintained copies
# of facts owned by verify-currency.js, in a different file and a different language, and the
# moment that gate registered a fifth inert axis — age judgement, when the recorded ceiling is
# refused — this line would have kept printing a confident, complete-sounding, WRONG sentence:
# a cause that did not apply and a list missing the axis that suppresses the demotion sweep.
# An inventory restated away from its source is a claim, and this one had no way to fail. The
# gate prints the axes it actually registered, immediately above; this line now points at them
# instead of paraphrasing them.
$currencyInert = ($currencyExit -eq 70)
if ($currencyInert) {
  Write-Warning "publish-github: currency gate PASSED BUT INERT — one or more axes verified NOTHING on this run; the gate listed them by name under 'verify:currency PASSED BUT INERT' above. Publication proceeds; this run does not establish the currency evidence."
}
# TWO OUTCOMES MAY SHARE AN EXIT CODE ONLY IF THEY IMPLY THE SAME NEXT ACTION. Two facts reach
# this verdict and they demand opposite responses:
#   6  the site was MEASURED and rejected  -> a human fixes the evidence; re-running changes nothing.
#   75 DEFERRED, nothing was measured      -> re-run; nothing was published, changed or demoted.
# Only the currency gate's 75 was distinguished, so a deferral from any of the other seven was
# reported as "direct evidence preflight failed" — sending an operator to audit evidence that was
# never found wanting, and erasing the CATCH-UP that a deferred run obliges the next one to take.
$gates = [ordered]@{
  coverage = $coverageExit; news     = $newsExit;     currency = $currencyExit
  surface  = $surfaceExit;  interlock = $interlockExit
}
$render = (($gates.GetEnumerator() | ForEach-Object {
  '{0}={1}' -f $_.Key, $(if ($null -eq $_.Value) { 'skipped' } else { $_.Value })
}) -join ' ')
$measured = @($gates.GetEnumerator() | Where-Object { $null -ne $_.Value })
$deferred = @($measured | Where-Object { $_.Value -eq 75 })
# A gate that CRASHED is a third thing again. verify-currency.js exits 76 when it throws before
# completing: its figures are void, but re-running reproduces it, so it is neither the 6 remedy
# (a human fixes the evidence) nor the 75 one (re-run and it clears). Folded into $faults it
# would be reported as "direct evidence preflight failed" — sending an operator to audit
# evidence that was never measured, the same misdirection the 75 special case was fixed for.
# It joins exit 7, INSTRUMENT, which already means "the verifier itself is not usable".
$instrument = @($measured | Where-Object { $_.Value -eq 76 })
$faults   = @($measured | Where-Object {
  $_.Value -ne 0 -and $_.Value -ne 75 -and $_.Value -ne 76 -and -not ($_.Key -eq 'currency' -and $_.Value -eq 70)
})
# PRECEDENCE IS LOAD-BEARING: a gate that RAN and rejected the site outranks a deferral, so a real
# evidence fault can never be masked by another actor taking the tree mid-chain. A crashed gate
# does not mask a completed rejection either -- but it is NAMED in that message, because a void
# instrument must never become invisible just because a different gate also had something to say.
if ($faults.Count -gt 0) {
  $alsoBroken = if ($instrument.Count -gt 0) { " ALSO: $(($instrument | ForEach-Object { $_.Key }) -join ', ') exited 76 (INSTRUMENT FAULT) — every figure from those gates is void and must not be read." } else { '' }
  Write-Error "publish-github: direct evidence preflight failed; publication aborted ($render). A 'skipped' gate did not run and made no finding.$alsoBroken"
  exit 6
}
if ($instrument.Count -gt 0) {
  Write-Error "publish-github: INSTRUMENT FAULT ($render) — $(($instrument | ForEach-Object { $_.Key }) -join ', ') exited 76: the verifier threw before completing. No gate rejected the site. DISCARD EVERY FIGURE FROM THIS RUN, including any that looks right; re-running will reproduce it. Fix the instrument, do not audit the evidence."
  exit 7
}
if ($deferred.Count -gt 0) {
  # 75 arrives here from TWO producers: pipeline-lock's guard() (another live actor holds the
  # pap-deploy tree — this publisher takes no session lock of its own, so the tree can be claimed
  # between two consecutive gates) and verify-currency.js (a cited source unreachable or serving a
  # bot challenge). They share a code legitimately because they share a REMEDY. They must not share
  # a DIAGNOSIS: this chain sees only the exit code, so naming one mechanism would be an accusation
  # about something it never observed. Both are named; neither is asserted.
  Write-Warning "publish-github: DEFERRED ($render) — $(($deferred | ForEach-Object { $_.Key }) -join ', ') exited 75. Nothing was published, changed or demoted. The cause is ONE OF: another live actor holds the pap-deploy tree, or a cited currency source was unreachable/served a bot challenge — this chain sees only the exit code and does not assert which. Re-run; the next scheduled run must treat this as a MISSED RUN and proceed as a CATCH-UP."
  exit 75
}

function Resolve-Token {
  # Token resolution lives in publish-credentials.ps1, which is deliberately NOT published.
  # The split is drawn on AUTHORITY, not on secrecy: everything that decides WHAT is published
  # is in this file and is published; only WHO WE AUTHENTICATE AS is withheld. Nothing in the
  # credentials helper can add, remove or rename a published file, so withholding it cannot
  # conceal a change to the deploy surface — which is what makes this file safe to publish and
  # therefore makes the four verifiers that read it falsifiable from the mirror alone.
  $helper = Join-Path $Deploy 'publish-credentials.ps1'
  if (-not (Test-Path $helper)) {
    # FAIL CLOSED, and as code 2 rather than 5: no token was resolved and nothing was attempted,
    # which is exactly what 2 already means. A missing helper must never fall through to an
    # unauthenticated push attempt or to a $null token that reads as "no token configured".
    Write-Error "publish-github: credential helper not found at $helper — token resolution is unavailable, nothing was attempted."
    exit 2
  }
  . $helper
  if (-not (Get-Command Resolve-PublishToken -ErrorAction SilentlyContinue)) {
    Write-Error "publish-github: credential helper did not define Resolve-PublishToken; nothing was attempted."
    exit 2
  }
  return Resolve-PublishToken
}

$tok = Resolve-Token
if (-not $tok) { Write-Error 'publish-github: no GitHub token (set GH_PUBLISH_TOKEN, add it to the credential helper source, or provide the @peterxing Copilot token).'; exit 2 }

$cloneUrl = "https://$Repo.git"
$pushUrl  = "https://x-access-token:$tok@$Repo.git"

# 1) Ensure a current clone (tokenless remote in config).
if (-not (Test-Path (Join-Path $Clone '.git'))) {
  if (Test-Path $Clone) { Remove-Item -Recurse -Force $Clone }
  git clone --quiet $cloneUrl $Clone 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Error "publish-github: clone failed ($LASTEXITCODE)"; exit 5 }
}
Set-Location $Clone
git remote set-url origin $cloneUrl 2>&1 | Out-Null
# Silence the LF/CRLF rewrite warning (content is generated with LF).
git config core.autocrlf false 2>&1 | Out-Null
git config core.safecrlf false 2>&1 | Out-Null
git fetch --quiet origin $Branch 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error "publish-github: fetch failed ($LASTEXITCODE)"; exit 5 }
git checkout --quiet $Branch 2>&1 | Out-Null
git reset --hard --quiet "origin/$Branch" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error "publish-github: reset failed ($LASTEXITCODE)"; exit 5 }

# 2) Copy the curated PUBLIC allow-list (explicit names only — never wildcards).
# X RETIREMENT 2026-08-13 - verify-id.js was REMOVED from this list because the file itself was
# deleted: it made a live call to cdn.syndication.twimg.com, the last network egress to an X host
# in the tree. It is not merely dropped here -- verify-interlock.js RETIRED_ENTRY_POINTS asserts
# it stays ABSENT, so restoring the file fails that gate until it is re-guarded. Naming an
# approved source that does not exist aborts publication at exit 3 (TERMINAL), so a deletion
# anywhere in the tree must be paid for HERE in the same change.
$fromDeploy = @(
  'README.md','package.json','index.html','app.js','styles.css','predictions.json','signals.json','author.json','evidence-floors.json','external-evidence.js','news-evidence.js','currency-evidence.js','currency-subjects.js','currency-text-pins.json',
  'server.js','refresh-signals.js','pipeline-lock.js',
  'validate-predictions.js','verify-site.js','verify-signal-matcher.js','verify-perpred.js','verify-reality.js','verify-author.js','verify-observatory.js','verify-performance.js','verify-direct-coverage.js','verify-news-evidence.js','verify-currency.js','verify-deploy-surface.js','verify-interlock.js','evidence-families.js',
  # month-estimates.js is mirrored because validate-predictions.js L10 IMPORTS EXECUTABLE
  # PREDICATES from it (bandForYear, precisionForBand), not merely data. A gate whose
  # imported behaviour lives outside the published set can change what `npm run validate`
  # accepts — and how precision is computed — without moving any hash either side can quote.
  # Publishing the gate while withholding its logic makes the gate's pin unfalsifiable.
  'month-estimates.js',
  # publish-github.ps1 publishes ITSELF. Four tracked verifiers (verify-archive-corpus,
  # verify-deploy-surface, verify-interlock, verify-performance) read this file as their
  # SUBJECT and assert things about its allow-list and its forbidden pattern. While it was
  # unpublished those four gates were pinned to a subject nobody could fetch — readable in
  # full from the mirror, and silent on whether they pass. Worse, the CLOSURE GATE above,
  # which guarantees the published set is closed, lived in the one file outside that set:
  # the guarantor was the least falsifiable thing in the tree. Publishing it is safe because
  # token resolution now lives in publish-credentials.ps1, which stays off this list.
  'publish-github.ps1',
  'launch.ps1','watchdog.ps1','REVISE-PREDICTIONS.md'
)
$fromSite = @('deploy.ps1','vercel.json','_headers','.vercelignore')
$repositoryBaseline = @('.env.example','.gitignore','LICENSE')
$copiedAllowlist = @($fromDeploy + $fromSite)
$publicAllowlist = @($copiedAllowlist + $repositoryBaseline)

# CLOSURE GATE — the allow-list must be closed under `require`.
# A published gate that imports from an UNPUBLISHED module is a gate nobody can falsify:
# validate-predictions.js pinned cleanly at 21995 b while importing bandForYear/precisionForBand
# — executable predicates — from month-estimates.js, which was outside this list entirely. Its
# 22832 bytes could change what `npm run validate` accepts, and how precision is computed, with
# no hash on either side moving. Auditing the instance is not enough; the list has to stay closed
# on its own. This refuses to publish rather than shipping a gate without its imported behaviour.
$closureHoles = @()
# SCOPE — the sweep's subject must be the SAME SET this script publishes, and must be read from
# the SAME ROOT it copies from. Two defects were found here by review and are fixed rather than
# documented: (1) the sweep iterated $fromDeploy while testing membership against $publicAllowlist,
# so any .js added to $fromSite would have escaped the sweep entirely — vacuous today because
# $fromSite holds no .js, and a latent hole precisely because it is vacuous; (2) it read
# $PSScriptRoot while the copy loop below reads $Deploy, which is a PARAMETER that merely defaults
# to this directory, so the first invocation passing -Deploy would have cleared one copy and
# published a different one. Each set is now swept against the root it is actually copied from.
$sweepTargets = @()
foreach ($f in $fromDeploy) { $sweepTargets += ,@($f, $Deploy) }
foreach ($f in $fromSite)   { $sweepTargets += ,@($f, $Site) }

# DATA CHANNEL — `readFileSync` is not a `require`, so closing the require graph alone leaves a
# published gate free to take its SUBJECT from an unpublished file. That is not hypothetical: four
# tracked verifiers read publish-github.ps1 this way while it was unpublished, so every byte of
# them was fetchable from the mirror and none of it revealed whether they passed.
# Runtime OUTPUTS are legitimately excluded — but they are DERIVED from the forbidden denylist
# below rather than restated as a second list of names. Restating them was the first thing tried
# and it was wrong twice over: a second list drifts from the first, and it spelled the lock file's
# name as a quoted literal, which verify-interlock.js read — correctly — as this script placing
# that name on an allow-list. A name-based gate cannot distinguish "excluded from a sweep" from
# "permitted to publish", so the exclusion must never spell the name out. One list, one meaning.
# This comment does not spell it either: the first rewrite of these lines quoted the offending
# literal while explaining it, and re-tripped the same gate from the prose describing the trap.
$forbiddenPattern = '(?i)(^|/)\.env(\.(?!example)[^/]*)?$|x-activity|x-status-corpus|x-wayback|x-external-account|timeline-raw|signals-debug|x-debug|evidence-approvals|(^|/)\.pipeline\.lock$|cloudflared\.exe|(^|/)url\.txt$|\.log$|node_modules|(^|/)\.vercel(/|$)|publish-credentials\.ps1'

foreach ($pair in $sweepTargets) {
  $f = $pair[0]; $root = $pair[1]
  if ($f -notlike '*.js') { continue }
  $p = Join-Path $root $f
  if (-not (Test-Path $p)) { continue }
  $src = Get-Content $p -Raw
  foreach ($m in [regex]::Matches($src, "require\(\s*['""](\./[^'""]+)['""]\s*\)")) {
    $dep = $m.Groups[1].Value -replace '^\./',''
    if ($dep -notmatch '\.(js|json)$') { $dep += '.js' }
    if ($publicAllowlist -notcontains $dep) { $closureHoles += "$f requires $dep" }
  }
  foreach ($m in [regex]::Matches($src, "path\.join\(\s*(?:DIR|__dirname|ROOT|SITE|DEPLOY)\s*,\s*['""]([^'""]+)['""]\s*\)")) {
    $dep = $m.Groups[1].Value
    if ($dep -match '[\\/]') { continue }
    if ($dep -match $forbiddenPattern) { continue }
    if ($publicAllowlist -notcontains $dep) { $closureHoles += "$f reads $dep" }
  }
}
if ($closureHoles) {
  Write-Error "publish-github: ALLOW-LIST NOT CLOSED UNDER require — a published file imports a module that is not published, so the published gate cannot be verified from the published set: $(($closureHoles | Sort-Object -Unique) -join '; ')"
  exit 3
}

# Bump each copied file's mtime so git always re-stats it. Without this, when the
# new file has the SAME byte size as the committed one (common: signals.json keeps
# the same structure hour-to-hour, only timestamps/text change) and Copy-Item lands
# the mtime in the same second as the preceding `git reset --hard`, git's stat-cache
# trusts the cached blob, explicit staging sees no change, and a real update is silently
# skipped. A future mtime forces a content re-hash; identical content still yields no
# diff, so unchanged files never create spurious commits.
$touch = (Get-Date).AddSeconds(5)
foreach ($f in $fromDeploy) {
  $p = Join-Path $Deploy $f
  if (-not (Test-Path $p)) { Write-Error "publish-github: approved deploy source missing: $f"; exit 3 }
  $d = Join-Path $Clone $f
  Copy-Item $p $d -Force
  (Get-Item $d).LastWriteTime = $touch
}
foreach ($f in $fromSite) {
  $p = Join-Path $Site $f
  if (-not (Test-Path $p)) { Write-Error "publish-github: approved site source missing: $f"; exit 3 }
  $d = Join-Path $Clone $f
  Copy-Item $p $d -Force
  (Get-Item $d).LastWriteTime = $touch
}

# X RETIREMENT 2026-08-13 - files this publisher USED to carry and no longer approves. The copy
# step above only ever ADDS, so a withdrawn file stays tracked in the mirror forever and trips the
# allow-list scan below at exit 3 on every future run. Declaring them by name WITH the reason keeps
# the gate fail-closed: only these DECLARED retirements are deleted, and any other unapproved path
# still aborts publication rather than being silently destroyed. Removing a name from this list
# once the mirror no longer carries it is safe; adding one is a decision to DELETE from the mirror.
$retiredFromMirror = @(
  'x-client.js',                    # X API client
  'x-auth.js',                      # X API OAuth
  'x-archive.js',                   # Wayback/X archive harvester
  'harvest-loop.js',                # X corpus harvest loop
  'review-evidence-candidates.js',  # X candidate review tool
  'verify-id.js',                   # called cdn.syndication.twimg.com, the last X network egress
  'verify-peter-evidence.js',       # verified @peterxing X mappings
  'verify-external-evidence.js',    # verified external X statuses
  'verify-archive-corpus.js',       # verified the X status corpus
  'evidence-approvals.json',        # the reviewed X approvals ledger itself
  'X-API-SETUP.md'                  # X API setup documentation
)
$stillTracked = @(git ls-files) | Where-Object { $_ -in $retiredFromMirror }
if ($stillTracked) {
  git rm --quiet -- $stillTracked 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Error "publish-github: retiring withdrawn mirror paths failed ($LASTEXITCODE)"; exit 5 }
  Write-Host "publish-github: retired from mirror: $($stillTracked -join ', ')"
}

# 3) Fail closed on any path outside the explicit public allow-list, then stage only copied paths.
$tracked = @(git ls-files)
$untracked = @(git ls-files --others --exclude-standard)
$ignoredUntracked = @(git ls-files --others --ignored --exclude-standard)
$unexpectedTracked = $tracked | Where-Object { $_ -notin $publicAllowlist }
$unexpectedUntracked = $untracked | Where-Object { $_ -notin $publicAllowlist }
$unexpectedIgnored = $ignoredUntracked | Where-Object { $_ -notin $publicAllowlist }
if ($unexpectedTracked -or $unexpectedUntracked -or $unexpectedIgnored) {
  Write-Error "publish-github: repository contains non-allow-listed paths (tracked: $($unexpectedTracked -join ', '); untracked: $($unexpectedUntracked -join ', '); ignored: $($unexpectedIgnored -join ', '))."
  exit 3
}
git add -- $copiedAllowlist 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error "publish-github: explicit staging failed ($LASTEXITCODE)"; exit 5 }
$staged = @(git diff --cached --name-only)
$unexpectedStaged = $staged | Where-Object { $_ -notin $copiedAllowlist -and $_ -notin $retiredFromMirror }
# A DELETION is the opposite of a publication. evidence-approvals.json is now matched by
# $forbiddenPattern precisely so it can never be published, and removing it from the mirror is how
# that is enforced - so testing the forbidden pattern against a staged deletion would abort the
# very act that satisfies it. Only paths staged for ADDITION or MODIFICATION are tested.
$stagedNotDeleted = @(git diff --cached --name-only --diff-filter=d)
$forbidden = $stagedNotDeleted | Where-Object { $_ -match $forbiddenPattern }
if ($unexpectedStaged -or $forbidden) {
  git reset --hard --quiet "origin/$Branch" 2>&1 | Out-Null
  Write-Error "publish-github: non-allow-listed or forbidden file staged, aborted: $(@($unexpectedStaged + $forbidden) -join ', ')"; exit 3
}

# 4) Commit + push only when there is a real change.
if (-not $staged -or $staged.Count -eq 0) { Write-Host 'publish-github: no changes to push.'; exit 0 }
$stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm')
git -c user.name='Peter Xing' -c user.email='peterxing@users.noreply.github.com' commit -q `
  -m "Site sync: predictions, signals, book & author ($stamp)" `
  -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>" 2>&1 | Out-Null

$out = (git push $pushUrl "HEAD:$Branch" 2>&1 | Out-String)
$code = $LASTEXITCODE
$out = $out.Replace($tok, '***')                       # scrub token from any echoed URL
Write-Host $out.Trim()
if ($code -ne 0) { Write-Error "publish-github: git push failed ($code)"; exit 4 }
Write-Host "publish-github: pushed $($staged.Count) file(s) to $Repo@$Branch."
exit 0
