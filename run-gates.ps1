# run-gates.ps1 — gate-suite runner with invocation-fault discrimination.
#
# WHY THIS EXISTS
# An exit code is a verdict about an INVOCATION, not about a SUBJECT.
# `npm run <name>` returns exit 1 both when a gate runs and fails, and when the
# gate NAME does not exist. Those are different events and must never share a
# bucket: a mistyped name read as "gate failed" causes a false alarm, and a
# SHORT LIST read as "suite green" causes a false all-clear -- a gate that never
# ran, counted as a gate that passed.
#
# So this runner:
#   1. DERIVES the gate list from package.json. It never carries names in memory.
#   2. Classifies every result as PASS / FAIL / INVOCATION FAULT (a third state).
#   3. Asserts the gate COUNT against the derived list, so a short run cannot
#      present as a complete one.
#   4. NAMES THE SERVER. Live gates read bytes over HTTP; nothing else records
#      which process answered. This is the symmetry of the gate's own
#      INSTRUMENT BYTES line, one layer out: these bytes, measured by this
#      instrument, served by this process. If served bytes differ from disk
#      bytes, the suite is halted -- a live gate and a disk-reading gate would
#      otherwise disagree about reality while both printed PASS.
#   5. Emits no RESULT: line on any internal error, so an aborted run yields no
#      verdict rather than a green one.
#
# Untracked operational tooling. Produces no evidence number and no publish
# decision; it only decides whether a suite was actually executed.

[CmdletBinding()]
param(
    # NOT $PSScriptRoot: it is unset inside a param() default under -File, which
    # made this script's first run die on an empty path. Resolved in the body.
    [string]$Deploy = '',
    [string[]]$InjectNames = @(),  # controls only: extra names appended to the derived list
    [string[]]$ProbeExtra = @(),   # controls only: extra files added to the served-vs-disk probe
    [switch]$MispairControl        # controls only: compare served styles.css against app.js on disk
)

$ErrorActionPreference = 'Stop'

$EXIT_PASS       = 0
$EXIT_GATE_FAIL  = 1
$EXIT_INVOCATION = 9   # distinct from every gate's own vocabulary (0/1/2/3/70/75/76)
$EXIT_DEFERRED   = 75  # PROPAGATED, not invented: the same code the interlock and the currency
                       # gate use, so a caller can treat a deferred suite exactly as it treats a
                       # deferred gate without learning a second vocabulary.

