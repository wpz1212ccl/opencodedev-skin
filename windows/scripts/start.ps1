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
$RootDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)

. "$ScriptDir\common.ps1"

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

Write-Host "Injecting skin..." -ForegroundColor Cyan

$effectiveThemeDir = if ($ThemeDir) { $ThemeDir } else { "$RootDir\assets" }
$injectorArgs = @(
  "--port", $CdpPort,
  "--auto-browser-id",
  "--theme-dir", $effectiveThemeDir
)

if ($Pause) { $injectorArgs += "--pause" }

$injectorPath = "$RootDir\scripts\injector.mjs"
if (-not (Test-Path $injectorPath)) {
  throw "Injector not found at: $injectorPath"
}

$injectorProcess = Start-Process -FilePath "node" -ArgumentList @($injectorPath) + $injectorArgs -PassThru -WindowStyle Hidden
Write-Host "Injector started with PID: $($injectorProcess.Id)" -ForegroundColor Green

$stateDir = "$env:LOCALAPPDATA\OpenCodeDreamSkin"
if (-not (Test-Path $stateDir)) {
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
}

$state = @{
  OpenCodePath = $OpenCodePath
  CdpPort = $CdpPort
  InjectorPid = $injectorProcess.Id
  ThemeDir = $effectiveThemeDir
  StartTime = (Get-Date).ToString("o")
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

if ($injectorProcess -and -not $injectorProcess.HasExited) {
  $injectorProcess.Kill()
}

if (Test-Path "$stateDir\state.json") {
  Remove-Item "$stateDir\state.json" -Force
}

Write-Host "Cleanup complete" -ForegroundColor Green
