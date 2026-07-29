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
$peterVerifier = Join-Path $source 'verify-peter-evidence.js'
$externalVerifier = Join-Path $source 'verify-external-evidence.js'
if (-not (Test-Path $coverageVerifier) -or -not (Test-Path $peterVerifier) -or -not (Test-Path $externalVerifier)) {
  Write-Error 'Evidence preflight verifier is missing; deployment aborted.'
  exit 6
}
& node $coverageVerifier
if ($LASTEXITCODE -ne 0) {
  Write-Error 'Direct X evidence coverage is incomplete; deployment aborted.'
  exit 6
}
& node $peterVerifier
if ($LASTEXITCODE -ne 0) {
  Write-Error 'Reviewed Peter X evidence validation failed; deployment aborted.'
  exit 6
}
& node $externalVerifier
if ($LASTEXITCODE -ne 0) {
  Write-Error 'External X evidence validation failed; deployment aborted.'
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
foreach ($file in $runtimeFiles) {
  $sourcePath = Join-Path $source $file
  if (-not (Test-Path $sourcePath)) {
    Write-Error "Approved runtime source is missing: $sourcePath"
    exit 7
  }
  Copy-Item $sourcePath (Join-Path $dir $file) -Force
}
foreach ($file in $runtimeFiles) {
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
