# deploy.ps1 — pushes the static site in this folder to Vercel production.
# Headless through the Vercel CLI's cached login so the daily refresh workflow can call it unattended.
#
# One-time setup (you, in a terminal):
#   1) npm i -g vercel              # already installed by the assistant
#   2) vercel login                 # browser auth to YOUR Vercel account
#   3) cd C:\Users\peterxing\pap-site ; vercel link   # pick/create the project (e.g. post-agi-planning)
# After that, this script (and the daily workflow) can redeploy with zero prompts.
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$source = 'C:\Users\peterxing\pap-deploy'
Set-Location $dir

$coverageVerifier = Join-Path $source 'verify-direct-coverage.js'
$newsVerifier = Join-Path $source 'verify-news-evidence.js'
$currencyVerifier = Join-Path $source 'verify-currency.js'
$surfaceVerifier = Join-Path $source 'verify-deploy-surface.js'
$referencesVerifier = Join-Path $source 'verify-reference-points.js'
if (-not (Test-Path $referencesVerifier)) {
  Write-Error 'Reviewed reference verifier is missing; deployment aborted.'
  exit 6
}
if (-not (Test-Path $coverageVerifier) -or -not (Test-Path $newsVerifier) -or -not (Test-Path $currencyVerifier) -or -not (Test-Path $surfaceVerifier)) {
  Write-Error 'Evidence preflight verifier is missing; deployment aborted.'
  exit 6
}
& node $coverageVerifier
# X RETIREMENT 2026-08-13 — the coverage gate now measures verified-news coverage; the archive,
# Peter and external X gates are removed with the evidence they verified.
if ($LASTEXITCODE -ne 0) {
  Write-Error 'Direct X evidence coverage is incomplete; deployment aborted.'
  exit 6
}
# Tier-3 news mappings must re-resolve and still carry their exact reviewed quote at deploy time.
& node $newsVerifier
if ($LASTEXITCODE -ne 0) {
  Write-Error 'Verified news evidence validation failed; deployment aborted.'
  exit 6
}
# The additive currency layer must re-resolve live and still carry its exact reviewed
# quote, headline and date. Exit 75 is INFRASTRUCTURE (a source served a bot challenge
# or was unreachable), which is NOT an evidence fault: it blocks the deploy as DEFERRED
# and is reported distinctly so a transient network fault never evicts genuine evidence.
& node $currencyVerifier
$currencyExit = $LASTEXITCODE
if ($currencyExit -eq 75) {
  Write-Warning 'Currency evidence could not be verified due to an infrastructure fault (source unreachable or bot challenge). Deployment DEFERRED; no evidence has been changed or demoted.'
  exit 75
}
# Exit 70 is PASSED BUT INERT: nothing failed, and one or more axes verified NOTHING. An
# entirely demoted currency layer is honest rather than broken, so it must NOT block the
# deploy - refusing to publish because an additive layer aged out is the same defect as
# demoting evidence for a network fault. publish-github.ps1 already treats 70 this way; this
# helper did not, so a legitimate inert state failed here as 'validation failed' and blocked
# publication entirely. It is still not a verified currency layer: the gate names the inert
# axes on stdout immediately above, and this warning points at them rather than restating them.
# ASCII ONLY BELOW, DELIBERATELY. This file is UTF-8 with no BOM and the deploy is invoked
# through Windows PowerShell, which decodes a BOM-less file as ANSI: a U+2014 em dash inside a
# double-quoted string decodes to a stray right-quote and breaks the parse at RUN time while
# [Parser]::ParseFile in a UTF-8 host still reports it clean.
if ($currencyExit -eq 70) {
  Write-Warning "Currency gate PASSED BUT INERT - one or more axes verified NOTHING on this run; the gate listed them by name under 'verify:currency PASSED BUT INERT' above. Deployment proceeds; this run does not establish the currency evidence."
}
if ($currencyExit -ne 0 -and $currencyExit -ne 70) {
  Write-Error 'Currency evidence validation failed; deployment aborted.'
  exit 6
}
# The public surface is an allow-list: anything not explicitly approved must be
# excluded by default, so a newly added script can never leak by omission.
& node $surfaceVerifier
if ($LASTEXITCODE -ne 0) {
  Write-Error 'Public deploy surface is not fail-closed; deployment aborted.'
  exit 6
}

# References are separate from NEWS, but their complete reviewed roster also gates every deploy.
# This is read-only: author runs do not start a second reference collector.
& node $referencesVerifier --no-ui
$referencesExit = $LASTEXITCODE
if ($referencesExit -eq 75) {
  Write-Warning 'Reference verification deferred by the interlock; deployment stopped.'
  exit 75
}
if ($referencesExit -ne 0) {
  Write-Error 'Reviewed reference coverage or source receipts are invalid; deployment aborted.'
  exit 6
}

# Copy only the runtime allow-list, then prove the production mirror is byte-identical.
$runtimeFiles = @(
  'index.html',
  'app.js',
  'styles.css',
  'predictions.json',
  'signals.json',
  'author.json'
)
# The advisory interlock is local coordination state only: never deployed, never served.
if ($runtimeFiles -contains '.pipeline.lock') {
  Write-Error 'Deployment aborted: .pipeline.lock is not a runtime file and must never be deployed.'
  exit 7
}
$lockInBundle = Join-Path $dir '.pipeline.lock'
if (Test-Path $lockInBundle) {
  Write-Error "Deployment aborted: $lockInBundle must never be staged into the production bundle."
  exit 7
}
foreach ($file in $runtimeFiles) {
  $sourcePath = Join-Path $source $file
  if (-not (Test-Path $sourcePath)) {
    Write-Error "Approved runtime source is missing: $sourcePath"
    exit 7
  }
  Copy-Item $sourcePath (Join-Path $dir $file) -Force
}foreach ($file in $runtimeFiles) {
  $sourceHash = (Get-FileHash (Join-Path $source $file) -Algorithm SHA256).Hash
  $siteHash = (Get-FileHash (Join-Path $dir $file) -Algorithm SHA256).Hash
  if ($sourceHash -ne $siteHash) {
    Write-Error "Production mirror hash mismatch after sync: $file"
    exit 7
  }
}
Write-Host "Production mirror synced and hash-verified: $($runtimeFiles.Count) runtime files."

$vercel = (Get-Command vercel -ErrorAction SilentlyContinue).Source
if (-not $vercel) { $vercel = (Get-Command vercel.cmd -ErrorAction SilentlyContinue).Source }
if (-not $vercel) { Write-Error "Vercel CLI not found. Run: npm i -g vercel"; exit 2 }

$args = @('deploy','--prod','--yes','--cwd', $dir)
$env:VERCEL_TOKEN = $null

Write-Host "Deploying $dir to Vercel production..."
& $vercel @args
if ($LASTEXITCODE -ne 0) { Write-Error "Vercel deploy failed ($LASTEXITCODE)"; exit $LASTEXITCODE }
Write-Host "Deploy complete."

# Prove the live surface, not just the local config. Production is also rebuilt by
# the Vercel Git integration when publish-github.ps1 pushes, so this assertion must
# be repeated after the mirror; see the post-deploy assertion in the workflows.
& node $surfaceVerifier --live
if ($LASTEXITCODE -ne 0) {
  Write-Error 'Live deploy surface assertion failed: a non-public path is reachable in production.'
  exit 8
}
