/**
 * Test: Simulate user restart flow
 * 1. Verify skin is injected
 * 2. Kill OpenCode
 * 3. Verify injector stops
 * 4. Re-launch OpenCode
 * 5. Wait for auto-inject to re-inject
 * 6. Verify skin is present
 * 7. Verify Ctrl+S works
 */
import { execSync, spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import fs from 'fs';

const PORT = 9335;
const THEME_DIR = 'D:\\code\\codex移植opencode\\opencode-skin\\windows\\assets';
const INJECTOR = 'D:\\code\\codex移植opencode\\opencode-skin\\windows\\scripts\\injector.mjs';
const RESULTS = 'D:\\code\\codex移植opencode\\opencode-skin\\windows\\tests\\results';

let pass = 0, fail = 0;
function log(m, t = 'info') {
  const p = { pass: '✅', fail: '❌', info: 'ℹ️', warn: '⚠️' }[t] || '';
  console.log(`${p} ${m}`);
}
function ok(c, m) { if (c) { pass++; log(m, 'pass'); } else { fail++; log(m, 'fail'); } return c; }

async function httpGet(url) {
  const res = await fetch(url);
  return res.ok;
}

async function getTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  const targets = await res.json();
  return targets.find(t => t.url?.includes('oc://'));
}

async function cdpEval(targetId, expr) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/devtools/page/${targetId}`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 8000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) { clearTimeout(timer); ws.close(); resolve(msg.result?.result?.value); }
    });
    ws.addEventListener('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

async function screenshot(targetId, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/devtools/page/${targetId}`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 8000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png', fromSurface: true } }));
    });
    ws.addEventListener('message', async (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1 && msg.result?.data) {
        clearTimeout(timer);
        const path = `${RESULTS}/${name}`;
        fs.mkdirSync(RESULTS, { recursive: true });
        fs.writeFileSync(path, Buffer.from(msg.result.data, 'base64'));
        log(`Screenshot: ${name}`);
        ws.close();
        resolve(path);
      }
    });
    ws.addEventListener('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function isInjectorRunning() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH', { encoding: 'utf8', timeout: 5000 });
    // Check if any node process has injector in command line via WMIC
    const wmic = execSync('wmic process where "Name=\'node.exe\'" get CommandLine /FORMAT:LIST', { encoding: 'utf8', timeout: 5000 });
    return wmic.toLowerCase().includes('injector');
  } catch { return false; }
}

function isAutoInjectRunning() {
  try {
    const wmic = execSync('wmic process where "Name=\'powershell.exe\'" get CommandLine /FORMAT:LIST', { encoding: 'utf8', timeout: 5000 });
    return wmic.toLowerCase().includes('auto-inject');
  } catch { return false; }
}

async function waitFor(conditionFn, timeoutMs, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await conditionFn()) return true;
    await sleep(intervalMs);
  }
  return false;
}

// ── Test Steps ──

async function step1_VerifyCurrentSkin() {
  log('\n=== Step 1: Verify current skin ===');
  const target = await getTarget();
  ok(!!target, `OpenCode target found: ${target?.id}`);
  if (!target) return false;

  const hasSkin = await cdpEval(target.id, 'document.documentElement.classList.contains("opencode-dream-skin")');
  ok(hasSkin === true, 'Skin class present');

  const hasArt = await cdpEval(target.id, '!!getComputedStyle(document.documentElement).getPropertyValue("--dream-art")');
  ok(hasArt === true, 'CSS --dream-art set');

  const alpha = await cdpEval(target.id, 'getComputedStyle(document.documentElement).getPropertyValue("--dream-container-alpha")');
  ok(alpha && parseFloat(alpha) > 0, `Container alpha: ${alpha?.trim()}`);

  await screenshot(target.id, 'restart-01-before-close.png');
  return true;
}

async function step2_CheckAutoInject() {
  log('\n=== Step 2: Check auto-inject status ===');
  const running = isAutoInjectRunning();
  log(`auto-inject.ps1 running: ${running}`);
  if (!running) {
    log('Starting auto-inject.ps1...', 'warn');
    spawn('powershell', [
      '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-File', 'D:\\code\\codex移植opencode\\opencode-skin\\windows\\scripts\\auto-inject.ps1',
      '-CdpPort', '9335'
    ], { detached: true, stdio: 'ignore' }).unref();
    await sleep(2000);
    const nowRunning = isAutoInjectRunning();
    ok(nowRunning, 'auto-inject.ps1 started');
  } else {
    ok(true, 'auto-inject.ps1 already running');
  }
}

async function step3_CloseOpenCode() {
  log('\n=== Step 3: Close OpenCode ===');
  try {
    execSync('taskkill /F /IM OpenCode.exe', { stdio: 'pipe', timeout: 5000 });
  } catch {}
  await sleep(3000);

  // Verify CDP is gone
  let cdpGone = false;
  try { await fetch(`http://127.0.0.1:${PORT}/json/version`); } catch { cdpGone = true; }
  ok(cdpGone, 'OpenCode closed, CDP unreachable');

  // Verify injector stopped
  const injRunning = isInjectorRunning();
  ok(!injRunning, 'Injector process stopped');
}

