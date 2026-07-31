# Setup auto-start for OpenCode Skin
# Replaces the old auto-inject background monitor with a direct shortcut to
# start.ps1. This matches the design described in CHANGELOG 2.0.1 and the
# README "方式一" instructions.
#
# What this script does:
#   1. Create junction D:\oc-skin -> project root, so shortcuts can use a
#      pure-ASCII path (workaround for Windows .lnk UTF-8 corruption when
#      the target path contains CJK characters).
#   2. Locate the OpenCode.exe install (via common.ps1 helper).
#   3. Replace the OpenCode desktop / start-menu shortcut so it launches
#      start.ps1 (which starts the image server, OpenCode with
#      --remote-debugging-port, and the injector inline).
#   4. Skip the legacy auto-inject monitor entirely.
#
# Pass -Uninstall to undo.

param(
  [switch]$Uninstall,
  [int]$CdpPort = 9335,
  [string]$JunctionRoot = "D:\oc-skin",
  [switch]$WhatIf
)

# Set $WhatIfPreference so any cmdlets that support -WhatIf (Remove-Item, etc.)
# will preview instead of execute. Custom helpers (New-AsciiJunction,
# Set-ShortcutToSkin, Reset-ShortcutToOpenCode, Remove-AsciiJunction) consult
# the script-scoped $WhatIf variable below.
$WhatIfPreference = [bool]$WhatIf
$script:WhatIf = [bool]$WhatIf

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$StartScript = "$ScriptDir\start.ps1"
$ShortcutDescription = "OpenCode with Dream Skin"

. "$ScriptDir\common.ps1"

function New-AsciiJunction {
  param(
    [Parameter(Mandatory=$true)][string]$Link,
    [Parameter(Mandatory=$true)][string]$Target
  )
  if ($script:WhatIf) {
    Write-Host "  [WhatIf] Would create junction: $Link -> $Target" -ForegroundColor DarkGray
    return
  }
  if (Test-Path $Link) {
    $item = Get-Item $Link -Force
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
      $existing = (Get-Item $Link -Force).Target
      if ($existing -eq $Target) { return }
      Write-Host "  Removing stale junction: $Link -> $existing" -ForegroundColor Yellow
      Remove-Item $Link -Force
    } else {
      throw "$Link exists and is not a junction; refusing to overwrite."
    }
  }
  $parent = Split-Path -Parent $Link
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  & cmd.exe /c "mklink /J `"$Link`" `"$Target`"" | Out-Null
  if (-not (Test-Path $Link)) { throw "Failed to create junction $Link -> $Target" }
  Write-Host "  Created junction: $Link -> $Target" -ForegroundColor Green
}

function Remove-AsciiJunction {
  param([Parameter(Mandatory=$true)][string]$Link)
  if (Test-Path $Link) {
    $item = Get-Item $Link -Force
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
      if ($script:WhatIf) {
        Write-Host "  [WhatIf] Would remove junction: $Link -> $($item.Target)" -ForegroundColor DarkGray
        return
      }
      Remove-Item $Link -Force
      Write-Host "  Removed junction: $Link" -ForegroundColor Green
    }
  }
}

function Find-OpenCodeShortcuts {
  $candidates = @(
    (Join-Path $env:USERPROFILE "Desktop\OpenCode.lnk"),
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\OpenCode.lnk")
  )
  Get-ChildItem (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs") -Recurse -Filter "OpenCode.lnk" -ErrorAction SilentlyContinue |
    ForEach-Object { $candidates += $_.FullName }
  $candidates | Where-Object { Test-Path $_ }
}

function Get-ShortcutTarget {
  param([Parameter(Mandatory=$true)][string]$Path)
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Path)
  [PSCustomObject]@{
    TargetPath = $shortcut.TargetPath
    Arguments  = $shortcut.Arguments
    WorkingDirectory = $shortcut.WorkingDirectory
  }
}

function Set-ShortcutToSkin {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$PowerShell,
    [Parameter(Mandatory=$true)][string]$SkinScript,
    [Parameter(Mandatory=$true)][string]$OpenCodeExe,
    [int]$Port
  )
  if ($script:WhatIf) {
    Write-Host "  [WhatIf] Would rewrite shortcut: $Path -> powershell $SkinScript" -ForegroundColor DarkGray
    return
  }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = $PowerShell
  $shortcut.Arguments = "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$SkinScript`" -OpenCodePath `"$OpenCodeExe`" -CdpPort $Port -NoTray"
  $shortcut.WorkingDirectory = (Split-Path -Parent $SkinScript)
  $shortcut.Description = $ShortcutDescription
  $shortcut.IconLocation = "$OpenCodeExe,0"
  $shortcut.Save()
}

function Reset-ShortcutToOpenCode {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$OpenCodeExe
  )
  if ($script:WhatIf) {
    Write-Host "  [WhatIf] Would restore shortcut: $Path -> $OpenCodeExe" -ForegroundColor DarkGray
    return
  }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = $OpenCodeExe
  $shortcut.Arguments = ""
  $shortcut.WorkingDirectory = (Split-Path -Parent $OpenCodeExe)
  $shortcut.Description = "OpenCode Desktop"
  $shortcut.IconLocation = "$OpenCodeExe,0"
  $shortcut.Save()
}

function Test-ShortcutPointsToSkin {
  param([Parameter(Mandatory=$true)][string]$Path)
  $info = Get-ShortcutTarget -Path $Path
  return ($info.TargetPath -like "*WindowsPowerShell*powershell.exe") -and ($info.Arguments -match "start\.ps1")
}

