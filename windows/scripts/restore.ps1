# Restore OpenCode original appearance

param(
  [switch]$Uninstall,
  [switch]$Restart
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. "$ScriptDir\common.ps1"

$stateDir = "$env:LOCALAPPDATA\OpenCodeDreamSkin"
$stateFile = "$stateDir\state.json"

if (-not (Test-Path $stateFile)) {
  Write-Host "No active skin found" -ForegroundColor Yellow
  return
}

$state = Get-Content $stateFile | ConvertFrom-Json
Write-Host "Found active skin state" -ForegroundColor Cyan

Write-Host "Stopping tray..." -ForegroundColor Cyan
$trayProcesses = Get-Process -Name "powershell" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*tray.ps1*" }

foreach ($p in $trayProcesses) {
  try {
    $p.Kill()
    Write-Host "Stopped tray process: $($p.Id)" -ForegroundColor Green
  } catch {
    Write-Host "Failed to stop tray process: $($p.Id)" -ForegroundColor Yellow
  }
}

Write-Host "Stopping injector..." -ForegroundColor Cyan
if ($state.InjectorPid) {
  $injectorProcess = Get-Process -Id $state.InjectorPid -ErrorAction SilentlyContinue
  if ($injectorProcess -and -not $injectorProcess.HasExited) {
    try {
      $injectorProcess.Kill()
      Write-Host "Stopped injector process: $($state.InjectorPid)" -ForegroundColor Green
    } catch {
      Write-Host "Failed to stop injector process: $($state.InjectorPid)" -ForegroundColor Yellow
    }
  }
}

Write-Host "Stopping OpenCode..." -ForegroundColor Cyan
if ($state.OpenCodePath) {
  Stop-OpenCodeApp -ExecutablePath $state.OpenCodePath -AllowForce
  Write-Host "OpenCode stopped" -ForegroundColor Green
} else {
  $processes = Get-Process -Name "OpenCode" -ErrorAction SilentlyContinue
  foreach ($p in $processes) {
    try { $p.CloseMainWindow() } catch {}
  }
  Start-Sleep -Seconds 2
}

if (Test-Path $stateFile) {
  Remove-Item $stateFile -Force
  Write-Host "State file removed" -ForegroundColor Green
}

if ($Uninstall) {
  Write-Host "Uninstalling..." -ForegroundColor Cyan
  $shortcutPath = "$env:USERPROFILE\Desktop\OpenCode Skin.lnk"
  if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath -Force
    Write-Host "Shortcut removed" -ForegroundColor Green
  }
  if (Test-Path $stateDir) {
    Remove-Item $stateDir -Recurse -Force
    Write-Host "Configuration directory removed" -ForegroundColor Green
  }
}

if ($Restart) {
  Write-Host "Restarting OpenCode..." -ForegroundColor Cyan
  if ($state.OpenCodePath) {
    Start-OpenCodeApp -ExecutablePath $state.OpenCodePath
    Write-Host "OpenCode restarted" -ForegroundColor Green
  } else {
    Write-Host "Cannot restart: OpenCode path not found in state" -ForegroundColor Yellow
  }
}

Write-Host "Restore complete!" -ForegroundColor Green
