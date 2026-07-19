# Full flow test: Stop all → Start OpenCode → Verify skin auto-loads → Screenshot
# Usage: powershell -ExecutionPolicy Bypass -File test-full-flow.ps1

param([int]$CdpPort = 9335)

$ErrorActionPreference = "SilentlyContinue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$ResultsDir = "$ScriptDir\results"
$InjectorPath = "$RootDir\scripts\injector.mjs"
$ThemeDir = "$RootDir\assets"

if (-not (Test-Path $ResultsDir)) { New-Item -ItemType Directory -Path $ResultsDir -Force | Out-Null }

function Log($msg) { Write-Host "  $msg" -ForegroundColor Gray }
function Pass($msg) { Write-Host "  PASS: $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "  FAIL: $msg" -ForegroundColor Red }
function Step($msg) { Write-Host "`n>>> $msg" -ForegroundColor Cyan }

$testResults = @()

function Test-Check($name, $pass, $detail = "") {
  $script:testResults += @{ Name = $name; Pass = $pass; Detail = $detail }
  if ($pass) { Pass $name } else { Fail "$name - $detail" }
}

# ── Step 1: Kill everything ──────────────────────────────────────────
Step "Step 1: Stopping all processes"

Get-Process -Name "OpenCode" -ErrorAction SilentlyContinue | Stop-Process -Force
Log "Killed OpenCode"

Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*injector*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Log "Killed injector"

Get-Process -Name "powershell" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*auto-inject*" } |
  Stop-Process -Force -ErrorAction SilentlyContinue
Log "Killed monitor"

Start-Sleep -Seconds 3
Test-Check "All processes stopped" $true

# ── Step 2: Verify CDP is free ──────────────────────────────────────
Step "Step 2: Verify CDP port is free"
$portFree = $true
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:$CdpPort/json/version" -UseBasicParsing -TimeoutSec 2
  $portFree = $false
} catch {}
Test-Check "CDP port $CdpPort is free" $portFree

# ── Step 3: Start OpenCode ──────────────────────────────────────────
Step "Step 3: Starting OpenCode with CDP"
$exePath = "D:\OpenCode\OpenCode.exe"
Start-Process -FilePath $exePath -ArgumentList @("--remote-debugging-port=$CdpPort")
Log "Started OpenCode (PID from shortcut)"

# Wait for CDP
$cdpReady = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$CdpPort/json/version" -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { $cdpReady = $true; break }
  } catch {}
  if ($i % 5 -eq 4) { Log "Waiting for CDP... ($($i+1)s)" }
}
Test-Check "CDP ready on port $CdpPort" $cdpReady
if (-not $cdpReady) { Log "CDP failed, aborting"; exit 1 }

# ── Step 4: Check skin BEFORE injection ─────────────────────────────
Step "Step 4: Check skin state BEFORE injection"
$targets = (Invoke-WebRequest -Uri "http://127.0.0.1:$CdpPort/json/list" -UseBasicParsing).Content | ConvertFrom-Json
$page = $targets | Where-Object { $_.type -eq "page" -and $_.url -like "oc://*" } | Select-Object -First 1

$skinBefore = $false
if ($page) {
  $ws = New-Object System.Net.WebSockets.ClientWebSocket
  $uri = [Uri]$page.webSocketDebuggerUrl
  $ws.ConnectAsync($uri, [System.Threading.CancellationToken]::None).Wait()
  $sendBuf = [System.Text.Encoding]::UTF8.GetBytes('{"id":1,"method":"Runtime.evaluate","params":{"expression":"document.documentElement.classList.contains(\\"opencode-dream-skin\\")","returnByValue":true}}')
  $ws.SendAsync([System.ArraySegment[byte]]$sendBuf, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [System.Threading.CancellationToken]::None).Wait()
  $recvBuf = New-Object byte[] 4096
  $result = $ws.ReceiveAsync([System.ArraySegment[byte]]$recvBuf, [System.Threading.CancellationToken]::None).Result
  $json = [System.Text.Encoding]::UTF8.GetString($recvBuf, 0, $result.Count)
  $skinBefore = $json -match '"value":true'
  $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "", [System.Threading.CancellationToken]::None).Wait()
}
Test-Check "No skin before injection" (-not $skinBefore)

# ── Step 5: Start injector manually (simulating auto-inject) ────────
Step "Step 5: Starting injector"
$injectorArgs = @(
  "--watch",
  "--port", $CdpPort,
  "--auto-browser-id",
  "--theme-dir", $ThemeDir
)
$injectorProc = Start-Process -FilePath "node" -ArgumentList @($InjectorPath) + $injectorArgs -PassThru -WindowStyle Hidden
Log "Injector started (PID=$($injectorProc.Id))"

# Wait for injection
Start-Sleep -Seconds 5

# ── Step 6: Check skin AFTER injection ──────────────────────────────
Step "Step 6: Check skin state AFTER injection"
$skinAfter = $false
$hasHome = $false
$hasStyle = $false
$hasBg = $false

