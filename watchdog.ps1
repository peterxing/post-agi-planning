# watchdog.ps1 — keeps the static server + Cloudflare quick tunnel alive.
# Checks the public URL (from url.txt) every CHECK_SECS. After FAIL_LIMIT
# consecutive failures it kills any stuck cloudflared, re-runs launch.ps1 to
# mint a fresh tunnel, and records the new URL. Logs to watchdog.log.
# Run detached so it survives the session:
#   Start-Process powershell -ArgumentList '-NoProfile -WindowStyle Hidden -File C:\Users\peterxing\pap-deploy\watchdog.ps1'
$ErrorActionPreference = 'SilentlyContinue'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$log = Join-Path $dir 'watchdog.log'
$CHECK_SECS = 60
$FAIL_LIMIT = 3

function Write-Log($msg) {
  $line = '{0}  {1}' -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'), $msg
  Add-Content -Path $log -Value $line
  # keep the log from growing unbounded
  $lines = Get-Content $log -ErrorAction SilentlyContinue
  if ($lines -and $lines.Count -gt 500) {
    Set-Content -Path $log -Value ($lines | Select-Object -Last 300)
  }
}

function Test-Public {
  $url = (Get-Content (Join-Path $dir 'url.txt') -ErrorAction SilentlyContinue | Select-Object -First 1)
  if (-not $url) { return $false }
  $url = $url.Trim()
  if (-not $url) { return $false }
  try {
    $r = Invoke-WebRequest "$url/" -UseBasicParsing -TimeoutSec 20
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

function Invoke-Heal {
  Write-Log 'HEAL: killing cloudflared + relaunching tunnel'
  Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  $before = (Get-Content (Join-Path $dir 'url.txt') -ErrorAction SilentlyContinue | Select-Object -First 1)
  & powershell -ExecutionPolicy Bypass -File (Join-Path $dir 'launch.ps1') | Out-Null
  Start-Sleep -Seconds 2
  $after = (Get-Content (Join-Path $dir 'url.txt') -ErrorAction SilentlyContinue | Select-Object -First 1)
  Write-Log ("HEAL done: url {0} -> {1}" -f $before, $after)
}

Write-Log ('watchdog started (pid {0}); checking every {1}s, heal after {2} fails' -f $PID, $CHECK_SECS, $FAIL_LIMIT)
$fails = 0
$loops = 0
while ($true) {
  Start-Sleep -Seconds $CHECK_SECS
  $loops++
  if (Test-Public) {
    if ($fails -gt 0) { Write-Log 'recovered: public URL responding again' }
    $fails = 0
    if ($loops % 30 -eq 0) { Write-Log 'heartbeat: public URL OK' }   # ~every 30 min
  } else {
    $fails++
    Write-Log ('check FAILED ({0}/{1})' -f $fails, $FAIL_LIMIT)
    if ($fails -ge $FAIL_LIMIT) {
      Invoke-Heal
      $fails = 0
    }
  }
}