try {
    if ([string]::IsNullOrWhiteSpace($Deploy)) {
        $Deploy = Split-Path -Parent $PSCommandPath
    }
    if ([string]::IsNullOrWhiteSpace($Deploy)) { throw 'cannot resolve deploy root' }

    $pkgPath = Join-Path $Deploy 'package.json'
    if (-not (Test-Path $pkgPath)) { throw "package.json not found at $pkgPath" }

    $scripts = (Get-Content $pkgPath -Raw | ConvertFrom-Json).scripts
    if ($null -eq $scripts) { throw 'package.json declares no scripts' }

    $names = $scripts.PSObject.Properties.Name

    # Derived, not remembered. 'validate' + 'verify' + every 'verify:*'.
    $derived = @()
    if ($names -contains 'validate') { $derived += 'validate' }
    if ($names -contains 'verify')   { $derived += 'verify' }
    $derived += ($names | Where-Object { $_ -like 'verify:*' } | Sort-Object)

    if ($derived.Count -eq 0) { throw 'derived gate list is empty -- refusing to report a verdict' }

    $planned = @($derived) + @($InjectNames)

    Write-Host "GATES DERIVED  $($derived.Count) from package.json"
    if ($InjectNames.Count -gt 0) {
        Write-Host "GATES INJECTED $($InjectNames.Count) (control run)"
    }

    # --- SERVER IDENTITY -------------------------------------------------
    # Live gates read bytes over HTTP. Name the process that serves them, and
    # prove those bytes are the bytes on disk, BEFORE any gate runs.
    $serverPort = 8787
    $listener = Get-NetTCPConnection -LocalPort $serverPort -State Listen -ErrorAction SilentlyContinue |
                Select-Object -First 1
    if (-not $listener) {
        Write-Host "SERVER         ABSENT on :$serverPort -- live gates will fail on their own merits"
    }
    else {
        $sp = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        $boot = if ($sp) { $sp.StartTime.ToUniversalTime().ToString('u') } else { 'unknown' }
        Write-Host "SERVER         PID $($listener.OwningProcess)  booted $boot"

        $divergent = @()

        # Probes are (served, disk) PAIRS. Normally both names are the same file.
        # Covering both allow branches deliberately: .json/.html/.js reach the
        # server through ALLOW_FILES, .css only through ALLOW_EXT.
        $probeSet = @()
        foreach ($f in @('signals.json', 'predictions.json', 'author.json',
                         'app.js', 'index.html', 'styles.css') + $ProbeExtra) {
            $probeSet += @{ served = $f; disk = $f }
        }
        # Control only: a deliberately WRONG expectation. The bytes-differ branch
        # cannot be provoked against a cacheless server -- it never returns a stale
        # 200 -- so it is calibrated by mispairing instead. If this does not fire,
        # the comparison was never wired and every "identical" above is worthless.
        if ($MispairControl) {
            $probeSet += @{ served = 'styles.css'; disk = 'app.js' }
        }

        foreach ($p in $probeSet) {
            $f = $p.served
            $onDisk = Join-Path $Deploy $p.disk
            if (-not (Test-Path $onDisk)) { continue }
            $diskHash = (Get-FileHash $onDisk -Algorithm SHA256).Hash
            $label = if ($p.served -eq $p.disk) { $f } else { "$($p.served) vs disk $($p.disk)" }

            $wc = New-Object System.Net.WebClient
            $wc.CachePolicy = New-Object System.Net.Cache.RequestCachePolicy(
                [System.Net.Cache.RequestCacheLevel]::NoCacheNoStore)
            try {
                $bytes = $wc.DownloadData("http://127.0.0.1:$serverPort/$f")
                $sha = [System.Security.Cryptography.SHA256]::Create()
                $httpHash = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '')
                if ($httpHash -ne $diskHash) { $divergent += $label }
            }
            catch { $divergent += "$label (unreachable)" }
            finally { $wc.Dispose() }
        }

        if ($divergent.Count -gt 0) {
            Write-Host "SERVED BYTES   DIVERGENT from disk -> $($divergent -join ', ')"
            Write-Host ''
            Write-Host "RESULT: SERVER DIVERGENCE -- served bytes differ from disk. No suite verdict."
            exit $EXIT_INVOCATION
        }
        Write-Host "SERVED BYTES   identical to disk on $($probeSet.Count) artefacts"
    }
    Write-Host ''

    $pass = 0; $fail = 0; $invocation = 0; $inert = 0; $deferred = 0
    $failed = @(); $faulted = @(); $inertGates = @(); $deferredGates = @()

    foreach ($g in $planned) {
        $out  = & npm run $g 2>&1 | Out-String
        $code = $LASTEXITCODE

        # An invocation fault is identified by npm's own diagnostic, NOT by the
        # exit code -- the exit code cannot distinguish it from a real failure.
        if ($out -match 'Missing script') {
            $invocation++; $faulted += $g
            Write-Host ("{0,-22} INVOCATION FAULT  (name absent from package.json)" -f $g)
        }
        elseif ($code -eq 0) {
            $pass++
            Write-Host ("{0,-22} PASS" -f $g)
        }
        # NON-ZERO IS NOT SYNONYMOUS WITH FAILED, AND COLLAPSING THEM BREAKS PUBLICATION.
        # This suite classified every non-zero code as FAIL. Two of this tree's gates deliberately
        # exit non-zero to mean something that is NOT a failure, and the contracts say so explicitly:
        #   70 = PASSED BUT INERT -- one or more axes verified NOTHING. A legitimate publishing
        #        state; publication proceeds and it must not be recorded as a verified layer.
        #   75 = DEFERRED / INFRASTRUCTURE -- the interlock is held, or a cited publisher was
        #        unreachable or served a bot challenge after retries. Nothing was established and
        #        nothing must change; the next run retries.
        # MEASURED on 2026-08-24: verify:currency is INERT BY CONSTRUCTION (a currency link must
        # strictly postdate its origin, and every origin sits inside the 14-day window, so there is
        # almost no room between them). This runner reported it as "FAIL exit 70" and returned a
        # suite verdict of FAIL. Wiring the scheduled workflows to this runner would therefore have
        # blocked publication every single day, on a gate that had not failed. They are reported as
        # themselves and never absorbed into the pass count either -- an inert gate verified nothing,
        # so counting it as a pass would be the opposite error.
        elseif ($code -eq 70) {
            $inert++; $inertGates += $g
            Write-Host ("{0,-22} INERT  exit 70  (passed but verified nothing -- publication proceeds)" -f $g)
        }
        elseif ($code -eq 75) {
            $deferred++; $deferredGates += $g
            Write-Host ("{0,-22} DEFERRED  exit 75  (interlock or infrastructure -- nothing established)" -f $g)
        }
        else {
            $fail++; $failed += $g
            Write-Host ("{0,-22} FAIL  exit $code" -f $g)
        }
    }

    $ran = $pass + $fail + $inert + $deferred
    Write-Host ''
    Write-Host "EXECUTED    $ran of $($derived.Count) derived"
    Write-Host "PASS        $pass"
    Write-Host "INERT       $inert$(if($inert){"  -> $($inertGates -join ', ')"})"
    Write-Host "DEFERRED    $deferred$(if($deferred){"  -> $($deferredGates -join ', ')"})"
    Write-Host "FAIL        $fail$(if($fail){"  -> $($failed -join ', ')"})"
    Write-Host "INVOCATION  $invocation$(if($invocation){"  -> $($faulted -join ', ')"})"
    Write-Host ''

    # Ordering matters: an invocation fault outranks a pass count, because a
    # suite that could not run a gate has not established anything about it.
    if ($invocation -gt 0) {
        Write-Host "RESULT: INVOCATION FAULT -- $invocation name(s) could not be run. No suite verdict."
        exit $EXIT_INVOCATION
    }
    if ($ran -ne $derived.Count) {
        Write-Host "RESULT: INCOMPLETE -- executed $ran of $($derived.Count). No suite verdict."
        exit $EXIT_INVOCATION
    }
    if ($fail -gt 0) {
        Write-Host "RESULT: FAIL -- $fail of $ran gates failed."
        exit $EXIT_GATE_FAIL
    }
    # A DEFERRAL IS NOT A PASS. Nothing was established, so the suite must not hand back a verdict
    # that reads as one; the caller stops without publishing and the next run retries.
    if ($deferred -gt 0) {
        Write-Host "RESULT: DEFERRED -- $deferred gate(s) reported interlock/infrastructure: $($deferredGates -join ', '). Publish nothing; retry next run."
        exit $EXIT_DEFERRED
    }
    if ($inert -gt 0) {
        Write-Host "RESULT: PASS (WITH $inert INERT) -- $pass gate(s) exit 0 and $inert verified nothing: $($inertGates -join ', '). Publication proceeds; report the inert gate(s) as inert, never as verified."
        exit $EXIT_PASS
    }

    Write-Host "RESULT: PASS -- $pass/$($derived.Count) gates exit 0, all names derived from package.json."
    exit $EXIT_PASS
}
catch {
    # No RESULT: line on the error path. A run that broke produces no verdict.
    Write-Host "RUNNER FAULT -- $($_.Exception.Message)"
    exit $EXIT_INVOCATION
}
