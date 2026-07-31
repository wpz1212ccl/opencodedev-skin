/**
 * OpenCode-Skin 实时监控脚本
 * 
 * 功能：
 * 1. 监控 OpenCode 进程启动
 * 2. 监控 CDP 端口就绪
 * 3. 监控目标页面出现
 * 4. 监控皮肤注入过程
 * 5. 监控背景图片加载
 * 6. 记录每步耗时
 * 7. 自动截图关键节点
 * 
 * 用法：node monitor.mjs
 * 说"开始"后，用户关闭并重启 OpenCode
 */

import { execSync, spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import fs from 'fs';
import path from 'path';

const PORT = 9335;
const RESULTS = 'D:\\code\\codex移植opencode\\opencode-skin\\windows\\tests\\results';
const LOG_FILE = `${RESULTS}/monitor-log.txt`;

let stepNum = 0;
const timings = [];

fs.mkdirSync(RESULTS, { recursive: true });

function ts() {
  return new Date().toISOString().replace('T', ' ').substring(0, 23);
}

function log(msg, level = 'INFO') {
  const line = `[${ts()}] [${level}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function step(name) {
  stepNum++;
  const s = { num: stepNum, name, start: Date.now(), end: null, duration: null, status: 'running', details: '' };
  timings.push(s);
  log(`═══ Step ${stepNum}: ${name} ═══`);
  return s;
}

function done(s, status = 'OK', details = '') {
  s.end = Date.now();
  s.duration = s.end - s.start;
  s.status = status;
  s.details = details;
  log(`  → ${status} (${s.duration}ms) ${details}`);
}

// ── CDP helpers ──

async function httpGet(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function getTargets() {
  const res = await httpGet(`http://127.0.0.1:${PORT}/json`);
  if (!res || !res.ok) return [];
  return await res.json();
}

async function getOpenCodeTarget() {
  const targets = await getTargets();
  return targets.find(t => t.url?.includes('oc://'));
}

async function cdpEval(targetId, expr) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/devtools/page/${targetId}`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('cdp timeout')); }, 8000);
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
    const timer = setTimeout(() => { ws.close(); reject(new Error('screenshot timeout')); }, 8000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png', fromSurface: true } }));
    });
    ws.addEventListener('message', async (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1 && msg.result?.data) {
        clearTimeout(timer);
        const filePath = `${RESULTS}/${name}`;
        fs.writeFileSync(filePath, Buffer.from(msg.result.data, 'base64'));
        log(`  📸 Screenshot: ${name} (${(msg.result.data.length * 0.75 / 1024).toFixed(0)}KB)`);
        ws.close();
        resolve(filePath);
      }
    });
    ws.addEventListener('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

// ── Process monitoring ──

function isProcessRunning(name) {
  try {
    const out = execSync(`tasklist /FI "IMAGENAME eq ${name}" /FO CSV /NH`, { encoding: 'utf8', timeout: 3000 });
    return out.includes(name);
  } catch { return false; }
}

function getOpenCodeProcesses() {
  try {
    const out = execSync('powershell -NoProfile -Command "Get-Process OpenCode -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }"', { encoding: 'utf8', timeout: 5000 });
    return out.split('\n').map(s => parseInt(s.trim())).filter(n => n > 0);
  } catch { return []; }
}

function getNodeProcesses() {
  try {
    const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" -ErrorAction SilentlyContinue | ForEach-Object { \\"$($_.ProcessId)|$($_.CommandLine)\\" }"', { encoding: 'utf8', timeout: 5000 });
    return out.split('\n').filter(s => s.includes('|')).map(s => {
      const [pid, ...rest] = s.split('|');
      return { pid: parseInt(pid), cmd: rest.join('|') };
    }).filter(p => p.pid > 0);
  } catch { return []; }
}

function findInjectorPid() {
  return getNodeProcesses().filter(p => p.cmd.includes('injector')).map(p => p.pid);
}

function findImageServerPid() {
  return getNodeProcesses().filter(p => p.cmd.includes('image-server')).map(p => p.pid);
}

// ── Monitor phases ──

async function monitorOpenCodeStart() {
  log('\n🔍 Waiting for OpenCode to start...');
  log('   (Please double-click the OpenCode desktop icon now)');

  // Phase 1: Wait for process
  const s1 = step('OpenCode process appears');
  let found = false;
  for (let i = 0; i < 60; i++) {
    const pids = getOpenCodeProcesses();
    if (pids.length > 0) {
      done(s1, 'OK', `PID: ${pids.join(', ')}`);
      found = true;
      break;
    }
    await sleep(500);
  }
  if (!found) {
    done(s1, 'FAIL', 'Timeout waiting for OpenCode process');
    return false;
  }

  // Phase 2: Wait for CDP
  const s2 = step('CDP port 9335 ready');
  let cdpReady = false;
  for (let i = 0; i < 60; i++) {
    const res = await httpGet(`http://127.0.0.1:${PORT}/json/version`);
    if (res && res.ok) {
      const ver = await res.json();
      done(s2, 'OK', `Browser: ${ver.Browser}`);
      cdpReady = true;
      break;
    }
    await sleep(500);
  }
  if (!cdpReady) {
    done(s2, 'FAIL', 'CDP port not ready after 30s');
    return false;
  }

  // Phase 3: Wait for target
  const s3 = step('OpenCode target page appears');
  let target = null;
  for (let i = 0; i < 60; i++) {
    target = await getOpenCodeTarget();
    if (target) {
      done(s3, 'OK', `Target: ${target.id}`);
      break;
    }
    await sleep(500);
  }
  if (!target) {
    done(s3, 'FAIL', 'No oc:// target found');
    return false;
  }

  return target;
}

