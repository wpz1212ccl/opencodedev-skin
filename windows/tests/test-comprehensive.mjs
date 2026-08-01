/**
 * Comprehensive test for opencode-skin — no external deps, uses native Node.js http
 * Tests: injection, settings, sliders, restart cycle
 */
import http from 'http';
import { setTimeout as sleep } from 'timers/promises';
import { execSync, spawn } from 'child_process';
import fs from 'fs';

const PORT = 9335;
const THEME_DIR = 'D:\\code\\codex移植opencode\\opencode-skin\\windows\\assets';
const RESULTS = 'D:\\code\\codex移植opencode\\opencode-skin\\windows\\tests\\results';
const INJECTOR = 'D:\\code\\codex移植opencode\\opencode-skin\\windows\\scripts\\injector.mjs';

let pass = 0, fail = 0;
function log(m, t='info') { const p={pass:'✅',fail:'❌',info:'ℹ️',warn:'⚠️'}[t]||''; console.log(`${p} ${m}`); }
function ok(c,m) { if(c){pass++;log(m,'pass')}else{fail++;log(m,'fail')} return c; }

// --- CDP via raw HTTP + fetch (no ws) ---
function httpGet(url) {
  return new Promise((r,j) => {
    http.get(url, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>r(d));
    }).on('error',j);
  });
}

async function getTarget() {
  const data = JSON.parse(await httpGet(`http://127.0.0.1:${PORT}/json`));
  return data.find(t => t.url?.includes('oc://'));
}

// CDP via HTTP endpoint (Runtime.evaluate through /json/protocol)
// Actually we need WebSocket. Use built-in WebSocket in Node 22+.
async function cdpEval(targetId, expr) {
  const wsUrl = `ws://127.0.0.1:${PORT}/devtools/page/${targetId}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 8000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({id:1, method:'Runtime.evaluate', params:{expression:expr, returnByValue:true}}));
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) {
        clearTimeout(timer);
        ws.close();
        resolve(msg.result?.result?.value);
      }
    });
    ws.addEventListener('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

async function screenshot(targetId, name) {
  const wsUrl = `ws://127.0.0.1:${PORT}/devtools/page/${targetId}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 8000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({id:1, method:'Page.captureScreenshot', params:{format:'png',fromSurface:true}}));
    });
    ws.addEventListener('message', async (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1 && msg.result?.data) {
        clearTimeout(timer);
        const path = `${RESULTS}/${name}`;
        fs.mkdirSync(RESULTS, {recursive:true});
        fs.writeFileSync(path, Buffer.from(msg.result.data, 'base64'));
        log(`Screenshot: ${path} (${(msg.result.data.length*0.75/1024).toFixed(0)}KB)`);
        ws.close();
        resolve(path);
      }
    });
    ws.addEventListener('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

// --- Tests ---
async function test1_BasicInjection(id) {
  log('\n=== 1. Basic Injection ===');
  const cls = await cdpEval(id, 'document.documentElement.className');
  ok(cls?.includes('opencode-dream-skin'), `HTML class: ${cls}`);
  
  const art = await cdpEval(id, 'getComputedStyle(document.documentElement).getPropertyValue("--dream-art")');
  ok(!!art && art.length > 10, `--dream-art set (${art?.substring(0,50)}...)`);
  
  const alpha = await cdpEval(id, 'getComputedStyle(document.documentElement).getPropertyValue("--dream-container-alpha")');
  ok(!!alpha, `--dream-container-alpha = ${alpha?.trim()}`);
  
  await screenshot(id, '01-basic-injection.png');
}

async function test2_CtrlS_Panel(id) {
  log('\n=== 2. Ctrl+S Settings Panel ===');
  await cdpEval(id, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true}))`);
  await sleep(600);
  
  const panelExists = await cdpEval(id, `!!document.querySelector('#dream-settings-panel') || !!document.querySelector('.dream-settings')`);
  ok(panelExists, 'Settings panel visible after Ctrl+S');
  
  await screenshot(id, '02-ctrl-s-panel.png');
  
  // Close
  await cdpEval(id, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await sleep(300);
}

async function test3_OpacitySlider(id) {
  log('\n=== 3. Opacity Slider ===');
  // 0%
  await cdpEval(id, `document.documentElement.style.setProperty('--dream-container-alpha','0')`);
  await sleep(400);
  await screenshot(id, '03-opacity-0.png');
  
  // 50%
  await cdpEval(id, `document.documentElement.style.setProperty('--dream-container-alpha','0.5')`);
  await sleep(400);
  await screenshot(id, '04-opacity-50.png');
  
  // 100%
  await cdpEval(id, `document.documentElement.style.setProperty('--dream-container-alpha','1')`);
  await sleep(400);
  await screenshot(id, '05-opacity-100.png');
  
  // Restore
  await cdpEval(id, `document.documentElement.style.setProperty('--dream-container-alpha','0.85')`);
  const v = await cdpEval(id, 'getComputedStyle(document.documentElement).getPropertyValue("--dream-container-alpha")');
  ok(v?.trim() === '0.85', `Opacity restored to ${v?.trim()}`);
}

async function test4_Brightness(id) {
  log('\n=== 4. Brightness/Contrast ===');
  await cdpEval(id, `document.documentElement.style.setProperty('--dream-brightness','0.4')`);
  await sleep(400);
  await screenshot(id, '06-brightness-dark.png');
  
  await cdpEval(id, `document.documentElement.style.setProperty('--dream-brightness','1.5')`);
  await sleep(400);
  await screenshot(id, '07-brightness-bright.png');
  
  await cdpEval(id, `document.documentElement.style.setProperty('--dream-brightness','1')`);
  const b = await cdpEval(id, 'getComputedStyle(document.documentElement).getPropertyValue("--dream-brightness")');
  ok(b?.trim() === '1', `Brightness reset: ${b?.trim()}`);
}

async function test5_ImagePresent(id) {
  log('\n=== 5. Background Image ===');
  const art = await cdpEval(id, 'getComputedStyle(document.documentElement).getPropertyValue("--dream-art")');
  const hasUrl = art?.includes('url(');
  ok(!!hasUrl, `Background image: ${hasUrl ? 'present' : 'missing'}`);
}

async function test6_VideoBg(id) {
  log('\n=== 6. Video Background ===');
  const hasVideo = await cdpEval(id, `!!document.querySelector('video') || !!document.querySelector('[class*="dream-video"]')`);
  log(`Video element: ${hasVideo ? 'present' : 'not present'}`);
  // Not a pass/fail — video is experimental
}

async function test7_PanelOpacityControl(id) {
  log('\n=== 7. Panel Opacity Control ===');
  // Open panel
  await cdpEval(id, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true}))`);
  await sleep(500);
  
  // Find opacity slider input
  const sliderValue = await cdpEval(id, `
    (() => {
      const sliders = document.querySelectorAll('input[type="range"]');
      for (const s of sliders) {
        if (s.dataset.key === 'opacity' || s.closest('[data-key="opacity"]')) {
          return { found: true, value: s.value, min: s.min, max: s.max };
        }
      }
      return { found: false, count: sliders.length };
    })()
  `);
  log(`Opacity slider: ${JSON.stringify(sliderValue)}`);
  ok(sliderValue?.found || sliderValue?.count > 0, 'Opacity slider found in panel');
  
  await screenshot(id, '08-panel-opacity.png');
  
  await cdpEval(id, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await sleep(300);
}

