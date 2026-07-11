# launch.ps1 — starts the static server + Cloudflare tunnel as independent hidden processes.
# Writes the public URL to url.txt. Re-run any time to (re)establish the tunnel.
$ErrorActionPreference = 'SilentlyContinue'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Definition

# 1) Ensure the static server is listening on 8787
$listening = $false
try { $listening = (New-Object Net.Sockets.TcpClient).ConnectAsync('127.0.0.1',8787).Wait(800) } catch {}
if (-not $listening) {
  Start-Process -FilePath "node" -ArgumentList "`"$dir\server.js`"" -WorkingDirectory $dir -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

# 2) Start the Cloudflare quick tunnel (independent, hidden)
Remove-Item "$dir\cf-live.log" -ErrorAction SilentlyContinue
Start-Process -FilePath "$dir\cloudflared.exe" `
  -ArgumentList "tunnel --url http://127.0.0.1:8787 --no-autoupdate" `
  -WorkingDirectory $dir -WindowStyle Hidden `
  -RedirectStandardError "$dir\cf-live.log" -RedirectStandardOutput "$dir\cf-out.log"

# 3) Wait for the public URL to appear, then save it
$url = $null
for ($i=0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  $c = Get-Content "$dir\cf-live.log" -Raw -ErrorAction SilentlyContinue
  if ($c) {
    $m = [regex]::Match($c, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($m.Success) { $url = $m.Value; break }
  }
}
if ($url) {
  Set-Content -Path "$dir\url.txt" -Value $url
  Write-Host "PUBLIC URL: $url"
} else {
  Write-Host "Tunnel URL not detected; check cf-live.log"
}
