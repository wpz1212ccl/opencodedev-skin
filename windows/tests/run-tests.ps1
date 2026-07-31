# Run tests for OpenCode Dream Skin

param(
  [switch]$SkipInjectorTests,
  [switch]$SkipThemeTests,
  [switch]$Verbose
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)

. "$RootDir\windows\scripts\common.ps1"

Write-Host "Running OpenCode Dream Skin tests..." -ForegroundColor Cyan

$tests = @()
$passed = 0
$failed = 0

function Test-Function {
  param(
    [string]$Name,
    [scriptblock]$TestBlock
  )
  
  Write-Host "Testing: $Name" -ForegroundColor Yellow
  try {
    $result = & $TestBlock
    if ($result) {
      Write-Host "  PASS" -ForegroundColor Green
      return @{ Name = $Name; Pass = $true; Message = "" }
    } else {
      Write-Host "  FAIL" -ForegroundColor Red
      return @{ Name = $Name; Pass = $false; Message = "Test returned false" }
    }
  } catch {
    Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
    return @{ Name = $Name; Pass = $false; Message = $_.Exception.Message }
  }
}

$tests += Test-Function "Find-OpenCodeInstall" {
  $installs = Find-OpenCodeInstall
  return $installs.Count -ge 0
}

if (-not $SkipInjectorTests) {
  $injectorPath = "$RootDir\windows\scripts\injector.mjs"
  if (Test-Path $injectorPath) {
    $tests += Test-Function "Injector self-test" {
      $result = & node $injectorPath --self-test --port 9335 2>&1
      return $LASTEXITCODE -eq 0
    }
    
    $tests += Test-Function "Injector payload check" {
      $result = & node $injectorPath --check-payload --theme-dir "$RootDir\windows\assets" 2>&1
      return $LASTEXITCODE -eq 0
    }
  }
}

if (-not $SkipThemeTests) {
  $themeJson = "$RootDir\windows\assets\theme.json"
  if (Test-Path $themeJson) {
    $tests += Test-Function "Theme JSON valid" {
      $theme = Get-Content $themeJson | ConvertFrom-Json
      return $theme.id -and $theme.name -and $theme.image
    }
    
    $tests += Test-Function "Theme image exists" {
      $theme = Get-Content $themeJson | ConvertFrom-Json
      $imagePath = Join-Path "$RootDir\windows\assets" $theme.image
      return Test-Path $imagePath
    }
  }
}

$tests += Test-Function "Required files exist" {
  $requiredFiles = @(
    "$RootDir\windows\scripts\injector.mjs",
    "$RootDir\windows\scripts\common.ps1",
    "$RootDir\windows\scripts\start.ps1",
    "$RootDir\windows\scripts\restore.ps1",
    "$RootDir\windows\assets\theme.json",
    "$RootDir\windows\assets\dream-skin.css",
    "$RootDir\windows\assets\renderer-inject.js"
  )
  
  foreach ($file in $requiredFiles) {
    if (-not (Test-Path $file)) {
      Write-Host "    Missing: $file" -ForegroundColor Red
      return $false
    }
  }
  return $true
}

Write-Host ""
Write-Host "Test Results:" -ForegroundColor Cyan
Write-Host "=============" -ForegroundColor Cyan

foreach ($test in $tests) {
  if ($test.Pass) {
    $status = "PASS"
    $color = "Green"
  } else {
    $status = "FAIL"
    $color = "Red"
  }
  
  Write-Host "[$status] $($test.Name)" -ForegroundColor $color
  if ($test.Message) {
    Write-Host "       $($test.Message)" -ForegroundColor Gray
  }
  
  if ($test.Pass) { $passed++ } else { $failed++ }
}

Write-Host ""
if ($failed -eq 0) {
  Write-Host "Summary: $passed passed, $failed failed" -ForegroundColor Green
} else {
  Write-Host "Summary: $passed passed, $failed failed" -ForegroundColor Red
}

if ($failed -gt 0) {
  Write-Host ""
  Write-Host "Some tests failed!" -ForegroundColor Yellow
  exit 1
} else {
  Write-Host ""
  Write-Host "All tests passed!" -ForegroundColor Green
  exit 0
}