if ($Uninstall) {
  Write-Host "`n=== OpenCode Skin Auto-Start: Uninstall ===" -ForegroundColor Yellow

  $installs = Find-OpenCodeInstall
  $opencodeExe = if ($installs.Count -gt 0) { $installs[0] } else { $null }

  foreach ($link in (Find-OpenCodeShortcuts)) {
    if (Test-ShortcutPointsToSkin -Path $link) {
      if ($opencodeExe) {
        Reset-ShortcutToOpenCode -Path $link -OpenCodeExe $opencodeExe
        Write-Host "  Restored: $link" -ForegroundColor Green
      } else {
        Write-Host "  WARNING: $link points to skin, but OpenCode.exe not found; leaving untouched." -ForegroundColor Yellow
      }
    } else {
      Write-Host "  Skipped (already original): $link" -ForegroundColor Gray
    }
  }

  # Stop any leftover monitor from previous installs
  $monitorProcs = Get-Process -Name "powershell" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*auto-inject*" }
  foreach ($p in $monitorProcs) {
    try { $p.Kill() } catch {}
  }
  if ($monitorProcs.Count -gt 0) {
    Write-Host "  Stopped $($monitorProcs.Count) leftover monitor process(es)" -ForegroundColor Green
  }

  # Remove startup shortcut if it exists from a previous version
  $startupLink = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\OpenCode Skin Monitor.lnk"
  if (Test-Path $startupLink) {
    Remove-Item $startupLink -Force
    Write-Host "  Removed legacy startup shortcut" -ForegroundColor Green
  }

  Remove-AsciiJunction -Link $JunctionRoot

  Write-Host "`nUninstall complete." -ForegroundColor Green
  exit 0
}

# --- Install ---

Write-Host "`n=== OpenCode Skin Auto-Start Setup ===" -ForegroundColor Cyan

# 1) Junction
Write-Host "`n[1/4] Creating ASCII junction..." -ForegroundColor Cyan
New-AsciiJunction -Link $JunctionRoot -Target $RootDir

# 2) Find OpenCode install
Write-Host "`n[2/4] Locating OpenCode.exe..." -ForegroundColor Cyan
$installs = Find-OpenCodeInstall
if ($installs.Count -eq 0) {
  throw "OpenCode not found. Please install OpenCode Desktop or pass -OpenCodePath."
}
$opencodeExe = $installs[0]
Write-Host "  Found: $opencodeExe" -ForegroundColor Green

# 3) Build a powershell.exe path that survives junction resolution
$psExe = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path $psExe)) { $psExe = "powershell.exe" }
$skinScriptViaJunction = "$JunctionRoot\windows\scripts\start.ps1"

# 4) Rewrite every OpenCode shortcut
Write-Host "`n[3/4] Rewriting OpenCode shortcuts..." -ForegroundColor Cyan
$shortcuts = Find-OpenCodeShortcuts
if ($shortcuts.Count -eq 0) {
  Write-Host "  No OpenCode shortcuts found; creating one on Desktop..." -ForegroundColor Yellow
  $desktopLink = Join-Path $env:USERPROFILE "Desktop\OpenCode.lnk"
  $shell = New-Object -ComObject WScript.Shell
  $tmp = $shell.CreateShortcut($desktopLink)
  $tmp.TargetPath = $opencodeExe
  $tmp.Save()
  $shortcuts = @($desktopLink)
}
foreach ($link in $shortcuts) {
  Set-ShortcutToSkin -Path $link -PowerShell $psExe -SkinScript $skinScriptViaJunction -OpenCodeExe $opencodeExe -Port $CdpPort
  if (-not $script:WhatIf) {
    Write-Host "  Updated: $link" -ForegroundColor Green
  }
}

# 5) Drop a VBS launcher in the same junction for users who prefer double-clicking
#    a non-PowerShell-Window shortcut. (Optional but matches the README's
#    start-with-skin.vbs pattern.)
Write-Host "`n[4/4] Writing junctioned start wrapper..." -ForegroundColor Cyan
if ($script:WhatIf) {
  Write-Host "  [WhatIf] Would write wrapper to $JunctionRoot\start-with-skin.vbs" -ForegroundColor DarkGray
} else {
$wrapperPath = "$JunctionRoot\start-with-skin.vbs"
$wrapper = @"
' Launches start.ps1 with hidden PowerShell window. Edit SkinScript/OpenCodePath
' if your layout differs. Generated by setup-autostart.ps1.
Set shell = CreateObject("WScript.Shell")
shell.Run chr(34) & "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" & chr(34) & _
  " -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & "$JunctionRoot\windows\scripts\start.ps1" & """", _
  0, False
"@
[System.IO.File]::WriteAllText($wrapperPath, $wrapper, [System.Text.UTF8Encoding]::new($false))
Write-Host "  Wrote: $wrapperPath" -ForegroundColor Green
}

Write-Host "`n=== Setup Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "How it works:" -ForegroundColor Cyan
Write-Host "  1. Junction $JunctionRoot -> $RootDir (ASCII path for .lnk)" -ForegroundColor Gray
Write-Host "  2. OpenCode shortcut now runs start.ps1 in a hidden window" -ForegroundColor Gray
Write-Host "  3. start.ps1 boots image server, OpenCode (CDP $CdpPort), and the injector inline" -ForegroundColor Gray
Write-Host "  4. Closing OpenCode tears down all helper processes (no residue)" -ForegroundColor Gray
Write-Host ""
Write-Host "To undo: .\setup-autostart.ps1 -Uninstall" -ForegroundColor Yellow
