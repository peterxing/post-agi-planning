# deploy.ps1 — pushes the static site in this folder to Vercel production.
# Headless (token-based) so the daily refresh workflow can call it unattended.
#
# One-time setup (you, in a terminal):
#   1) npm i -g vercel              # already installed by the assistant
#   2) vercel login                 # browser auth to YOUR Vercel account
#   3) cd C:\Users\peterxing\pap-site ; vercel link   # pick/create the project (e.g. post-agi-planning)
#   4) Create a token at https://vercel.com/account/tokens and save it:
#        setx VERCEL_TOKEN "xxxxxxxx"   (then reopen the terminal)
#
# After that, this script (and the daily workflow) can redeploy with zero prompts.
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $dir

$token = $env:VERCEL_TOKEN
$vercel = (Get-Command vercel -ErrorAction SilentlyContinue).Source
if (-not $vercel) { $vercel = (Get-Command vercel.cmd -ErrorAction SilentlyContinue).Source }
if (-not $vercel) { Write-Error "Vercel CLI not found. Run: npm i -g vercel"; exit 2 }

$args = @('deploy','--prod','--yes','--cwd', $dir)
if ($token) { $args += @('--token', $token) }

Write-Host "Deploying $dir to Vercel production..."
& $vercel @args
if ($LASTEXITCODE -ne 0) { Write-Error "Vercel deploy failed ($LASTEXITCODE)"; exit $LASTEXITCODE }
Write-Host "Deploy complete."