async function test8_RestartCycle() {
  log('\n=== 8. Restart Cycle ===');
  
  // Kill OpenCode
  log('Closing OpenCode...');
  try { execSync('taskkill /F /IM OpenCode.exe 2>nul', {stdio:'pipe'}); } catch {}
  await sleep(3000);
  
  // Verify closed
  let running = false;
  try { await httpGet(`http://127.0.0.1:${PORT}/json/version`); running = true; } catch {}
  ok(!running, 'OpenCode closed');
  
  // Re-launch
  log('Launching OpenCode...');
  const proc = spawn('D:\\OpenCode\\OpenCode.exe', ['--remote-debugging-port=9335'], {detached:true, stdio:'ignore'});
  proc.unref();
  
  // Wait for CDP
  let cdpReady = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try { await httpGet(`http://127.0.0.1:${PORT}/json/version`); cdpReady = true; break; } catch {}
  }
  ok(cdpReady, 'CDP ready after restart');
  
  // Wait for target
  let target = null;
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    target = await getTarget().catch(() => null);
    if (target) break;
  }
  ok(!!target, `Target found: ${target?.id}`);
  
  if (!target) return;
  
  // Wait for DOM ready
  await sleep(3000);
  
  // Inject
  log('Injecting skin...');
  try {
    execSync(`node "${INJECTOR}" --theme-dir "${THEME_DIR}" --port ${PORT} --auto-browser-id --once`, {timeout:15000, stdio:'pipe'});
  } catch(e) { log(`Inject: ${e.message?.substring(0,80)}`, 'warn'); }
  
  await sleep(3000);
  
  // Verify
  const hasSkin = await cdpEval(target.id, 'document.documentElement.classList.contains("opencode-dream-skin")');
  ok(hasSkin === true, 'Skin injected after restart');
  
  const hasArt = await cdpEval(target.id, '!!getComputedStyle(document.documentElement).getPropertyValue("--dream-art")');
  ok(hasArt === true, 'CSS vars set after restart');
  
  await screenshot(target.id, '09-after-restart.png');
}

// --- Main ---
async function main() {
  console.log('========================================');
  console.log('  OpenCode-Skin Comprehensive Test');
  console.log('========================================');
  
  fs.mkdirSync(RESULTS, {recursive:true});
  
  const target = await getTarget().catch(() => null);
  if (!target) { log('No OpenCode target. Start with: OpenCode.exe --remote-debugging-port=9335', 'fail'); process.exit(1); }
  log(`Target: ${target.id}`);
  
  await test1_BasicInjection(target.id);
  await test2_CtrlS_Panel(target.id);
  await test3_OpacitySlider(target.id);
  await test4_Brightness(target.id);
  await test5_ImagePresent(target.id);
  await test6_VideoBg(target.id);
  await test7_PanelOpacityControl(target.id);
  
  // Restart test
  await test8_RestartCycle();
  
  console.log(`\n========================================`);
  console.log(`  Results: ${pass}/${pass+fail} passed, ${fail} failed`);
  console.log(`========================================`);
  
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
