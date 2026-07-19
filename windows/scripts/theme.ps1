# Theme management for OpenCode Dream Skin

param(
  [Parameter(Mandatory=$true, ParameterSetName="Set")]
  [string]$Set,
  [Parameter(ParameterSetName="List")]
  [switch]$List,
  [Parameter(ParameterSetName="Current")]
  [switch]$Current,
  [Parameter(ParameterSetName="Info")]
  [string]$Info,
  [string]$ThemeDir
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

if (-not $ThemeDir) {
  $ThemeDir = "$RootDir\assets"
}

function Get-ThemeList {
  param([string]$BaseDir)
  
  $themes = @()
  
  $themeJson = Join-Path $BaseDir "theme.json"
  if (Test-Path $themeJson) {
    $theme = Get-Content $themeJson | ConvertFrom-Json
    $themes += @{
      Id = $theme.id
      Name = $theme.name
      Path = $BaseDir
      JsonPath = $themeJson
    }
  }
  
  $presetsDir = "$RootDir\presets"
  if (Test-Path $presetsDir) {
    $presetDirs = Get-ChildItem -Path $presetsDir -Directory
    foreach ($dir in $presetDirs) {
      $presetJson = Join-Path $dir.FullName "theme.json"
      if (Test-Path $presetJson) {
        $preset = Get-Content $presetJson | ConvertFrom-Json
        $themes += @{
          Id = $preset.id
          Name = $preset.name
          Path = $dir.FullName
          JsonPath = $presetJson
        }
      }
    }
  }
  
  return $themes
}

function Get-ThemeInfo {
  param([string]$ThemePath)
  
  $themeJson = Join-Path $ThemePath "theme.json"
  if (-not (Test-Path $themeJson)) {
    throw "Theme not found at: $ThemePath"
  }
  
  $theme = Get-Content $themeJson | ConvertFrom-Json
  $imagePath = Join-Path $ThemePath $theme.image
  $hasImage = Test-Path $imagePath
  
  return @{
    Id = $theme.id
    Name = $theme.name
    Image = $theme.image
    Appearance = $theme.appearance
    Art = $theme.art
    Palette = $theme.palette
    HasImage = $hasImage
    Path = $ThemePath
  }
}

switch ($PSCmdlet.ParameterSetName) {
  "List" {
    $themes = Get-ThemeList -BaseDir $ThemeDir
    Write-Host "Available themes:" -ForegroundColor Cyan
    foreach ($theme in $themes) {
      Write-Host "  - $($theme.Name) ($($theme.Id))" -ForegroundColor Green
      Write-Host "    Path: $($theme.Path)" -ForegroundColor Gray
    }
  }
  
  "Current" {
    $stateFile = "$env:LOCALAPPDATA\OpenCodeDreamSkin\state.json"
    if (Test-Path $stateFile) {
      $state = Get-Content $stateFile | ConvertFrom-Json
      $themeInfo = Get-ThemeInfo -ThemePath $state.ThemeDir
      Write-Host "Current theme:" -ForegroundColor Cyan
      Write-Host "  Name: $($themeInfo.Name)" -ForegroundColor Green
      Write-Host "  ID: $($themeInfo.Id)" -ForegroundColor Green
      Write-Host "  Path: $($themeInfo.Path)" -ForegroundColor Gray
    } else {
      Write-Host "No active skin" -ForegroundColor Yellow
    }
  }
  
  "Info" {
    $themes = Get-ThemeList -BaseDir $ThemeDir
    $theme = $themes | Where-Object { $_.Id -eq $Info -or $_.Name -eq $Info } | Select-Object -First 1
    if ($theme) {
      $info = Get-ThemeInfo -ThemePath $theme.Path
      Write-Host "Theme info:" -ForegroundColor Cyan
      Write-Host "  Name: $($info.Name)" -ForegroundColor Green
      Write-Host "  ID: $($info.Id)" -ForegroundColor Green
      Write-Host "  Image: $($info.Image)" -ForegroundColor Green
      Write-Host "  Appearance: $($info.Appearance)" -ForegroundColor Green
      Write-Host "  Has Image: $($info.HasImage)" -ForegroundColor Green
      Write-Host "  Path: $($info.Path)" -ForegroundColor Gray
    } else {
      Write-Host "Theme not found: $Info" -ForegroundColor Red
    }
  }
  
  "Set" {
    $themes = Get-ThemeList -BaseDir $ThemeDir
    $theme = $themes | Where-Object { $_.Id -eq $Set -or $_.Name -eq $Set } | Select-Object -First 1
    if (-not $theme) {
      Write-Host "Theme not found: $Set" -ForegroundColor Red
      Write-Host "Available themes:" -ForegroundColor Yellow
      foreach ($t in $themes) {
        Write-Host "  - $($t.Name) ($($t.Id))" -ForegroundColor Yellow
      }
      exit 1
    }

    # Validate theme has required files
    $themeJson = Join-Path $theme.Path "theme.json"
    $themeData = Get-Content $themeJson | ConvertFrom-Json
    $imagePath = Join-Path $theme.Path $themeData.image
    if (-not (Test-Path $imagePath)) {
      Write-Host "Theme image not found: $imagePath" -ForegroundColor Red
      exit 1
    }

    # Update state.json
    $stateDir = "$env:LOCALAPPDATA\OpenCodeDreamSkin"
    $stateFile = "$stateDir\state.json"

    if (-not (Test-Path $stateDir)) {
      New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    }

    $state = @{}
    if (Test-Path $stateFile) {
      $existing = Get-Content $stateFile | ConvertFrom-Json
      foreach ($prop in $existing.PSObject.Properties) {
        $state[$prop.Name] = $prop.Value
      }
    }

    $state["ThemeDir"] = $theme.Path
    $state["LastThemeSwitch"] = (Get-Date).ToString("o")

    $state | ConvertTo-Json | Set-Content -Path $stateFile -Encoding UTF8

    Write-Host "Theme set to: $($theme.Name)" -ForegroundColor Green
    Write-Host "Path: $($theme.Path)" -ForegroundColor Gray
    Write-Host "Restart injector to apply: node injector.mjs --reload --port $($state.CdpPort) --theme-dir `"$($theme.Path)`"" -ForegroundColor Yellow
  }
}