if ($page) {
  $ws2 = New-Object System.Net.WebSockets.ClientWebSocket
  $uri2 = [Uri]$page.webSocketDebuggerUrl
  $ws2.ConnectAsync($uri2, [System.Threading.CancellationToken]::None).Wait()
  $expr = 'JSON.stringify({skin:document.documentElement.classList.contains("opencode-dream-skin"),home:!!document.querySelector(".dream-home"),style:(document.getElementById("opencode-dream-skin-style")||{}).textContent?.length||0,bg:(document.documentElement.style.backgroundImage||"").substring(0,40)})'
  $sendBuf2 = [System.Text.Encoding]::UTF8.GetBytes("{`"id`":1,`"method`":`"Runtime.evaluate`",`"params`":{`"expression`":`"$expr`",`"returnByValue`":true}}")
  $ws2.SendAsync([System.ArraySegment[byte]]$sendBuf2, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [System.Threading.CancellationToken]::None).Wait()
  $recvBuf2 = New-Object byte[] 8192
  $result2 = $ws2.ReceiveAsync([System.ArraySegment[byte]]$recvBuf2, [System.Threading.CancellationToken]::None).Result
  $json2 = [System.Text.Encoding]::UTF8.GetString($recvBuf2, 0, $result2.Count)
  if ($json2 -match '"skin":(true|false)') { $skinAfter = $matches[1] -eq "true" }
  if ($json2 -match '"home":(true|false)') { $hasHome = $matches[1] -eq "true" }
  if ($json2 -match '"style":(\d+)') { $hasStyle = [int]$matches[1] -gt 0 }
  if ($json2 -match '"bg":"([^"]+)"') { $hasBg = $matches[1] -ne "" }
  $ws2.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "", [System.Threading.CancellationToken]::None).Wait()
}

Test-Check "Skin class applied" $skinAfter
Test-Check "Home class applied" $hasHome
Test-Check "CSS injected" $hasStyle
Test-Check "Background image set" $hasBg

# ── Step 7: Take screenshots ────────────────────────────────────────
Step "Step 7: Taking screenshots"
$screenshotJs = 'Page.captureScreenshot'

foreach ($target in ($targets | Where-Object { $_.type -eq "page" -and $_.url -like "oc://*" })) {
  $label = if ($target.url -match "index.html") { "page" } else { $target.id.Substring(0, 8) }
  try {
    $ws3 = New-Object System.Net.WebSockets.ClientWebSocket
    $uri3 = [Uri]$target.webSocketDebuggerUrl
    $ws3.ConnectAsync($uri3, [System.Threading.CancellationToken]::None).Wait()
    $sendBuf3 = [System.Text.Encoding]::UTF8.GetBytes('{"id":1,"method":"Page.captureScreenshot","params":{"format":"png","fromSurface":true}}')
    $ws3.SendAsync([System.ArraySegment[byte]]$sendBuf3, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [System.Threading.CancellationToken]::None).Wait()
    $recvBuf3 = New-Object byte[] 1048576
    $result3 = $ws3.ReceiveAsync([System.ArraySegment[byte]]$recvBuf3, [System.Threading.CancellationToken]::None).Result
    $json3 = [System.Text.Encoding]::UTF8.GetString($recvBuf3, 0, $result3.Count)
    if ($json3 -match '"data":"([A-Za-z0-9+/=]+)"') {
      $bytes = [Convert]::FromBase64String($matches[1])
      $outPath = "$ResultsDir\flow-test-$label.png"
      [System.IO.File]::WriteAllBytes($outPath, $bytes)
      Log "Saved: flow-test-$label.png ($([math]::Round($bytes.Length/1024))KB)"
    }
    $ws3.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "", [System.Threading.CancellationToken]::None).Wait()
  } catch { Log "Screenshot failed for $label" }
}

# ── Step 8: Kill injector (cleanup) ─────────────────────────────────
Step "Step 8: Cleanup"
Stop-Process -Id $injectorProc.Id -Force -ErrorAction SilentlyContinue
Log "Injector stopped"

# ── Summary ──────────────────────────────────────────────────────────
$passed = ($testResults | Where-Object { $_.Pass }).Count
$failed = ($testResults | Where-Object { -not $_.Pass }).Count
$total = $testResults.Count

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "  FLOW TEST RESULTS: $passed/$total passed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
Write-Host "============================================" -ForegroundColor Cyan
foreach ($t in $testResults) {
  $icon = if ($t.Pass) { "[OK]" } else { "[!!]" }
  $color = if ($t.Pass) { "Green" } else { "Red" }
  Write-Host "  $icon $($t.Name)" -ForegroundColor $color
  if ($t.Detail) { Write-Host "       $($t.Detail)" -ForegroundColor Gray }
}
Write-Host ""

$screenshots = Get-ChildItem -Path $ResultsDir -Filter "flow-test-*.png" -ErrorAction SilentlyContinue
if ($screenshots) {
  Write-Host "Screenshots:" -ForegroundColor Yellow
  foreach ($s in $screenshots) { Write-Host "  $($s.Name) ($([math]::Round($s.Length/1024))KB)" -ForegroundColor Gray }
}
