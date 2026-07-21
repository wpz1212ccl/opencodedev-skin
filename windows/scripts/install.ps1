# Install OpenCode Dream Skin

param(
  [string]$OpenCodePath,
  [switch]$CreateShortcut,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)

. "$ScriptDir\common.ps1"

Write-Host "Installing OpenCode Dream Skin..." -ForegroundColor Cyan

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

$nodeCmd = Get-Command "node" -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  throw "Node.js is required. Please install Node.js from https://nodejs.org/"
}

$nodeVersion = & node --version
$versionMatch = [regex]::Match($nodeVersion, 'v(\d+)')
if ($versionMatch.Success -and [int]$versionMatch.Groups[1].Value -lt 16) {
  throw "Node.js 16+ is required. Found: $nodeVersion"
}
Write-Host "Node.js version: $nodeVersion" -ForegroundColor Green

$stateDir = "$env:LOCALAPPDATA\OpenCodeDreamSkin"
if (-not (Test-Path $stateDir)) {
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
  Write-Host "Created configuration directory: $stateDir" -ForegroundColor Green
}

$injectorPath = "$RootDir\scripts\injector.mjs"
if (-not (Test-Path $injectorPath)) {
  throw "Injector not found at: $injectorPath"
}

Write-Host "Validating injector..." -ForegroundColor Cyan
$validationResult = & node $injectorPath --self-test --port 9335 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Injector validation failed: $validationResult"
}
Write-Host "Injector validation passed" -ForegroundColor Green

$themeDir = "$RootDir\assets"
if (-not (Test-Path $themeDir)) {
  throw "Theme directory not found at: $themeDir"
}

$themeJson = "$themeDir\theme.json"
if (-not (Test-Path $themeJson)) {
  throw "Theme configuration not found at: $themeJson"
}

Write-Host "Theme directory: $themeDir" -ForegroundColor Green

if ($CreateShortcut) {
  Write-Host "Creating shortcut..." -ForegroundColor Cyan
  $shortcutPath = "$env:USERPROFILE\Desktop\OpenCode Skin.lnk"
  $shortcut = New-Object -ComObject WScript.Shell
  $shortcutObject = $shortcut.CreateShortcut($shortcutPath)
  $shortcutObject.TargetPath = "powershell.exe"
  $shortcutObject.Arguments = "-File `"$ScriptDir\start.ps1`" -OpenCodePath `"$OpenCodePath`""
  $shortcutObject.WorkingDirectory = $RootDir
  $shortcutObject.Description = "OpenCode with Dream Skin"
  $shortcutObject.Save()
  Write-Host "Shortcut created: $shortcutPath" -ForegroundColor Green
}

$installInfo = @{
  OpenCodePath = $OpenCodePath
  InstallPath = $RootDir
  ThemeDir = $themeDir
  InstallTime = (Get-Date).ToString("o")
  Version = "1.0.0"
}

$installInfo | ConvertTo-Json | Set-Content -Path "$stateDir\install.json" -Encoding UTF8
Write-Host "Installation information saved" -ForegroundColor Green

Write-Host "Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "To start OpenCode with Dream Skin:" -ForegroundColor Cyan
Write-Host "  Run: `"$ScriptDir\start.ps1`"" -ForegroundColor Yellow
