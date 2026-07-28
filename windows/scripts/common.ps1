# Common functions for OpenCode Dream Skin

function Find-OpenCodeInstall {
  $candidates = [System.Collections.ArrayList]@()

  $searchPaths = @(
    [string]"D:\OpenCode\OpenCode.exe",
    [string]"$env:LOCALAPPDATA\Programs\opencode\OpenCode.exe",
    [string]"$env:LOCALAPPDATA\opencode\OpenCode.exe",
    [string]"${env:ProgramFiles}\OpenCode\OpenCode.exe",
    [string]"${env:ProgramFiles(x86)}\OpenCode\OpenCode.exe",
    [string]"$env:USERPROFILE\scoop\apps\opencode\current\OpenCode.exe",
    [string]"$env:USERPROFILE\.cargo\bin\opencode.exe"
  )

  foreach ($p in $searchPaths) {
    if (Test-Path $p -PathType Leaf) {
      [void]$candidates.Add($p)
    }
  }

  $pathCmd = Get-Command "OpenCode.exe" -ErrorAction SilentlyContinue
  if ($pathCmd) {
    [void]$candidates.Add($pathCmd.Source)
  }

  $process = Get-Process "OpenCode" -ErrorAction SilentlyContinue
  if ($process -and $process.Path) {
    [void]$candidates.Add($process.Path)
  }

  $uninstallKeys = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\opencode",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\opencode"
  )

  foreach ($key in $uninstallKeys) {
    if (Test-Path $key) {
      $installLocation = Get-ItemProperty -Path $key -Name "InstallLocation" -ErrorAction SilentlyContinue
      if ($installLocation.InstallLocation) {
        $exePath = Join-Path $installLocation.InstallLocation "OpenCode.exe"
        if (Test-Path $exePath -PathType Leaf) {
          [void]$candidates.Add($exePath)
        }
      }
    }
  }

  $seen = @{}
  $unique = [System.Collections.ArrayList]@()
  foreach ($item in $candidates) {
    if ($item -and (Test-Path $item -PathType Leaf) -and -not $seen.ContainsKey($item)) {
      $seen[$item] = $true
      [void]$unique.Add($item)
    }
  }
  return @($unique)
}

function Start-OpenCodeApp {
  param(
    [Parameter(Mandatory=$true)]
    [string]$ExecutablePath,
    [string[]]$Arguments = @(),
    [switch]$PassThru
  )
  
  if (-not (Test-Path $ExecutablePath)) {
    throw "OpenCode executable not found: $ExecutablePath"
  }
  
  $startArgs = @{
    FilePath = $ExecutablePath
    ArgumentList = $Arguments
    PassThru = $PassThru
    WindowStyle = "Normal"
  }
  
  return Start-Process @startArgs
}

function Stop-OpenCodeApp {
  param(
    [string]$ExecutablePath,
    [switch]$AllowForce,
    [int]$TimeoutSeconds = 15
  )
  
  $processes = Get-Process -Name "OpenCode" -ErrorAction SilentlyContinue
  
  if ($ExecutablePath) {
    $processes = $processes | Where-Object { $_.Path -eq $ExecutablePath }
  }
  
  foreach ($p in $processes) {
    try { $p.CloseMainWindow() } catch {}
  }
  
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $stillRunning = $true
  
  while ($stillRunning -and (Get-Date) -lt $deadline) {
    $processes = Get-Process -Name "OpenCode" -ErrorAction SilentlyContinue
    if ($ExecutablePath) {
      $processes = $processes | Where-Object { $_.Path -eq $ExecutablePath }
    }
    $stillRunning = $processes.Count -gt 0
    if ($stillRunning) { Start-Sleep -Milliseconds 500 }
  }
  
  if ($stillRunning -and $AllowForce) {
    $processes = Get-Process -Name "OpenCode" -ErrorAction SilentlyContinue
    if ($ExecutablePath) {
      $processes = $processes | Where-Object { $_.Path -eq $ExecutablePath }
    }
    foreach ($p in $processes) {
      try { $p.Kill() } catch {}
    }
  }
}

function Get-OpenCodeProcesses {
  param([string]$ExecutablePath)
  
  $processes = Get-Process -Name "OpenCode" -ErrorAction SilentlyContinue
  if ($ExecutablePath) {
    $processes = $processes | Where-Object { $_.Path -eq $ExecutablePath }
  }
  return $processes
}

function Test-OpenCodePortOwner {
  param([Parameter(Mandatory=$true)][int]$Port)
  
  $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
  foreach ($conn in $connections) {
    $process = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    if ($process -and $process.Name -eq "OpenCode") { return $true }
  }
  return $false
}

function Wait-OpenCodeReady {
  param(
    [Parameter(Mandatory=$true)][int]$Port,
    [int]$TimeoutSeconds = 30,
    [int]$RetryIntervalMs = 500
  )
  
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/version" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { return $true }
    } catch {}
    Start-Sleep -Milliseconds $RetryIntervalMs
  }
  return $false
}

function Get-OpenCodeVersion {
  param([Parameter(Mandatory=$true)][string]$ExecutablePath)
  
  if (-not (Test-Path $ExecutablePath)) { return $null }
  try {
    $versionInfo = Get-Item $ExecutablePath | Select-Object -ExpandProperty VersionInfo
    return $versionInfo.ProductVersion
  } catch { return $null }
}
