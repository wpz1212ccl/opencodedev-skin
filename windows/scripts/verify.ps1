# Verify OpenCode Dream Skin installation

param(
  [int]$CdpPort = 9335
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

. "$ScriptDir\common.ps1"

Write-Host "Verifying OpenCode Dream Skin installation..." -ForegroundColor Cyan

$checks = @()

$nodeCmd = Get-Command "node" -ErrorAction SilentlyContinue
if ($nodeCmd) {
  $nodeVersion = & node --version 2>&1
  $nodeMessage = "Version: $nodeVersion"
} else {
  $nodeMessage = "Not found"
}
$checks += @{ Name = "Node.js"; Pass = [bool]$nodeCmd; Message = $nodeMessage }

$injectorPath = "$ScriptDir\injector.mjs"
$checks += @{ Name = "Injector"; Pass = Test-Path $injectorPath; Message = $injectorPath }

$themeDir = "$RootDir\assets"
$checks += @{ Name = "Theme directory"; Pass = Test-Path $themeDir; Message = $themeDir }

$themeJson = "$themeDir\theme.json"
$checks += @{ Name = "Theme configuration"; Pass = Test-Path $themeJson; Message = $themeJson }

$installs = Find-OpenCodeInstall
if ($installs.Count -gt 0) {
  $installMessage = "Found: $($installs[0])"
} else {
  $installMessage = "Not found"
}
$checks += @{ Name = "OpenCode installation"; Pass = $installs.Count -gt 0; Message = $installMessage }

if ($nodeCmd -and $injectorPath) {
  Write-Host "Running injector validation..." -ForegroundColor Cyan
  $validationResult = & node $injectorPath --self-test --port $CdpPort 2>&1
  $validationPass = $LASTEXITCODE -eq 0
  $validationMessage = if ($validationPass) { "Passed" } else { "Failed: $validationResult" }
  $checks += @{ Name = "Injector validation"; Pass = $validationPass; Message = $validationMessage }
}

if ($nodeCmd -and $injectorPath -and $themeDir) {
  Write-Host "Testing payload generation..." -ForegroundColor Cyan
  $payloadResult = & node $injectorPath --check-payload --theme-dir $themeDir 2>&1
  $payloadPass = $LASTEXITCODE -eq 0
  $payloadMessage = if ($payloadPass) { "Passed" } else { "Failed: $payloadResult" }
  $checks += @{ Name = "Payload generation"; Pass = $payloadPass; Message = $payloadMessage }
}

Write-Host "Checking CDP connection..." -ForegroundColor Cyan
$cdpReady = Wait-OpenCodeReady -Port $CdpPort -TimeoutSeconds 5
$cdpMessage = if ($cdpReady) { "Connected on port $CdpPort" } else { "Not connected" }
$checks += @{ Name = "CDP connection"; Pass = $cdpReady; Message = $cdpMessage }

Write-Host ""
Write-Host "Verification Results:" -ForegroundColor Cyan
Write-Host "====================" -ForegroundColor Cyan

$passed = 0
$failed = 0

foreach ($check in $checks) {
  if ($check.Pass) {
    $status = "PASS"
    $color = "Green"
  } else {
    $status = "FAIL"
    $color = "Red"
  }
  
  Write-Host "[$status] $($check.Name)" -ForegroundColor $color
  Write-Host "       $($check.Message)" -ForegroundColor Gray
  
  if ($check.Pass) { $passed++ } else { $failed++ }
}

Write-Host ""
if ($failed -eq 0) {
  Write-Host "Summary: $passed passed, $failed failed" -ForegroundColor Green
} else {
  Write-Host "Summary: $passed passed, $failed failed" -ForegroundColor Red
}

if ($failed -gt 0) {
  Write-Host ""
  Write-Host "Please fix the failing checks before using OpenCode Dream Skin." -ForegroundColor Yellow
  exit 1
} else {
  Write-Host ""
  Write-Host "All checks passed! OpenCode Dream Skin is ready to use." -ForegroundColor Green
  exit 0
}
