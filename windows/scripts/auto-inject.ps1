# Auto-inject skin when OpenCode is detected
# Runs in background, monitors for OpenCode process, auto-starts injector
# Usage: powershell -WindowStyle Hidden -File auto-inject.ps1

param(
  [int]$CdpPort = 9335,
  [int]$CheckIntervalSec = 2
)

$ErrorActionPreference = "SilentlyContinue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InjectorPath = "$ProjectRoot\scripts\injector.mjs"
$StateDir = "$env:LOCALAPPDATA\OpenCodeDreamSkin"
$LogDir = "$StateDir\logs"

if (-not (Test-Path $LogDir)) {
  New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$LogFile = "$LogDir\auto-inject.log"

function Write-Log($msg) {
  $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  "$ts $msg" | Out-File -FilePath $LogFile -Append -Encoding UTF8
}

Write-Log "Auto-inject monitor started (port=$CdpPort)"

# Read theme from state.json or use default
$themeDir = "$ProjectRoot\assets"
$stateFile = "$StateDir\state.json"
if (Test-Path $stateFile) {
  try {
    $state = Get-Content $stateFile | ConvertFrom-Json
    if ($state.ThemeDir -and (Test-Path $state.ThemeDir)) {
      $themeDir = $state.ThemeDir
    }
  } catch {}
}

$injectorRunning = $false
$injectorPid = $null
$imageServerPid = $null

function Start-ImageServer {
  $serverPath = "$ProjectRoot\scripts\image-server.mjs"
  if (Test-Path $serverPath) {
    $proc = Start-Process -FilePath "node" -ArgumentList @($serverPath, "--port", "18765", "--theme-dir", $themeDir) -PassThru -WindowStyle Hidden
    $script:imageServerPid = $proc.Id
    Write-Log "Image server started (PID=$($proc.Id))"
  }
}

function Start-Injector {
  $args = @(
    $InjectorPath,
    "--watch",
    "--port", $CdpPort,
    "--auto-browser-id",
    "--theme-dir", $themeDir
  )
  $proc = Start-Process -FilePath "node" -ArgumentList $args -PassThru -WindowStyle Hidden
  $script:injectorPid = $proc.Id
  $script:injectorRunning = $true
  Write-Log "Injector started (PID=$($proc.Id))"

  # Save to state
  if (Test-Path $stateFile) {
    try {
      $s = Get-Content $stateFile | ConvertFrom-Json
      $s.InjectorPid = $proc.Id
      $s | ConvertTo-Json | Set-Content -Path $stateFile -Encoding UTF8
    } catch {}
  }
}

function Stop-Injector {
  if ($script:injectorPid) {
    $proc = Get-Process -Id $script:injectorPid -ErrorAction SilentlyContinue
    if ($proc -and -not $proc.HasExited) {
      try { $proc.Kill() } catch {}
      Write-Log "Injector stopped (PID=$($script:injectorPid))"
    }
  }
  if ($script:imageServerPid) {
    $proc = Get-Process -Id $script:imageServerPid -ErrorAction SilentlyContinue
    if ($proc -and -not $proc.HasExited) {
      try { $proc.Kill() } catch {}
      Write-Log "Image server stopped (PID=$($script:imageServerPid))"
    }
  }
  $script:injectorRunning = $false
  $script:injectorPid = $null
  $script:imageServerPid = $null
}

function Test-SkinInjected {
  try {
    $targets = (Invoke-WebRequest -Uri "http://127.0.0.1:$CdpPort/json/list" -UseBasicParsing -TimeoutSec 3).Content | ConvertFrom-Json
    $page = $targets | Where-Object { $_.type -eq "page" -and $_.url -like "oc://*" } | Select-Object -First 1
    if (-not $page) { return $false }

    $ws = New-Object System.Net.WebSockets.ClientWebSocket
    $uri = [Uri]$page.webSocketDebuggerUrl
    $ws.ConnectAsync($uri, [System.Threading.CancellationToken]::None).Wait(5000)
    $expr = 'document.documentElement.classList.contains("opencode-dream-skin")'
    $json = "{`"id`":1,`"method`":`"Runtime.evaluate`",`"params`":{`"expression`":`"$expr`",`"returnByValue`":true}}"
    $sendBuf = [System.Text.Encoding]::UTF8.GetBytes($json)
    $ws.SendAsync([System.ArraySegment[byte]]$sendBuf, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [System.Threading.CancellationToken]::None).Wait()
    $recvBuf = New-Object byte[] 2048
    $result = $ws.ReceiveAsync([System.ArraySegment[byte]]$recvBuf, [System.Threading.CancellationToken]::None).Result
    $response = [System.Text.Encoding]::UTF8.GetString($recvBuf, 0, $result.Count)
    $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "", [System.Threading.CancellationToken]::None).Wait()
    return $response -match '"value":true'
  } catch {
    return $false
  }
}

# Monitor loop
while ($true) {
  $opencodeRunning = Get-Process -Name "OpenCode" -ErrorAction SilentlyContinue
  $cdpReady = $false
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$CdpPort/json/version" -UseBasicParsing -TimeoutSec 2
    $cdpReady = $response.StatusCode -eq 200
  } catch {}

  if ($opencodeRunning -and $cdpReady) {
    # Check if injector is alive
    $injectorAlive = $false
    if ($injectorRunning -and $injectorPid) {
      $proc = Get-Process -Id $injectorPid -ErrorAction SilentlyContinue
      $injectorAlive = $proc -and -not $proc.HasExited
    }

    if (-not $injectorAlive) {
      Write-Log "OpenCode detected with CDP, starting image server and injector..."
      Start-ImageServer
      Start-Sleep -Milliseconds 500
      Start-Injector
      # Wait for injection to complete
      Start-Sleep -Seconds 4
      # Verify injection
      $injected = Test-SkinInjected
      if ($injected) {
        Write-Log "Skin injection verified OK"
      } else {
        Write-Log "Skin not detected after first attempt, retrying..."
        Stop-Injector
        Start-Sleep -Seconds 1
        Start-Injector
        Start-Sleep -Seconds 4
        $injected = Test-SkinInjected
        if ($injected) {
          Write-Log "Skin injection verified OK (retry)"
        } else {
          Write-Log "Skin injection failed after retry"
        }
      }
    }
  } elseif (-not $opencodeRunning -and $injectorRunning) {
    # OpenCode closed, stop injector
    Write-Log "OpenCode closed, stopping injector..."
    Stop-Injector
  }

  Start-Sleep -Seconds $CheckIntervalSec
}