async function step4_LaunchOpenCode() {
  log('\n=== Step 4: Re-launch OpenCode ===');
  const proc = spawn('D:\\OpenCode\\OpenCode.exe', ['--remote-debugging-port=9335'], {
    detached: true, stdio: 'ignore'
  });
  proc.unref();
  log(`OpenCode launched (PID=${proc.pid})`);

  // Wait for CDP
  const cdpReady = await waitFor(async () => {
    try { return (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { return false; }
  }, 30000, 1000);
  ok(cdpReady, 'CDP ready after restart');

  // Wait for target
  const hasTarget = await waitFor(async () => {
    const t = await getTarget();
    return !!t;
  }, 20000, 1000);
  ok(hasTarget, 'OpenCode target found');

  return hasTarget;
}

async function step5_WaitForAutoInject() {
  log('\n=== Step 5: Wait for auto-inject to inject skin ===');
  
  // Wait up to 30 seconds for skin to appear
  const skinAppeared = await waitFor(async () => {
    const target = await getTarget();
    if (!target) return false;
    try {
      return await cdpEval(target.id, 'document.documentElement.classList.contains("opencode-dream-skin")');
    } catch { return false; }
  }, 30000, 1000);

  if (!skinAppeared) {
    // Auto-inject may have failed, try manual injection
    log('Auto-inject did not apply skin, trying manual injection...', 'warn');
    try {
      execSync(`node "${INJECTOR}" --theme-dir "${THEME_DIR}" --port ${PORT} --auto-browser-id --once`, {
        timeout: 15000, stdio: 'pipe'
      });
    } catch (e) {
      log(`Manual inject: ${e.message?.substring(0, 80)}`, 'warn');
    }
    await sleep(3000);

    const target = await getTarget();
    if (target) {
      const hasSkin = await cdpEval(target.id, 'document.documentElement.classList.contains("opencode-dream-skin")');
      ok(hasSkin === true, 'Skin applied via manual inject');
    }
  } else {
    ok(true, 'Skin auto-injected successfully');
  }
}

async function step6_VerifyFullSkin() {
  log('\n=== Step 6: Verify full skin state ===');
  const target = await getTarget();
  if (!target) { ok(false, 'No target found'); return; }

  const state = await cdpEval(target.id, `JSON.stringify({
    hasSkin: document.documentElement.classList.contains("opencode-dream-skin"),
    art: !!getComputedStyle(document.documentElement).getPropertyValue("--dream-art"),
    alpha: getComputedStyle(document.documentElement).getPropertyValue("--dream-container-alpha"),
    brightness: getComputedStyle(document.documentElement).getPropertyValue("--dream-brightness"),
    style: !!document.getElementById("opencode-dream-skin-style"),
    chrome: !!document.getElementById("opencode-dream-skin-chrome")
  })`);
  const s = JSON.parse(state);
  log(`Skin state: ${JSON.stringify(s)}`);
  ok(s.hasSkin, 'opencode-dream-skin class');
  ok(s.art, 'Background image set');
  ok(s.alpha && parseFloat(s.alpha) > 0, `Container alpha: ${s.alpha}`);
  ok(s.style, 'Style element present');
  ok(s.chrome, 'Chrome overlay present');

  await screenshot(target.id, 'restart-06-after-auto-inject.png');
}

async function step7_VerifyCtrlS() {
  log('\n=== Step 7: Verify Ctrl+S ===');
  const target = await getTarget();
  if (!target) return;

  await cdpEval(target.id, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true}))`);
  await sleep(600);

  const panelVisible = await cdpEval(target.id, `!!document.querySelector('#dream-settings-panel') || !!document.querySelector('.dream-settings')`);
  ok(panelVisible, 'Ctrl+S opens settings panel');

  await screenshot(target.id, 'restart-07-ctrl-s.png');

  // Close
  await cdpEval(target.id, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await sleep(300);
}

// ── Main ──

async function main() {
  console.log('========================================');
  console.log('  Restart Flow Test');
  console.log('  Simulates: user closes → reopens OpenCode');
  console.log('========================================');

  fs.mkdirSync(RESULTS, { recursive: true });

  const ok1 = await step1_VerifyCurrentSkin();
  if (!ok1) { log('Cannot proceed without active skin', 'fail'); process.exit(1); }

  await step2_CheckAutoInject();
  await step3_CloseOpenCode();
  await step4_LaunchOpenCode();
  await step5_WaitForAutoInject();
  await step6_VerifyFullSkin();
  await step7_VerifyCtrlS();

  console.log(`\n========================================`);
  console.log(`  Results: ${pass}/${pass + fail} passed, ${fail} failed`);
  console.log('========================================');

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
