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
Set-Location $dir

$coverageVerifier = 'C:\Users\peterxing\pap-deploy\verify-direct-coverage.js'
if (-not (Test-Path $coverageVerifier)) {
  Write-Error 'Evidence-coverage verifier is missing; deployment aborted.'
  exit 6
}
& node $coverageVerifier
if ($LASTEXITCODE -ne 0) {
  Write-Error 'Direct-or-search @peterxing coverage is incomplete; deployment aborted.'
  exit 6
}

$vercel = (Get-Command vercel -ErrorAction SilentlyContinue).Source
if (-not $vercel) { $vercel = (Get-Command vercel.cmd -ErrorAction SilentlyContinue).Source }
if (-not $vercel) { Write-Error "Vercel CLI not found. Run: npm i -g vercel"; exit 2 }

$args = @('deploy','--prod','--yes','--cwd', $dir)

Write-Host "Deploying $dir to Vercel production..."
& $vercel @args
if ($LASTEXITCODE -ne 0) { Write-Error "Vercel deploy failed ($LASTEXITCODE)"; exit $LASTEXITCODE }
Write-Host "Deploy complete."
