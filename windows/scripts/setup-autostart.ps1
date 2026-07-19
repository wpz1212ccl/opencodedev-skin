# Setup auto-start for OpenCode Skin
# 1. Modify OpenCode shortcut to add --remote-debugging-port
# 2. Register auto-inject monitor for Windows startup

param(
  [switch]$Uninstall,
  [int]$CdpPort = 9335
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$MonitorScript = "$ScriptDir\auto-inject.ps1"
$SkinDir = "$RootDir"

Write-Host "`n=== OpenCode Skin Auto-Start Setup ===" -ForegroundColor Cyan

if ($Uninstall) {
  Write-Host "`nRemoving auto-start..." -ForegroundColor Yellow

  # Remove startup shortcut
  $startupPath = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
  $startupLink = "$startupPath\OpenCode Skin Monitor.lnk"
  if (Test-Path $startupLink) {
    Remove-Item $startupLink -Force
    Write-Host "  Removed startup shortcut" -ForegroundColor Green
  }

  # Kill running monitor
  $monitorProcs = Get-Process -Name "powershell" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*auto-inject*" }
  foreach ($p in $monitorProcs) {
    try { $p.Kill() } catch {}
  }
  Write-Host "  Stopped monitor processes" -ForegroundColor Green

  # Restore original OpenCode shortcut (remove --remote-debugging-port)
  $desktopLink = "$env:USERPROFILE\Desktop\OpenCode.lnk"
  if (Test-Path $desktopLink) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($desktopLink)
    $shortcut.Arguments = $shortcut.Arguments -replace " --remote-debugging-port=\d+", ""
    $shortcut.Save()
    Write-Host "  Restored original OpenCode shortcut" -ForegroundColor Green
  }

  Write-Host "`nAuto-start removed." -ForegroundColor Green
  exit 0
}

# --- Install ---

Write-Host "`n[1/3] Finding OpenCode shortcut..." -ForegroundColor Cyan

# Find OpenCode shortcut on desktop
$desktopLink = "$env:USERPROFILE\Desktop\OpenCode.lnk"
$startMenuLink = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\OpenCode\OpenCode.lnk"

$shortcutPath = $null
if (Test-Path $desktopLink) { $shortcutPath = $desktopLink }
elseif (Test-Path $startMenuLink) { $shortcutPath = $startMenuLink }

if (-not $shortcutPath) {
  Write-Host "  OpenCode shortcut not found. Creating one on Desktop..." -ForegroundColor Yellow

  . "$ScriptDir\common.ps1"
  $installs = Find-OpenCodeInstall
  if ($installs.Count -eq 0) {
    Write-Host "  ERROR: OpenCode not found" -ForegroundColor Red
    exit 1
  }

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($desktopLink)
  $shortcut.TargetPath = $installs[0]
  $shortcut.Description = "OpenCode Desktop"
  $shortcut.Save()
  $shortcutPath = $desktopLink
  Write-Host "  Created: $shortcutPath" -ForegroundColor Green
} else {
  Write-Host "  Found: $shortcutPath" -ForegroundColor Green
}

Write-Host "`n[2/3] Adding --remote-debugging-port=$CdpPort to ALL OpenCode shortcuts..." -ForegroundColor Cyan

# Find all OpenCode shortcuts
$shortcutPaths = @()
$allLocations = @(
  "$env:USERPROFILE\Desktop\OpenCode.lnk",
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\OpenCode.lnk"
)
# Also search Start Menu recursively
Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Recurse -Filter "OpenCode.lnk" -ErrorAction SilentlyContinue | ForEach-Object {
  $allLocations += $_.FullName
}

$shell = New-Object -ComObject WScript.Shell
foreach ($linkPath in $allLocations) {
  if (Test-Path $linkPath) {
    $shortcut = $shell.CreateShortcut($linkPath)
    if ($shortcut.TargetPath -like "*OpenCode.exe") {
      if ($shortcut.Arguments -match "--remote-debugging-port") {
        $shortcut.Arguments = $shortcut.Arguments -replace "--remote-debugging-port=\d+", "--remote-debugging-port=$CdpPort"
      } else {
        $shortcut.Arguments = "$($shortcut.Arguments) --remote-debugging-port=$CdpPort"
      }
      $shortcut.Save()
      Write-Host "  Fixed: $linkPath" -ForegroundColor Green
    }
  }
}

Write-Host "`n[3/3] Registering auto-inject monitor for startup..." -ForegroundColor Cyan

$startupPath = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
$startupLink = "$startupPath\OpenCode Skin Monitor.lnk"

$shell = New-Object -ComObject WScript.Shell
$monitorShortcut = $shell.CreateShortcut($startupLink)
$monitorShortcut.TargetPath = "powershell.exe"
$monitorShortcut.Arguments = "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$MonitorScript`" -CdpPort $CdpPort"
$monitorShortcut.WorkingDirectory = $RootDir
$monitorShortcut.Description = "OpenCode Skin Auto-Inject Monitor"
$monitorShortcut.Save()

Write-Host "  Registered: $startupLink" -ForegroundColor Green

# Also start monitor now
Write-Host "`nStarting monitor now..." -ForegroundColor Cyan
Start-Process -FilePath "powershell" -ArgumentList @(
  "-WindowStyle", "Hidden",
  "-ExecutionPolicy", "Bypass",
  "-File", $MonitorScript,
  "-CdpPort", $CdpPort
)
Write-Host "  Monitor started" -ForegroundColor Green

Write-Host "`n=== Setup Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "How it works:" -ForegroundColor Cyan
Write-Host "  1. OpenCode shortcut now includes --remote-debugging-port=$CdpPort" -ForegroundColor Gray
Write-Host "  2. Monitor script runs at Windows startup" -ForegroundColor Gray
Write-Host "  3. When OpenCode opens, skin auto-injects" -ForegroundColor Gray
Write-Host "  4. When OpenCode closes, injector stops" -ForegroundColor Gray
Write-Host ""
Write-Host "To undo: .\setup-autostart.ps1 -Uninstall" -ForegroundColor Yellow
