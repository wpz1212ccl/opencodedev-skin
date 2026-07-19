#!/usr/bin/env node
/**
 * Opacity Slider Home Page Test
 *
 * 精确复现用户场景：首页 → 拖 opacity → 截图对比 → 重启 → 再测
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { spawn, execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 9335;

async function fetchCdp(port, r) { const res = await fetch(`http://127.0.0.1:${port}${r}`); if (!res.ok) throw new Error(`${r} ${res.status}`); return res.json(); }

class Cdp {
  constructor(u) { this.u = u; this.ws = null; this.id = 1; this.p = new Map(); this.closed = false; }
  open() { return new Promise((ok, no) => { const t = setTimeout(() => no(new Error("ws timeout")), 5000); this.ws = new WebSocket(this.u); this.ws.addEventListener("open", () => { clearTimeout(t); ok(); }, { once: true }); this.ws.addEventListener("error", () => { clearTimeout(t); no(new Error("ws failed")); }, { once: true }); this.ws.addEventListener("message", e => { const m = JSON.parse(String(e.data)); if (m.id != null && this.p.has(m.id)) { const p = this.p.get(m.id); this.p.delete(m.id); clearTimeout(p.t); m.error ? p.n(new Error(m.error.message)) : p.ok(m.result); } }); this.ws.addEventListener("close", () => { this.closed = true; for (const p of this.p.values()) { clearTimeout(p.t); p.n(new Error("closed")); } this.p.clear(); }); }); }
  send(m, pa = {}) { if (this.closed) return Promise.reject(new Error("closed")); return new Promise((ok, no) => { const id = this.id++; const t = setTimeout(() => { this.p.delete(id); no(new Error(`timeout: ${m}`)); }, 60000); this.p.set(id, { ok, no, t }); this.ws.send(JSON.stringify({ id, method: m, params: pa })); }); }
  async eval(expr) { const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(`Eval: ${r.exceptionDetails.text || JSON.stringify(r.exceptionDetails)}`); return r.result?.value; }
  async screenshot(p) { const r = await this.send("Page.captureScreenshot", { format: "png", fromSurface: true }); await fs.writeFile(p, Buffer.from(r.data, "base64")); }
  close() { if (!this.closed) try { this.ws?.close(); } catch {} this.closed = true; }
}

async function waitCdp(port, ms = 30000) { const d = Date.now() + ms; while (Date.now() < d) { try { await fetchCdp(port, "/json/version"); return true; } catch {} await new Promise(r => setTimeout(r, 500)); } return false; }

async function findTarget(port) {
  for (let i = 0; i < 10; i++) {
    try { const t = await fetchCdp(port, "/json/list"); const f = t.find(x => x.type === "page" && x.url?.startsWith("oc://") && x.webSocketDebuggerUrl); if (f) return f; } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

function killOC() { try { execSync("taskkill /F /IM OpenCode.exe 2>nul", { stdio: "ignore" }); } catch {} }

async function injectSkin(cdp) {
  const css = await fs.readFile(path.join(ROOT, "assets", "dream-skin.css"), "utf-8");
  const js = await fs.readFile(path.join(ROOT, "assets", "renderer-inject.js"), "utf-8");
  const theme = JSON.parse(await fs.readFile(path.join(ROOT, "assets", "theme.json"), "utf-8"));
  const artPath = theme.art?.image || "assets/wallpapers/五条悟.png";
  let artUrl = "data:image/png;base64,";
  try { const b = await fs.readFile(path.join(ROOT, "assets", artPath)); artUrl = `data:${path.extname(artPath) === ".jpg" ? "image/jpeg" : "image/png"};base64,${b.toString("base64")}`; } catch {}
  let pJs = js.replace('"__DREAM_CSS_JSON__"', JSON.stringify(css)).replace("'__DREAM_ART_JSON__'", JSON.stringify(artUrl)).replace("__DREAM_THEME_JSON__", JSON.stringify(theme));
  await cdp.eval(`(function(){var s=document.getElementById('opencode-dream-skin-style');if(!s){s=document.createElement('style');s.id='opencode-dream-skin-style';(document.head||document.documentElement).appendChild(s);}s.textContent=${JSON.stringify(css)};return true;})()`);
  await cdp.eval(`(function(){${pJs};return true;})()`);
}

// Get detailed state of opacity-related elements
async function getOpacityState(cdp) {
  return JSON.parse(await cdp.eval(`
    (function() {
      var root = document.documentElement;
      var mainEl = document.querySelector('#root > div:first-child');
      var cs = mainEl ? getComputedStyle(mainEl) : null;
      var rootCs = getComputedStyle(root);
      return JSON.stringify({
        // Page state
        isHome: !!document.querySelector('[data-component="session-new-design"]'),
        hasDreamHome: mainEl ? mainEl.classList.contains('dream-home') : false,
        hasActiveHome: root.classList.contains('dream-active-home'),
        // CSS variable
        containerAlpha: rootCs.getPropertyValue('--dream-container-alpha').trim(),
        // Computed style of main container
        mainBgColor: cs ? cs.backgroundColor : 'N/A',
        mainDisplay: cs ? cs.display : 'N/A',
        mainOpacity: cs ? cs.opacity : 'N/A',
        // Slider state
        sliderValue: document.querySelector('.dream-slider[data-key="containerAlpha"]')?.value || 'N/A',
        // Settings object
        settingsAlpha: window.__OPENCODE_DREAM_SKIN_STATE__?.settings?.containerAlpha ?? 'N/A',
        // CSS variable on root inline style
        inlineAlpha: root.style.getPropertyValue('--dream-container-alpha') || 'N/A',
      });
    })()
  `));
}

// Set opacity via slider and dispatch events
async function setOpacity(cdp, value) {
  await cdp.eval(`
    (function() {
      var s = document.querySelector('.dream-slider[data-key="containerAlpha"]');
      if (!s) return false;
      s.value = ${value};
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `);
  await new Promise(r => setTimeout(r, 300)); // wait for rAF
}

// Set opacity directly via JS (bypass slider)
async function setOpacityDirect(cdp, value) {
  await cdp.eval(`
    (function() {
      var state = window.__OPENCODE_DREAM_SKIN_STATE__;
      if (state && state.settings) {
        state.settings.containerAlpha = ${value};
        state.applySettings();
      }
      return true;
    })()
  `);
  await new Promise(r => setTimeout(r, 300));
}

// Force apply CSS variable directly (bypass rAF)
async function setCssVarDirect(cdp, value) {
  await cdp.eval(`
    document.documentElement.style.setProperty('--dream-container-alpha', '${(value / 100).toFixed(2)}');
  `);
  await new Promise(r => setTimeout(r, 100));
}

async function main() {
  const outDir = path.join(__dirname, "results");
  await fs.mkdir(outDir, { recursive: true });

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  Opacity Slider Home Page Test`);
  console.log(`${"═".repeat(70)}\n`);

  // ═══ Round 1 ═══
  console.log("── ROUND 1: Fresh start ──");
  killOC(); await new Promise(r => setTimeout(r, 1500));
  const proc = spawn("D:\\OpenCode\\OpenCode.exe", [`--remote-debugging-port=${PORT}`], { detached: true, stdio: "ignore" });
  proc.unref();
  if (!await waitCdp(PORT)) { console.error("CDP timeout"); return; }
  await new Promise(r => setTimeout(r, 3000));
  const t = await findTarget(PORT);
  if (!t) { console.error("No target"); return; }
  const cdp = new Cdp(t.webSocketDebuggerUrl);
  await cdp.open();
  await injectSkin(cdp);
  await cdp.eval(`document.getElementById('dream-settings-panel')?.classList.remove('hidden')`);
  await new Promise(r => setTimeout(r, 500));

  // Check initial state
  let state = await getOpacityState(cdp);
  console.log(`  Page: isHome=${state.isHome} dreamHome=${state.hasDreamHome} activeHome=${state.hasActiveHome}`);
  console.log(`  CSS var: --dream-container-alpha = ${state.containerAlpha}`);
  console.log(`  Computed: mainBgColor = ${state.mainBgColor}`);
  console.log(`  Slider: value = ${state.sliderValue}`);
  console.log(`  Settings: containerAlpha = ${state.settingsAlpha}`);
  console.log(`  Inline: --dream-container-alpha = ${state.inlineAlpha}`);

  // Screenshot at default opacity
  await cdp.screenshot(path.join(outDir, "r1-default.png"));

  // Set opacity to 0%
  console.log("\n  Setting opacity to 0%...");
  await setOpacity(cdp, 0);
  state = await getOpacityState(cdp);
  console.log(`  After: CSS var=${state.containerAlpha} computed=${state.mainBgColor} slider=${state.sliderValue}`);
  await cdp.screenshot(path.join(outDir, "r1-opacity-0.png"));

  // Set opacity to 100%
  console.log("\n  Setting opacity to 100%...");
  await setOpacity(cdp, 100);
  state = await getOpacityState(cdp);
  console.log(`  After: CSS var=${state.containerAlpha} computed=${state.mainBgColor} slider=${state.sliderValue}`);
  await cdp.screenshot(path.join(outDir, "r1-opacity-100.png"));

  // Test direct CSS var write (bypass rAF)
  console.log("\n  Direct CSS var write to 0.00...");
  await setCssVarDirect(cdp, 0);
  state = await getOpacityState(cdp);
  console.log(`  After: CSS var=${state.containerAlpha} computed=${state.mainBgColor}`);
  await cdp.screenshot(path.join(outDir, "r1-direct-0.png"));

  // Test direct settings write (bypass slider)
  console.log("\n  Direct settings write to 100...");
  await setOpacityDirect(cdp, 100);
  state = await getOpacityState(cdp);
  console.log(`  After: CSS var=${state.containerAlpha} computed=${state.mainBgColor}`);
  await cdp.screenshot(path.join(outDir, "r1-direct-100.png"));

  // ═══ Round 2: Restart ═══
  console.log(`\n── ROUND 2: After restart ──`);
  cdp.close();
  killOC(); await new Promise(r => setTimeout(r, 2000));
  spawn("D:\\OpenCode\\OpenCode.exe", [`--remote-debugging-port=${PORT}`], { detached: true, stdio: "ignore" }).unref();
  if (!await waitCdp(PORT)) { console.error("CDP timeout"); return; }
  await new Promise(r => setTimeout(r, 3000));
  const t2 = await findTarget(PORT);
  if (!t2) { console.error("No target"); return; }
  const cdp2 = new Cdp(t2.webSocketDebuggerUrl);
  await cdp2.open();
  await injectSkin(cdp2);
  await cdp2.eval(`document.getElementById('dream-settings-panel')?.classList.remove('hidden')`);
  await new Promise(r => setTimeout(r, 500));

  state = await getOpacityState(cdp2);
  console.log(`  Page: isHome=${state.isHome} dreamHome=${state.hasDreamHome} activeHome=${state.hasActiveHome}`);
  console.log(`  CSS var: --dream-container-alpha = ${state.containerAlpha}`);
  console.log(`  Computed: mainBgColor = ${state.mainBgColor}`);
  console.log(`  Slider: value = ${state.sliderValue}`);
  console.log(`  Settings: containerAlpha = ${state.settingsAlpha}`);
  console.log(`  Inline: --dream-container-alpha = ${state.inlineAlpha}`);

  await cdp2.screenshot(path.join(outDir, "r2-default.png"));

  console.log("\n  Setting opacity to 0%...");
  await setOpacity(cdp2, 0);
  state = await getOpacityState(cdp2);
  console.log(`  After: CSS var=${state.containerAlpha} computed=${state.mainBgColor} slider=${state.sliderValue}`);
  await cdp2.screenshot(path.join(outDir, "r2-opacity-0.png"));

  console.log("\n  Setting opacity to 100%...");
  await setOpacity(cdp2, 100);
  state = await getOpacityState(cdp2);
  console.log(`  After: CSS var=${state.containerAlpha} computed=${state.mainBgColor} slider=${state.sliderValue}`);
  await cdp2.screenshot(path.join(outDir, "r2-opacity-100.png"));

  // Direct CSS var test after restart
  console.log("\n  Direct CSS var write to 0.00...");
  await setCssVarDirect(cdp2, 0);
  state = await getOpacityState(cdp2);
  console.log(`  After: computed=${state.mainBgColor}`);
  await cdp2.screenshot(path.join(outDir, "r2-direct-0.png"));

  console.log("\n  Direct CSS var write to 1.00...");
  await setCssVarDirect(cdp2, 100);
  state = await getOpacityState(cdp2);
  console.log(`  After: computed=${state.mainBgColor}`);
  await cdp2.screenshot(path.join(outDir, "r2-direct-100.png"));

  // ═══ Report ═══
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  Screenshots saved to: ${outDir}`);
  console.log(`  Compare r2-opacity-0.png vs r2-opacity-100.png`);
  console.log(`${"═".repeat(70)}\n`);

  cdp2.close();
  killOC();
}

main().catch(e => { console.error("Fatal:", e); process.exit(2); });
