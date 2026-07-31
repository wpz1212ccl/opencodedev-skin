# Full automated test: Start OpenCode → Inject skin → Screenshot → Validate → Report
# Usage: powershell -ExecutionPolicy Bypass -File run-full-test.ps1 [-CdpPort 9335] [-KeepOpen]

param(
  [int]$CdpPort = 9335,
  [switch]$KeepOpen
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InjectorPath = "$RootDir\scripts\injector.mjs"
$ThemeDir = "$RootDir\assets"
$TestScript = "$ScriptDir\test-automated.mjs"
$ResultsDir = "$ScriptDir\results"

# ── Colors ─────────────────────────────────────────────────────────────
function Write-Step($msg) { Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-OK($msg) { Write-Host "  OK: $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "  FAIL: $msg" -ForegroundColor Red }
function Write-Info($msg) { Write-Host "  $msg" -ForegroundColor Gray }

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "  OpenCode Skin - Full Automated Test" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan

# ── Preflight checks ──────────────────────────────────────────────────
Write-Step "Preflight checks"

$nodeCmd = Get-Command "node" -ErrorAction SilentlyContinue
if (-not $nodeCmd) { Write-Fail "Node.js not found"; exit 1 }
Write-OK "Node.js: $(node --version)"

if (-not (Test-Path $InjectorPath)) { Write-Fail "Injector not found: $InjectorPath"; exit 1 }
Write-OK "Injector: $InjectorPath"

if (-not (Test-Path $ThemeDir)) { Write-Fail "Theme dir not found: $ThemeDir"; exit 1 }
Write-OK "Theme dir: $ThemeDir"

# Check payload
$payloadCheck = & node $InjectorPath --check-payload --theme-dir $ThemeDir 2>&1
if ($LASTEXITCODE -ne 0) { Write-Fail "Payload check failed: $payloadCheck"; exit 1 }
Write-OK "Payload check passed"

# ── Detect or start OpenCode ───────────────────────────────────────────
Write-Step "Detecting OpenCode"

. "$RootDir\scripts\common.ps1"
$installs = Find-OpenCodeInstall
$openCodeRunning = Get-Process -Name "OpenCode" -ErrorAction SilentlyContinue
$cdpReady = $false
try { $response = Invoke-WebRequest -Uri "http://127.0.0.1:$CdpPort/json/version" -UseBasicParsing -TimeoutSec 2; $cdpReady = $response.StatusCode -eq 200 } catch {}

$startedByUs = $false

if ($cdpReady) {
  Write-OK "OpenCode already running with CDP on port $CdpPort"
} elseif ($openCodeRunning) {
  Write-Info "OpenCode running but CDP not ready on port $CdpPort"
  Write-Info "Attempting to restart with CDP enabled..."
  Stop-OpenCodeApp -AllowForce
  Start-Sleep -Seconds 2

  if ($installs.Count -gt 0) {
    $exePath = $installs[0]
    Write-Info "Starting: $exePath --remote-debugging-port=$CdpPort"
    Start-OpenCodeApp -ExecutablePath $exePath -Arguments @("--remote-debugging-port=$CdpPort")
    $startedByUs = $true
    Start-Sleep -Seconds 5
  }
} else {
  if ($installs.Count -eq 0) {
    Write-Fail "OpenCode not found. Install it or specify path."
    exit 1
  }
  $exePath = $installs[0]
  Write-Info "Starting: $exePath --remote-debugging-port=$CdpPort"
  Start-OpenCodeApp -ExecutablePath $exePath -Arguments @("--remote-debugging-port=$CdpPort")
  $startedByUs = $true
  Start-Sleep -Seconds 5
}

# Wait for CDP
Write-Step "Waiting for CDP on port $CdpPort"
$ready = Wait-OpenCodeReady -Port $CdpPort -TimeoutSeconds 30
if (-not $ready) {
  Write-Fail "CDP not ready within 30 seconds"
  if ($startedByUs -and -not $KeepOpen) { Stop-OpenCodeApp -AllowForce }
  exit 1
}
Write-OK "CDP ready"

# ── Run automated test ─────────────────────────────────────────────────
Write-Step "Running automated test"

$testResult = & node $TestScript --port $CdpPort --theme-dir $ThemeDir --output-dir $ResultsDir 2>&1
$testExit = $LASTEXITCODE

# Print test output
Write-Host $testResult

# ── Cleanup ────────────────────────────────────────────────────────────
if ($startedByUs -and -not $KeepOpen) {
  Write-Step "Cleaning up"
  Stop-OpenCodeApp -AllowForce
  Write-OK "OpenCode stopped"
}

# ── Final summary ──────────────────────────────────────────────────────
Write-Host "`n============================================" -ForegroundColor Cyan
if ($testExit -eq 0) {
  Write-Host "  ALL TESTS PASSED" -ForegroundColor Green
} else {
  Write-Host "  SOME TESTS FAILED (exit code: $testExit)" -ForegroundColor Red
}
Write-Host "  Results: $ResultsDir" -ForegroundColor Gray
Write-Host "============================================`n" -ForegroundColor Cyan

# List screenshots
$screenshots = Get-ChildItem -Path $ResultsDir -Filter "*.png" -ErrorAction SilentlyContinue
if ($screenshots) {
  Write-Host "Screenshots:" -ForegroundColor Yellow
  foreach ($s in $screenshots) {
    Write-Host "  $($s.Name) ($([math]::Round($s.Length/1024))KB)" -ForegroundColor Gray
  }
}

exit $testExit