async function monitorAutoInjection(target) {
  // Phase 4: Wait for skin class
  const s4 = step('Skin class opencode-dream-skin appears');
  let hasSkin = false;
  for (let i = 0; i < 60; i++) {
    try {
      hasSkin = await cdpEval(target.id, 'document.documentElement.classList.contains("opencode-dream-skin")');
      if (hasSkin) {
        done(s4, 'OK');
        break;
      }
    } catch {}
    await sleep(500);
  }
  if (!hasSkin) {
    done(s4, 'FAIL', 'Skin class not found after 30s');
    // Try manual inject
    log('  ⚠️ Auto-inject failed, trying manual inject...');
    try {
      execSync(`node "D:\\code\\codex移植opencode\\opencode-skin\\windows\\scripts\\injector.mjs" --theme-dir "D:\\code\\codex移植opencode\\opencode-skin\\windows\\assets" --port ${PORT} --auto-browser-id --once`, {
        timeout: 15000, stdio: 'pipe'
      });
      await sleep(3000);
      hasSkin = await cdpEval(target.id, 'document.documentElement.classList.contains("opencode-dream-skin")');
      if (hasSkin) {
        done(s4, 'OK (manual)', 'Injected manually after auto-inject failed');
      }
    } catch (e) {
      done(s4, 'FAIL', `Manual inject also failed: ${e.message?.substring(0, 60)}`);
    }
  }

  // Phase 5: CSS variables
  const s5 = step('CSS variables set');
  try {
    const vars = await cdpEval(target.id, `JSON.stringify({
      art: getComputedStyle(document.documentElement).getPropertyValue('--dream-art').substring(0, 60),
      alpha: getComputedStyle(document.documentElement).getPropertyValue('--dream-container-alpha'),
      brightness: getComputedStyle(document.documentElement).getPropertyValue('--dream-brightness'),
      style: !!document.getElementById('opencode-dream-skin-style'),
      chrome: !!document.getElementById('opencode-dream-skin-chrome')
    })`);
    const v = JSON.parse(vars);
    const allSet = v.art && v.alpha && parseFloat(v.alpha) > 0;
    done(s5, allSet ? 'OK' : 'WARN', `art=${v.art?.substring(0, 30)} alpha=${v.alpha} style=${v.style} chrome=${v.chrome}`);

    // Screenshot
    await screenshot(target.id, `monitor-${stepNum}-skin-vars.png`);
  } catch (e) {
    done(s5, 'FAIL', e.message?.substring(0, 60));
  }

  // Phase 6: Background image loaded
  const s6 = step('Background image loaded');
  try {
    const imgStatus = await cdpEval(target.id, `JSON.stringify({
      artVar: getComputedStyle(document.documentElement).getPropertyValue('--dream-art').substring(0, 80),
      bgImage: getComputedStyle(document.documentElement).backgroundImage.substring(0, 80),
      hasVideo: !!document.querySelector('video'),
      rootBg: getComputedStyle(document.querySelector('#root > div:first-child')).backgroundColor
    })`);
    const img = JSON.parse(imgStatus);
    const loaded = img.artVar.includes('url(');
    done(s6, loaded ? 'OK' : 'WARN', `art=${img.artVar.substring(0, 40)} bg=${img.bgImage.substring(0, 40)}`);

    await screenshot(target.id, `monitor-${stepNum}-bg-image.png`);
  } catch (e) {
    done(s6, 'FAIL', e.message?.substring(0, 60));
  }

  // Phase 7: Ctrl+S
  const s7 = step('Ctrl+S settings panel');
  try {
    await cdpEval(target.id, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true}))`);
    await sleep(600);
    const panelVisible = await cdpEval(target.id, `!!document.querySelector('#dream-settings-panel') || !!document.querySelector('.dream-settings')`);
    done(s7, panelVisible ? 'OK' : 'WARN', `Panel visible: ${panelVisible}`);
    await screenshot(target.id, `monitor-${stepNum}-ctrl-s.png`);

    // Close panel
    await cdpEval(target.id, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await sleep(300);
  } catch (e) {
    done(s7, 'FAIL', e.message?.substring(0, 60));
  }

  // Final screenshot
  await screenshot(target.id, `monitor-final.png`);
}

// ── Main ──

async function main() {
  // Clear log
  fs.writeFileSync(LOG_FILE, '');

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   OpenCode-Skin 实时监控                        ║');
  console.log('║                                                ║');
  console.log('║   10秒倒计时后开始监控                          ║');
  console.log('║   请先关闭 OpenCode，然后双击图标重新打开        ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  for (let i = 10; i > 0; i--) {
    console.log(`  ${i}秒后开始监控...`);
    await sleep(1000);
  }

  log('═══════════════════════════════════════════════');
  log('  监控开始 — 请关闭并重启 OpenCode');
  log('═══════════════════════════════════════════════');

  // Check if OpenCode is currently running
  const currentlyRunning = getOpenCodeProcesses().length > 0;
  if (currentlyRunning) {
    log('OpenCode is currently running. Waiting for it to close...');
    for (let i = 0; i < 120; i++) {
      if (getOpenCodeProcesses().length === 0) {
        log('OpenCode closed.');
        break;
      }
      await sleep(500);
    }
    await sleep(2000);
  }

  // Monitor the restart
  const target = await monitorOpenCodeStart();
  if (!target) {
    log('\n❌ Failed: OpenCode did not start properly', 'ERROR');
    printReport();
    process.exit(1);
  }

  await monitorAutoInjection(target);
  printReport();
  process.exit(0);
}

function printReport() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║              监控报告                            ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  let totalStart = Infinity, totalEnd = 0;
  for (const t of timings) {
    if (t.start < totalStart) totalStart = t.start;
    if (t.end > totalEnd) totalEnd = t.end;
    const status = t.status === 'OK' || t.status === 'OK (manual)' ? '✅' : t.status === 'WARN' ? '⚠️' : '❌';
    console.log(`  ${status} Step ${t.num}: ${t.name} — ${t.duration}ms (${t.status})`);
    if (t.details) console.log(`     ${t.details}`);
  }

  console.log('');
  console.log(`  Total time: ${totalEnd - totalStart}ms`);
  console.log(`  Steps: ${timings.filter(t => t.status === 'OK' || t.status === 'OK (manual)').length}/${timings.length} passed`);

  // Write JSON report
  const report = {
    timestamp: ts(),
    timings: timings.map(t => ({
      step: t.num,
      name: t.name,
      durationMs: t.duration,
      status: t.status,
      details: t.details
    })),
    totalMs: totalEnd - totalStart,
    passed: timings.filter(t => t.status === 'OK' || t.status === 'OK (manual)').length,
    total: timings.length
  };
  fs.writeFileSync(`${RESULTS}/monitor-report.json`, JSON.stringify(report, null, 2));
  console.log(`\n  Report saved: ${RESULTS}/monitor-report.json`);
  console.log(`  Full log: ${LOG_FILE}`);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
