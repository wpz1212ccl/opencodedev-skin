# Start OpenCode with Dream Skin

param(
  [string]$OpenCodePath,
  [int]$CdpPort = 9335,
  [string]$ThemeDir,
  [switch]$NoTray,
  [switch]$Pause
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

# Resolve junction D:\oc-skin to real path to prevent node hang
# Must use Get-Item to resolve junction instead of hardcoding Chinese path
# because start.ps1 is UTF-8 without BOM and PS reads it as ANSI (GBK)
$junctionRoot = "D:\oc-skin"
if ((Test-Path $junctionRoot) -and $ScriptDir -like "$junctionRoot*") {
  $realRoot = (Get-Item -Path $junctionRoot -Force).Target
  $ScriptDir = $ScriptDir.Replace($junctionRoot, $realRoot)
  $RootDir = $RootDir.Replace($junctionRoot, $realRoot)
}

. "$ScriptDir\common.ps1"

$effectiveThemeDir = if ($ThemeDir) { $ThemeDir } else { "$RootDir\assets" }

if ($OpenCodePath) {
  if (-not (Test-Path $OpenCodePath)) {
    throw "OpenCode not found at: $OpenCodePath"
  }
} else {
  $installs = Find-OpenCodeInstall
  if ($installs.Count -eq 0) {
    throw "OpenCode not found. Please specify -OpenCodePath parameter."
  }
  $OpenCodePath = $installs[0]
  Write-Host "Found OpenCode at: $OpenCodePath" -ForegroundColor Green
}

# Default OpenCode path if not specified
if (-not $OpenCodePath) {
  $OpenCodePath = "D:\OpenCode\OpenCode.exe"
}

if (Test-OpenCodePortOwner -Port $CdpPort) {
  Write-Host "Port $CdpPort is already in use by OpenCode" -ForegroundColor Yellow
  $processes = Get-OpenCodeProcesses -ExecutablePath $OpenCodePath
  if ($processes.Count -gt 0) {
    Write-Host "OpenCode is already running with skin injection" -ForegroundColor Green
    return
  }
}

Write-Host "Starting OpenCode..." -ForegroundColor Cyan

$arguments = @("--remote-debugging-port=$CdpPort")
if ($ThemeDir) { $arguments += "--theme-dir=$ThemeDir" }

$process = Start-OpenCodeApp -ExecutablePath $OpenCodePath -Arguments $arguments -PassThru
Write-Host "OpenCode started with PID: $($process.Id)" -ForegroundColor Green

Write-Host "Waiting for CDP to be ready..." -ForegroundColor Cyan
$ready = Wait-OpenCodeReady -Port $CdpPort -TimeoutSeconds 30

if (-not $ready) {
  throw "CDP did not become ready within 30 seconds"
}

Write-Host "CDP is ready on port $CdpPort" -ForegroundColor Green

# ── Start Image Server (background) ──
$imageServerPath = "$ScriptDir\image-server.mjs"
$imageServerProcess = $null
if (Test-Path $imageServerPath) {
  Write-Host "Starting image server..." -ForegroundColor Cyan
  $imageServerProcess = Start-Process -FilePath "node" -ArgumentList @($imageServerPath, "--port", "18765", "--theme-dir", $effectiveThemeDir) -PassThru -WindowStyle Hidden
  Write-Host "Image server started (PID=$($imageServerProcess.Id))" -ForegroundColor Green
}

# ── Inject skin (run inline, not background) ──
$injectorPath = "$ScriptDir\injector.mjs"
if (-not (Test-Path $injectorPath)) {
  throw "Injector not found at: $injectorPath"
}

Write-Host "Injecting skin..." -ForegroundColor Cyan
$prevErrorAction = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& node $injectorPath --port $CdpPort --auto-browser-id --theme-dir "$effectiveThemeDir" --once --timeout-ms 15000 *>&1 | Write-Host
$ErrorActionPreference = $prevErrorAction

if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 2) {
  Write-Host "Skin injection completed" -ForegroundColor Green
} else {
  Write-Host "Skin injection may have failed (exit code: $LASTEXITCODE)" -ForegroundColor Yellow
}

$stateDir = "$env:LOCALAPPDATA\OpenCodeDreamSkin"
if (-not (Test-Path $stateDir)) {
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
}

$state = @{
  OpenCodePath = $OpenCodePath
  CdpPort = $CdpPort
  ThemeDir = $effectiveThemeDir
  StartTime = (Get-Date).ToString("o")
  Version = "2.0.0"
}

$state | ConvertTo-Json | Set-Content -Path "$stateDir\state.json" -Encoding UTF8
Write-Host "State saved to: $stateDir\state.json" -ForegroundColor Green

if (-not $NoTray) {
  Write-Host "Starting tray..." -ForegroundColor Cyan
  $trayPath = "$ScriptDir\tray.ps1"
  if (Test-Path $trayPath) {
    $trayProcess = Start-Process -FilePath "powershell" -ArgumentList @("-File", $trayPath) -PassThru -WindowStyle Hidden
    Write-Host "Tray started with PID: $($trayProcess.Id)" -ForegroundColor Green
  }
}

Write-Host "OpenCode Dream Skin is active!" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow

$process.WaitForExit()
Write-Host "OpenCode exited" -ForegroundColor Yellow

# Kill image server
if ($imageServerProcess -and -not $imageServerProcess.HasExited) {
  $imageServerProcess.Kill()
  Write-Host "Image server stopped" -ForegroundColor Yellow
}

if (Test-Path "$stateDir\state.json") {
  Remove-Item "$stateDir\state.json" -Force
}

Write-Host "Cleanup complete" -ForegroundColor Green
