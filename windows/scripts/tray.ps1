# System tray for OpenCode Dream Skin

param(
  [int]$CdpPort = 9335
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$trayIcon = New-Object System.Windows.Forms.NotifyIcon
$trayIcon.Icon = [System.Drawing.SystemIcons]::Application
$trayIcon.Text = "OpenCode Dream Skin"
$trayIcon.Visible = $true

$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

$openItem = New-Object System.Windows.Forms.ToolStripMenuItem
$openItem.Text = "Open OpenCode"
$openItem.Add_Click({
  $stateFile = "$env:LOCALAPPDATA\OpenCodeDreamSkin\state.json"
  if (Test-Path $stateFile) {
    $state = Get-Content $stateFile | ConvertFrom-Json
    if ($state.OpenCodePath) { Start-Process $state.OpenCodePath }
  }
})

$themeItem = New-Object System.Windows.Forms.ToolStripMenuItem
$themeItem.Text = "Change Theme"

function Switch-Theme {
  param([string]$ThemeName)
  $stateFile = "$env:LOCALAPPDATA\OpenCodeDreamSkin\state.json"
  if (-not (Test-Path $stateFile)) {
    [System.Windows.Forms.MessageBox]::Show("No active skin. Start skin first.", "OpenCode Skin", "OK", "Warning")
    return
  }
  $state = Get-Content $stateFile | ConvertFrom-Json
  $themeScript = "$PSScriptRoot\theme.ps1"
  & $themeScript -Set $ThemeName
  if ($LASTEXITCODE -ne 0) { return }

  # Kill old injector
  if ($state.InjectorPid) {
    $proc = Get-Process -Id $state.InjectorPid -ErrorAction SilentlyContinue
    if ($proc -and -not $proc.HasExited) {
      try { $proc.Kill() } catch {}
    }
  }

  # Restart injector with new theme
  $newState = Get-Content $stateFile | ConvertFrom-Json
  $injectorPath = "$PSScriptRoot\injector.mjs"
  $proc = Start-Process -FilePath "node" -ArgumentList @(
    $injectorPath,
    "--port", $state.CdpPort,
    "--auto-browser-id",
    "--theme-dir", $newState.ThemeDir
  ) -PassThru -WindowStyle Hidden
  $newState.InjectorPid = $proc.Id
  $newState | ConvertTo-Json | Set-Content -Path $stateFile -Encoding UTF8
  $trayIcon.ShowBalloonTip(2000, "OpenCode Skin", "Theme: $ThemeName", [System.Windows.Forms.ToolTipIcon]::Info)
}

$presetsDir = "$PSScriptRoot\..\presets"
if (Test-Path $presetsDir) {
  $presetDirs = Get-ChildItem -Path $presetsDir -Directory
  foreach ($dir in $presetDirs) {
    $themeJson = Join-Path $dir.FullName "theme.json"
    if (Test-Path $themeJson) {
      $themeData = Get-Content $themeJson | ConvertFrom-Json
      $subItem = New-Object System.Windows.Forms.ToolStripMenuItem
      $subItem.Text = $themeData.name
      $subItem.Add_Click([Action]{
        param($sender, $e)
        $name = $sender.Text
        Switch-Theme -ThemeName $name
      })
      $themeItem.DropDownItems.Add($subItem)
    }
  }
}

# Add default theme option
$defaultItem = New-Object System.Windows.Forms.ToolStripMenuItem
$defaultItem.Text = "Default (OpenCode Dream Skin)"
$defaultItem.Add_Click({ Switch-Theme -ThemeName "default" })
$themeItem.DropDownItems.Add($defaultItem)

$pauseItem = New-Object System.Windows.Forms.ToolStripMenuItem
$pauseItem.Text = "Pause Skin"
$pauseItem.CheckOnClick = $true
$pauseItem.Add_Click({
  $pauseFile = "$env:LOCALAPPDATA\OpenCodeDreamSkin\pause"
  if ($pauseItem.Checked) {
    Set-Content -Path $pauseFile -Value "paused"
  } else {
    if (Test-Path $pauseFile) { Remove-Item $pauseFile -Force }
  }
})

$restoreItem = New-Object System.Windows.Forms.ToolStripMenuItem
$restoreItem.Text = "Restore Original"
$restoreItem.Add_Click({ & "$PSScriptRoot\restore.ps1" })

$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem
$exitItem.Text = "Exit"
$exitItem.Add_Click({
  $trayIcon.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

$contextMenu.Items.Add($openItem)
$contextMenu.Items.Add($themeItem)
$contextMenu.Items.Add($pauseItem)
$contextMenu.Items.Add($restoreItem)
$contextMenu.Items.Add("-")
$contextMenu.Items.Add($exitItem)

$trayIcon.ContextMenuStrip = $contextMenu

$trayIcon.Add_DoubleClick({
  $stateFile = "$env:LOCALAPPDATA\OpenCodeDreamSkin\state.json"
  if (Test-Path $stateFile) {
    $state = Get-Content $stateFile | ConvertFrom-Json
    if ($state.OpenCodePath) { Start-Process $state.OpenCodePath }
  }
})

$trayIcon.ShowBalloonTip(3000, "OpenCode Dream Skin", "Skin is active", [System.Windows.Forms.ToolTipIcon]::Info)

[System.Windows.Forms.Application]::Run()
