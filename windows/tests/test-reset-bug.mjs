#!/usr/bin/env node
/**
 * OpenCode-Skin Reset Bug Test
 *
 * 复现：Reset 后 Opacity / Titlebar / Content / Composer 滑块失效
 * 流程：注入皮肤 → 测试滑块正常 → 点 Reset → 再测滑块 → 对比结果
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { spawn, execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function fetchCdp(port, resource) {
  const res = await fetch(`http://127.0.0.1:${port}${resource}`, { redirect: "error" });
  if (!res.ok) throw new Error(`CDP ${resource} returned ${res.status}`);
  return res.json();
}

class CdpSession {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.ws = null; this.nextId = 1; this.pending = new Map(); this.closed = false; }
  open() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.ws?.close(); reject(new Error("WS timeout")); }, 5000);
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("WS failed")); }, { once: true });
      this.ws.addEventListener("message", (e) => {
        const msg = JSON.parse(String(e.data));
        if (msg.id != null && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id); this.pending.delete(msg.id); clearTimeout(p.timeout);
          msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
        }
      });
      this.ws.addEventListener("close", () => { this.closed = true; for (const p of this.pending.values()) { clearTimeout(p.timeout); p.reject(new Error("closed")); } this.pending.clear(); });
    });
  }
  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("closed"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout: ${method}`)); }, 60000);
      this.pending.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`Eval: ${r.exceptionDetails.text || JSON.stringify(r.exceptionDetails)}`);
    return r.result?.value;
  }
  close() { if (!this.closed) try { this.ws?.close(); } catch {} this.closed = true; }
}

async function waitForCdp(port, ms = 30000) {
  const d = Date.now() + ms;
  while (Date.now() < d) { try { await fetchCdp(port, "/json/version"); return true; } catch {} await new Promise(r => setTimeout(r, 500)); }
  return false;
}

async function findTarget(port) {
  for (let i = 0; i < 10; i++) {
    try {
      const targets = await fetchCdp(port, "/json/list");
      const f = targets.find(t => t.type === "page" && t.url?.startsWith("oc://") && t.webSocketDebuggerUrl);
      if (f) return f;
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

async function injectSkin(session) {
  const cssText = await fs.readFile(path.join(ROOT, "assets", "dream-skin.css"), "utf-8");
  const jsText = await fs.readFile(path.join(ROOT, "assets", "renderer-inject.js"), "utf-8");
  const theme = JSON.parse(await fs.readFile(path.join(ROOT, "assets", "theme.json"), "utf-8"));
  const artPath = theme.art?.image || "assets/wallpapers/五条悟.png";
  let artDataUrl = "data:image/png;base64,";
  try { const buf = await fs.readFile(path.join(ROOT, "assets", artPath)); const mime = path.extname(artPath) === ".jpg" ? "image/jpeg" : "image/png"; artDataUrl = `data:${mime};base64,${buf.toString("base64")}`; } catch {}
  let preparedJs = jsText.replace('"__DREAM_CSS_JSON__"', JSON.stringify(cssText)).replace("'__DREAM_ART_JSON__'", JSON.stringify(artDataUrl)).replace("__DREAM_THEME_JSON__", JSON.stringify(theme));
  await session.evaluate(`(function(){ var s=document.getElementById('opencode-dream-skin-style'); if(!s){s=document.createElement('style');s.id='opencode-dream-skin-style';(document.head||document.documentElement).appendChild(s);} s.textContent=${JSON.stringify(cssText)}; return true; })()`);
  await session.evaluate(`(function(){ ${preparedJs}; return true; })()`);
}

// ── Test one slider: set value, check CSS var change ──
async function testSlider(session, key, fromVal, toVal, cssVar) {
  // Set slider value
  await session.evaluate(`
    (function() {
      var s = document.querySelector('.dream-slider[data-key="${key}"]');
      if (!s) return false;
      s.value = ${fromVal};
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `);
  await new Promise(r => setTimeout(r, 150));

  // Read CSS var
  const valBefore = await session.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('${cssVar}').trim()`);

  // Set to new value
  await session.evaluate(`
    (function() {
      var s = document.querySelector('.dream-slider[data-key="${key}"]');
      if (!s) return false;
      s.value = ${toVal};
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `);
  await new Promise(r => setTimeout(r, 150));

  const valAfter = await session.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('${cssVar}').trim()`);
  const changed = valBefore !== valAfter;
  return { key, cssVar, valBefore, valAfter, changed };
}

// ── Read all CSS vars ──
async function readAllVars(session) {
  return JSON.parse(await session.evaluate(`
    (function() {
      var cs = getComputedStyle(document.documentElement);
      return JSON.stringify({
        containerAlpha: cs.getPropertyValue('--dream-container-alpha').trim(),
        titlebarAlpha: cs.getPropertyValue('--dream-titlebar-alpha').trim(),
        contentAlpha: cs.getPropertyValue('--dream-content-alpha').trim(),
        composerAlpha: cs.getPropertyValue('--dream-composer-alpha').trim(),
        blur: cs.getPropertyValue('--dream-blur').trim(),
        brightness: cs.getPropertyValue('--dream-brightness').trim(),
      });
    })()
  `));
}

// ── Click Reset button ──
async function clickReset(session) {
  await session.evaluate(`
    (function() {
      var btn = document.querySelector('#dream-reset');
      if (btn) { btn.click(); return true; }
      return false;
    })()
  `);
  await new Promise(r => setTimeout(r, 500));
}

// ── Read slider DOM values ──
async function readSliderValues(session) {
  return JSON.parse(await session.evaluate(`
    (function() {
      var result = {};
      document.querySelectorAll('.dream-slider').forEach(function(s) {
        var key = s.getAttribute('data-key');
        result[key] = s.value;
      });
      return JSON.stringify(result);
    })()
  `));
}

async function main() {
  const PORT = 9335;
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  Reset Bug Test: sliders broken after Reset`);
  console.log(`${"═".repeat(70)}\n`);

  // Start & connect
  try { execSync("taskkill /F /IM OpenCode.exe 2>nul", { stdio: "ignore" }); } catch {}
  await new Promise(r => setTimeout(r, 1000));
  const proc = spawn("D:\\OpenCode\\OpenCode.exe", [`--remote-debugging-port=${PORT}`], { detached: true, stdio: "ignore" });
  proc.unref();
  if (!await waitForCdp(PORT)) { console.error("CDP timeout"); return; }
  await new Promise(r => setTimeout(r, 3000));
  const target = await findTarget(PORT);
  if (!target) { console.error("No target"); return; }
  const session = new CdpSession(target.webSocketDebuggerUrl);
  await session.open();
  console.log(`Connected: ${target.id.slice(0, 12)}\n`);

  // Inject
  await injectSkin(session);
  console.log("Skin injected\n");

  // Open panel
  await session.evaluate(`document.getElementById('dream-settings-panel')?.classList.remove('hidden')`);
  await new Promise(r => setTimeout(r, 300));

  // ── Sliders to test ──
  const testSliders = [
    { key: "containerAlpha", cssVar: "--dream-container-alpha", from: 65, to: 20, label: "Opacity" },
    { key: "titlebarAlpha", cssVar: "--dream-titlebar-alpha", from: 75, to: 20, label: "Titlebar" },
    { key: "contentAlpha", cssVar: "--dream-content-alpha", from: 70, to: 20, label: "Content" },
    { key: "composerAlpha", cssVar: "--dream-composer-alpha", from: 80, to: 20, label: "Composer" },
    { key: "blur", cssVar: "--dream-blur", from: 3, to: 15, label: "Blur" },
    { key: "brightness", cssVar: "--dream-brightness", from: 100, to: 150, label: "Brightness" },
  ];

  // ══════════════════════════════════════════════════════════
  // Phase 1: Test sliders BEFORE reset (should all work)
  // ══════════════════════════════════════════════════════════
  console.log("═".repeat(70));
  console.log("  PHASE 1: Sliders BEFORE Reset (baseline)");
  console.log("═".repeat(70));

  const beforeResults = [];
  for (const s of testSliders) {
    const r = await testSlider(session, s.key, s.from, s.to, s.cssVar);
    beforeResults.push({ ...r, label: s.label });
    console.log(`  ${r.changed ? "✅" : "❌"} ${s.label.padEnd(15)} ${r.valBefore} → ${r.valAfter}`);
  }

  // ══════════════════════════════════════════════════════════
  // Phase 2: Click Reset
  // ══════════════════════════════════════════════════════════
  console.log(`\n${"─".repeat(70)}`);
  console.log("  Clicking RESET...");
  console.log("─".repeat(70));

  const varsBeforeReset = await readAllVars(session);
  console.log(`  CSS vars BEFORE reset: ${JSON.stringify(varsBeforeReset)}`);

  const slidersBeforeReset = await readSliderValues(session);
  console.log(`  Slider DOM BEFORE reset: ${JSON.stringify(slidersBeforeReset)}`);

  await clickReset(session);

  const varsAfterReset = await readAllVars(session);
  console.log(`  CSS vars AFTER reset:  ${JSON.stringify(varsAfterReset)}`);

  const slidersAfterReset = await readSliderValues(session);
  console.log(`  Slider DOM AFTER reset:  ${JSON.stringify(slidersAfterReset)}`);

  // ══════════════════════════════════════════════════════════
  // Phase 3: Test sliders AFTER reset (should all work)
  // ══════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(70)}`);
  console.log("  PHASE 2: Sliders AFTER Reset (testing for bug)");
  console.log("═".repeat(70));

  const afterResults = [];
  for (const s of testSliders) {
    const r = await testSlider(session, s.key, s.from, s.to, s.cssVar);
    afterResults.push({ ...r, label: s.label });
    console.log(`  ${r.changed ? "✅" : "❌"} ${s.label.padEnd(15)} ${r.valBefore} → ${r.valAfter}`);
  }

  // ══════════════════════════════════════════════════════════
  // Phase 4: Check if settings object is in sync
  // ══════════════════════════════════════════════════════════
  console.log(`\n${"─".repeat(70)}`);
  console.log("  Checking JS state object...");
  console.log("─".repeat(70));

  const jsState = JSON.parse(await session.evaluate(`
    JSON.stringify({
      settings: window.__OPENCODE_DREAM_SKIN_STATE__?.settings,
      hasApplySettings: typeof window.__OPENCODE_DREAM_SKIN_STATE__?.applySettings === 'function',
    })
  `));
  console.log(`  settings.containerAlpha: ${jsState.settings?.containerAlpha}`);
  console.log(`  settings.titlebarAlpha: ${jsState.settings?.titlebarAlpha}`);
  console.log(`  settings.contentAlpha: ${jsState.settings?.contentAlpha}`);
  console.log(`  settings.composerAlpha: ${jsState.settings?.composerAlpha}`);
  console.log(`  hasApplySettings: ${jsState.hasApplySettings}`);

  // Try calling applySettings directly
  console.log("\n  Manually calling applySettings()...");
  await session.evaluate(`window.__OPENCODE_DREAM_SKIN_STATE__?.applySettings()`);
  await new Promise(r => setTimeout(r, 200));

  const varsAfterManual = await readAllVars(session);
  console.log(`  CSS vars after manual apply: ${JSON.stringify(varsAfterManual)}`);

  // ══════════════════════════════════════════════════════════
  // Report
  // ══════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(70)}`);
  console.log("  BUG REPORT");
  console.log("═".repeat(70));

  const beforePassed = beforeResults.filter(r => r.changed).length;
  const afterPassed = afterResults.filter(r => r.changed).length;
  console.log(`\n  Before reset: ${beforePassed}/${beforeResults.length} sliders work`);
  console.log(`  After reset:  ${afterPassed}/${afterResults.length} sliders work`);

  for (let i = 0; i < testSliders.length; i++) {
    const b = beforeResults[i];
    const a = afterResults[i];
    if (b.changed && !a.changed) {
      console.log(`\n  ❌ BUG: ${b.label} works before reset but BROKEN after reset`);
      console.log(`     Before: ${b.valBefore} → ${b.valAfter}`);
      console.log(`     After:  ${a.valBefore} → ${a.valAfter}`);
    }
  }

  console.log(`\n${"═".repeat(70)}\n`);

  session.close();
  try { execSync("taskkill /F /IM OpenCode.exe 2>nul", { stdio: "ignore" }); } catch {}
}

main().catch(e => { console.error("Fatal:", e); process.exit(2); });
