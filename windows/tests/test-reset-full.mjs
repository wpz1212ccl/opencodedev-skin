#!/usr/bin/env node
/**
 * OpenCode-Skin Comprehensive Reset + Restart Test
 *
 * 全流程测试：
 *   1. 启动 OpenCode → 注入皮肤 → 测试滑块
 *   2. 点击 Reset → 测试滑块仍有效
 *   3. 退出 OpenCode → 重新启动 → 检查持久化 → 测试滑块
 *   4. 切换图片 → 测试滑块 → 点 Reset → 确认图片不变
 *   5. 再次重启 → 检查一切正常
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { spawn, execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 9335;

// ── CDP ──
async function fetchCdp(port, r) { const res = await fetch(`http://127.0.0.1:${port}${r}`); if (!res.ok) throw new Error(`${r} ${res.status}`); return res.json(); }

class Cdp {
  constructor(u) { this.u = u; this.ws = null; this.id = 1; this.p = new Map(); this.closed = false; }
  open() { return new Promise((ok, no) => { const t = setTimeout(() => no(new Error("ws timeout")), 5000); this.ws = new WebSocket(this.u); this.ws.addEventListener("open", () => { clearTimeout(t); ok(); }, { once: true }); this.ws.addEventListener("error", () => { clearTimeout(t); no(new Error("ws failed")); }, { once: true }); this.ws.addEventListener("message", e => { const m = JSON.parse(String(e.data)); if (m.id != null && this.p.has(m.id)) { const p = this.p.get(m.id); this.p.delete(m.id); clearTimeout(p.t); m.error ? p.n(new Error(m.error.message)) : p.ok(m.result); } }); this.ws.addEventListener("close", () => { this.closed = true; for (const p of this.p.values()) { clearTimeout(p.t); p.n(new Error("closed")); } this.p.clear(); }); }); }
  send(m, pa = {}) { if (this.closed) return Promise.reject(new Error("closed")); return new Promise((ok, no) => { const id = this.id++; const t = setTimeout(() => { this.p.delete(id); no(new Error(`timeout: ${m}`)); }, 60000); this.p.set(id, { ok, no, t }); this.ws.send(JSON.stringify({ id, method: m, params: pa })); }); }
  async eval(expr) { const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(`Eval: ${r.exceptionDetails.text || JSON.stringify(r.exceptionDetails)}`); return r.result?.value; }
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

function launchOC(port) {
  const p = spawn("D:\\OpenCode\\OpenCode.exe", [`--remote-debugging-port=${port}`], { detached: true, stdio: "ignore" });
  p.unref();
  return p;
}

// ── HTTP server ──
function startServer(dir, port) {
  return new Promise((ok, no) => {
    const s = http.createServer(async (req, res) => {
      try { const f = path.join(dir, decodeURIComponent(req.url.slice(1))); const d = await fs.readFile(f); const ext = path.extname(f).toLowerCase(); const m = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" }[ext] || "application/octet-stream"; res.writeHead(200, { "Content-Type": m, "Access-Control-Allow-Origin": "*" }); res.end(d); } catch { res.writeHead(404); res.end(); }
    });
    s.listen(port, "127.0.0.1", () => ok({ server: s, port }));
    s.on("error", no);
  });
}

// ── Inject skin ──
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

// ── Test a single slider ──
async function testSlider(cdp, key, from, to, cssVar) {
  await cdp.eval(`(function(){var s=document.querySelector('.dream-slider[data-key="${key}"]');if(!s)return false;s.value=${from};s.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await new Promise(r => setTimeout(r, 100));
  const v1 = await cdp.eval(`getComputedStyle(document.documentElement).getPropertyValue('${cssVar}').trim()`);
  await cdp.eval(`(function(){var s=document.querySelector('.dream-slider[data-key="${key}"]');if(!s)return false;s.value=${to};s.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await new Promise(r => setTimeout(r, 100));
  const v2 = await cdp.eval(`getComputedStyle(document.documentElement).getPropertyValue('${cssVar}').trim()`);
  return { key, v1, v2, ok: v1 !== v2 };
}

// ── Read all slider values from DOM ──
async function readSliders(cdp) {
  return JSON.parse(await cdp.eval(`(function(){var r={};document.querySelectorAll('.dream-slider').forEach(function(s){r[s.getAttribute('data-key')]=s.value;});return JSON.stringify(r);})()`));
}

// ── Read all CSS vars ──
async function readVars(cdp) {
  return JSON.parse(await cdp.eval(`(function(){var cs=getComputedStyle(document.documentElement);return JSON.stringify({ca:cs.getPropertyValue('--dream-container-alpha').trim(),ta:cs.getPropertyValue('--dream-titlebar-alpha').trim(),co:cs.getPropertyValue('--dream-content-alpha').trim(),pa:cs.getPropertyValue('--dream-composer-alpha').trim(),bl:cs.getPropertyValue('--dream-blur').trim(),br:cs.getPropertyValue('--dream-brightness').trim()});})()`));
}

// ── Read background state ──
async function readBgState(cdp) {
  return JSON.parse(await cdp.eval(`(function(){return JSON.stringify({customArt:window.__OPENCODE_DREAM_SKIN_STATE__?.settings?.customArt?'SET':'null',hasVideo:!!document.getElementById('opencode-dream-skin-video-el'),bgImage:document.documentElement.style.backgroundImage?.substring(0,50)||'none'});})()`));
}

// ── Click Reset ──
async function clickReset(cdp) {
  await cdp.eval(`document.querySelector('#dream-reset')?.click()`);
  await new Promise(r => setTimeout(r, 300));
}

// ── Open panel ──
async function openPanel(cdp) {
  await cdp.eval(`document.getElementById('dream-settings-panel')?.classList.remove('hidden')`);
  await new Promise(r => setTimeout(r, 200));
}

// ── Connect helper ──
async function connect() {
  if (!await waitCdp(PORT)) throw new Error("CDP timeout");
  await new Promise(r => setTimeout(r, 3000));
  const t = await findTarget(PORT);
  if (!t) throw new Error("No target");
  const cdp = new Cdp(t.webSocketDebuggerUrl);
  await cdp.open();
  return cdp;
}

// ── Slider definitions ──
const SLIDERS = [
  { key: "containerAlpha", cssVar: "--dream-container-alpha", def: 65, test: 20, label: "Opacity" },
  { key: "titlebarAlpha", cssVar: "--dream-titlebar-alpha", def: 75, test: 20, label: "Titlebar" },
  { key: "contentAlpha", cssVar: "--dream-content-alpha", def: 70, test: 20, label: "Content" },
  { key: "composerAlpha", cssVar: "--dream-composer-alpha", def: 80, test: 20, label: "Composer" },
  { key: "blur", cssVar: "--dream-blur", def: 3, test: 15, label: "Blur" },
  { key: "brightness", cssVar: "--dream-brightness", def: 100, test: 150, label: "Brightness" },
];

// ── Test all sliders, return pass count ──
async function testAllSliders(cdp, label) {
  const results = [];
  for (const s of SLIDERS) {
    const r = await testSlider(cdp, s.key, s.def, s.test, s.cssVar);
    results.push({ ...r, label: s.label });
  }
  const passed = results.filter(r => r.ok).length;
  console.log(`  ${passed === results.length ? "✅" : "⚠️"} ${label}: ${passed}/${results.length} sliders work`);
  for (const r of results) {
    if (!r.ok) console.log(`     ❌ ${r.label}: ${r.v1} → ${r.v2} (no change)`);
  }
  return passed;
}

async function main() {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  Comprehensive Reset + Restart Test`);
  console.log(`${"═".repeat(70)}\n`);

  const { server: imgServer, port: imgPort } = await startServer(path.join(ROOT, "assets"), 18768);
  let cdp, passed = 0, total = 0;

  try {
    // ══════════════════════════════════════════════════════
    // Round 1: Fresh start → test → reset → test
    // ══════════════════════════════════════════════════════
    console.log("═".repeat(70));
    console.log("  ROUND 1: Fresh start → Test → Reset → Test");
    console.log("═".repeat(70));

    killOC(); await new Promise(r => setTimeout(r, 1500));
    launchOC(PORT); cdp = await connect();
    await injectSkin(cdp);
    await openPanel(cdp);
    console.log("  Injected + panel open\n");

    // Test sliders work
    passed += await testAllSliders(cdp, "Before Reset");
    total++;

    // Click Reset
    console.log("\n  Clicking Reset...");
    const bgBefore = await readBgState(cdp);
    console.log(`  Background before reset: ${JSON.stringify(bgBefore)}`);
    await clickReset(cdp);
    const bgAfter = await readBgState(cdp);
    console.log(`  Background after reset:  ${JSON.stringify(bgAfter)}`);
    const bgPreserved = bgBefore.customArt === bgAfter.customArt && bgBefore.hasVideo === bgAfter.hasVideo;
    console.log(`  Background preserved: ${bgPreserved ? "✅" : "❌"}`);

    // Test sliders still work after reset
    passed += await testAllSliders(cdp, "After Reset");
    total++;

    // Restart OpenCode
    console.log("\n  Restarting OpenCode...");
    cdp.close();
    killOC(); await new Promise(r => setTimeout(r, 2000));
    launchOC(PORT); cdp = await connect();
    await injectSkin(cdp);
    await openPanel(cdp);

    // Check settings persisted
    const persisted = await readSliders(cdp);
    console.log(`  Slider values after restart: ${JSON.stringify(persisted)}`);

    // Test sliders after restart
    passed += await testAllSliders(cdp, "After Restart");
    total++;

    // ══════════════════════════════════════════════════════
    // Round 2: Switch image → test → reset → test
    // ══════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(70)}`);
    console.log("  ROUND 2: Switch Image → Test → Reset → Verify image kept");
    console.log("═".repeat(70));

    // Change to a different image
    console.log("  Switching to different image...");
    await cdp.eval(`(function(){
      var root=document.documentElement;
      root.style.setProperty('--dream-art','url("http://127.0.0.1:18768/dream-reference.jpg")');
      root.style.backgroundImage='url("http://127.0.0.1:18768/dream-reference.jpg")';
      root.style.backgroundSize='cover';
      root.style.backgroundPosition='50% 50%';
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 500));
    const bgSwitch = await readBgState(cdp);
    console.log(`  Background after switch: ${JSON.stringify(bgSwitch)}`);

    // Drag some sliders to non-default values
    await cdp.eval(`(function(){var s=document.querySelector('.dream-slider[data-key="containerAlpha"]');s.value=30;s.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
    await cdp.eval(`(function(){var s=document.querySelector('.dream-slider[data-key="titlebarAlpha"]');s.value=40;s.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
    await new Promise(r => setTimeout(r, 200));

    // Test sliders work with new image
    passed += await testAllSliders(cdp, "With New Image");
    total++;

    // Click Reset
    console.log("\n  Clicking Reset...");
    const bgBeforeReset = await readBgState(cdp);
    await clickReset(cdp);
    const bgAfterReset = await readBgState(cdp);
    console.log(`  Background preserved after reset: ${bgBeforeReset.bgImage === bgAfterReset.bgImage ? "✅ YES" : "❌ NO"}`);
    console.log(`    Before: ${bgBeforeReset.bgImage}`);
    console.log(`    After:  ${bgAfterReset.bgImage}`);

    // Test sliders still work after reset
    passed += await testAllSliders(cdp, "After Reset (new image)");
    total++;

    // ══════════════════════════════════════════════════════
    // Round 3: Full restart → verify everything
    // ══════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(70)}`);
    console.log("  ROUND 3: Full Restart → Verify Everything");
    console.log("═".repeat(70));

    cdp.close();
    killOC(); await new Promise(r => setTimeout(r, 2000));
    launchOC(PORT); cdp = await connect();
    await injectSkin(cdp);
    await openPanel(cdp);

    // Check background
    const finalBg = await readBgState(cdp);
    console.log(`  Background after final restart: ${JSON.stringify(finalBg)}`);

    // Check slider values
    const finalSliders = await readSliders(cdp);
    console.log(`  Slider values: ${JSON.stringify(finalSliders)}`);

    // Test sliders
    passed += await testAllSliders(cdp, "Final After Restart");
    total++;

    // ══════════════════════════════════════════════════════
    // Round 4: Switch to video → test → reset → test
    // ══════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(70)}`);
    console.log("  ROUND 4: Switch to Video → Test → Reset → Test");
    console.log("═".repeat(70));

    console.log("  Switching to video...");
    await cdp.eval(`(function(){
      var root=document.documentElement;
      root.style.removeProperty('--dream-art');
      root.style.removeProperty('background-image');
      root.classList.add('dream-video-active');
      var vc=document.getElementById('opencode-dream-skin-video');
      if(!vc){vc=document.createElement('div');vc.id='opencode-dream-skin-video';vc.style.cssText='position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:-2147483647;pointer-events:none;background:#000;';document.body.insertBefore(vc,document.body.firstChild);}
      var vid=document.getElementById('opencode-dream-skin-video-el');
      if(!vid){vid=document.createElement('video');vid.id='opencode-dream-skin-video-el';vid.autoplay=true;vid.loop=true;vid.muted=true;vid.playsInline=true;vid.style.cssText='width:100%;height:100%;object-fit:cover;';vc.appendChild(vid);}
      vid.src='http://127.0.0.1:18768/video-bg.mp4';
      vid.load();
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 3000));
    const vidState = await readBgState(cdp);
    console.log(`  Video state: ${JSON.stringify(vidState)}`);

    // Test sliders with video
    passed += await testAllSliders(cdp, "With Video");
    total++;

    // Reset
    console.log("\n  Clicking Reset...");
    await clickReset(cdp);
    const vidAfterReset = await readBgState(cdp);
    console.log(`  Video preserved: ${vidAfterReset.hasVideo ? "✅" : "❌"}`);

    passed += await testAllSliders(cdp, "After Reset (video)");
    total++;

  } finally {
    if (cdp) cdp.close();
    imgServer.close();
    killOC();
  }

  // ══════════════════════════════════════════════════════
  // Final Report
  // ══════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  FINAL REPORT`);
  console.log(`${"═".repeat(70)}`);
  console.log(`  Total test rounds: ${total}`);
  console.log(`  All sliders working: ${passed}/${total * SLIDERS.length}`);
  console.log(`${"═".repeat(70)}\n`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(2); });
