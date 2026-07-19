#!/usr/bin/env node
/**
 * OpenCode-Skin Slider Functional Test
 *
 * 测试每个滑块拖动后，CSS 变量和 computed style 是否真的变了。
 * 全流程：启动 OpenCode → CDP 连接 → 注入皮肤 → 打开控制台 → 逐个测试滑块
 *
 * Usage:
 *   node test-all-sliders.mjs [--port 9335]
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { spawn, execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const opts = { port: 9335, timeout: 45000, outputDir: path.join(__dirname, "results") };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--port") opts.port = Number(argv[++i]);
  }
  return opts;
}

// ── CDP helpers ──
async function fetchCdp(port, resource) {
  const res = await fetch(`http://127.0.0.1:${port}${resource}`, { redirect: "error" });
  if (!res.ok) throw new Error(`CDP ${resource} returned ${res.status}`);
  return res.json();
}

class CdpSession {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.ws = null; this.nextId = 1; this.pending = new Map(); this.closed = false; }
  open() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.ws?.close(); reject(new Error("WS open timeout")); }, 5000);
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("WS open failed")); }, { once: true });
      this.ws.addEventListener("message", (e) => {
        const msg = JSON.parse(String(e.data));
        if (msg.id != null && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id); this.pending.delete(msg.id); clearTimeout(p.timeout);
          msg.error ? p.reject(new Error(`${msg.error.message}`)) : p.resolve(msg.result);
        }
      });
      this.ws.addEventListener("close", () => { this.closed = true; for (const p of this.pending.values()) { clearTimeout(p.timeout); p.reject(new Error("WS closed")); } this.pending.clear(); });
    });
  }
  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("Session closed"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 60000);
      this.pending.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`Eval: ${r.exceptionDetails.text || JSON.stringify(r.exceptionDetails)}`);
    return r.result?.value;
  }
  async screenshot(outputPath) {
    const r = await this.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    await fs.writeFile(outputPath, Buffer.from(r.data, "base64"));
  }
  close() { if (!this.closed) try { this.ws?.close(); } catch {} this.closed = true; }
}

// ── HTTP server for images ──
function startImageServer(assetsDir, port = 18767) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = decodeURIComponent(req.url.slice(1));
        const filePath = path.join(assetsDir, url);
        const data = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".mp4": "video/mp4" }[ext] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime, "Access-Control-Allow-Origin": "*" });
        res.end(data);
      } catch { res.writeHead(404); res.end("Not found"); }
    });
    server.listen(port, "127.0.0.1", () => resolve({ server, port }));
    server.on("error", reject);
  });
}

function killOpenCode() {
  try { execSync("taskkill /F /IM OpenCode.exe 2>nul", { stdio: "ignore" }); } catch {}
}

async function waitForCdp(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await fetchCdp(port, "/json/version"); return true; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function findRendererTarget(port, maxRetries = 10, delayMs = 2000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const targets = await fetchCdp(port, "/json/list");
      const found = targets.find(t => t.type === "page" && t.url?.startsWith("oc://") && t.webSocketDebuggerUrl);
      if (found) return found;
    } catch {}
    if (i < maxRetries - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  return null;
}

// ── Inject skin via CDP ──
async function injectSkin(session) {
  const cssPath = path.join(ROOT, "assets", "dream-skin.css");
  const jsPath = path.join(ROOT, "assets", "renderer-inject.js");
  const themePath = path.join(ROOT, "assets", "theme.json");

  const cssText = await fs.readFile(cssPath, "utf-8");
  const jsText = await fs.readFile(jsPath, "utf-8");
  const theme = JSON.parse(await fs.readFile(themePath, "utf-8"));

  // Build art data URL
  const artPath = theme.art?.image || "assets/wallpapers/五条悟.png";
  const fullArtPath = path.join(ROOT, "assets", artPath);
  let artDataUrl = "data:image/png;base64,";
  try {
    const buf = await fs.readFile(fullArtPath);
    const ext = path.extname(fullArtPath).toLowerCase();
    const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
    artDataUrl = `data:${mime};base64,${buf.toString("base64")}`;
  } catch {}

  let preparedJs = jsText
    .replace('"__DREAM_CSS_JSON__"', JSON.stringify(cssText))
    .replace("'__DREAM_ART_JSON__'", JSON.stringify(artDataUrl))
    .replace("__DREAM_THEME_JSON__", JSON.stringify(theme));

  await session.evaluate(`(function(){ var s=document.getElementById('opencode-dream-skin-style'); if(!s){s=document.createElement('style');s.id='opencode-dream-skin-style';(document.head||document.documentElement).appendChild(s);} s.textContent=${JSON.stringify(cssText)}; return true; })()`);
  await session.evaluate(`(function(){ ${preparedJs}; return true; })()`);
}

// ── Get computed styles for a selector ──
async function getComputedBg(session, selector) {
  return await session.evaluate(`
    (function() {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return JSON.stringify({ error: 'element not found', selector: ${JSON.stringify(selector)} });
      var cs = getComputedStyle(el);
      return JSON.stringify({
        selector: ${JSON.stringify(selector)},
        backgroundColor: cs.backgroundColor,
        backdropFilter: cs.backdropFilter,
        filter: cs.filter,
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
      });
    })()
  `);
}

// ── Get all CSS variable values ──
async function getCssVars(session) {
  return await session.evaluate(`
    (function() {
      var root = document.documentElement;
      var cs = getComputedStyle(root);
      return JSON.stringify({
        '--dream-blur': cs.getPropertyValue('--dream-blur'),
        '--dream-brightness': cs.getPropertyValue('--dream-brightness'),
        '--dream-contrast': cs.getPropertyValue('--dream-contrast'),
        '--dream-saturate': cs.getPropertyValue('--dream-saturate'),
        '--dream-container-alpha': cs.getPropertyValue('--dream-container-alpha'),
        '--dream-titlebar-alpha': cs.getPropertyValue('--dream-titlebar-alpha'),
        '--dream-content-alpha': cs.getPropertyValue('--dream-content-alpha'),
        '--dream-composer-alpha': cs.getPropertyValue('--dream-composer-alpha'),
      });
    })()
  `);
}

// ── Set slider value and trigger events ──
async function setSlider(session, key, value) {
  return await session.evaluate(`
    (function() {
      var slider = document.querySelector('.dream-slider[data-key="${key}"]');
      if (!slider) return JSON.stringify({ error: 'slider not found', key: '${key}' });
      slider.value = ${value};
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      return JSON.stringify({ ok: true, key: '${key}', value: ${value} });
    })()
  `);
}

// ── Get current slider value from UI ──
async function getSliderValue(session, key) {
  return await session.evaluate(`
    (function() {
      var slider = document.querySelector('.dream-slider[data-key="${key}"]');
      var display = document.querySelector('[data-display="${key}"]');
      return JSON.stringify({
        sliderValue: slider ? slider.value : null,
        displayText: display ? display.textContent : null,
        exists: !!slider,
      });
    })()
  `);
}

// ── Open settings panel ──
async function openPanel(session) {
  await session.evaluate(`
    (function() {
      var panel = document.getElementById('dream-settings-panel');
      if (panel) panel.classList.remove('hidden');
      return !!panel;
    })()
  `);
}

// ── Change background image via settings panel ──
async function changeBackground(session, imageUrl) {
  return await session.evaluate(`
    (function() {
      var root = document.documentElement;
      root.style.setProperty('--dream-art', 'url("${imageUrl}")');
      root.style.backgroundImage = 'url("${imageUrl}")';
      root.style.backgroundPosition = '50% 50%';
      root.style.backgroundSize = 'cover';
      root.style.backgroundRepeat = 'no-repeat';
      root.style.backgroundAttachment = 'fixed';
      return true;
    })()
  `);
}

// ── Detect current page type ──
async function detectPageType(session) {
  return await session.evaluate(`
    (function() {
      var isHome = !!document.querySelector('[data-component="session-new-design"], [data-component="home"], [data-component="welcome"]');
      var hasDreamHome = document.documentElement.classList.contains('dream-active-home');
      var mainContainer = document.querySelector('#root > div:first-child');
      var hasDreamHomeClass = mainContainer ? mainContainer.classList.contains('dream-home') : false;
      return JSON.stringify({ isHome, hasDreamHome, hasDreamHomeClass });
    })()
  `);
}

// ── Main ──
async function main() {
  const opts = parseArgs(process.argv);

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  OpenCode-Skin Slider Functional Test`);
  console.log(`  Testing: Opacity, Titlebar, Content, Composer + all Background sliders`);
  console.log(`${"═".repeat(70)}\n`);

  // 1. Start HTTP server for images
  console.log("[1/8] Starting image server...");
  const assetsDir = path.join(ROOT, "assets");
  const { server: imgServer, port: imgPort } = await startImageServer(assetsDir);
  console.log(`  Image server: http://127.0.0.1:${imgPort}\n`);

  // 2. Kill & launch OpenCode
  console.log("[2/8] Launching OpenCode...");
  try { execSync("taskkill /F /IM OpenCode.exe 2>nul", { stdio: "ignore" }); } catch {}
  await new Promise(r => setTimeout(r, 1000));
  const proc = spawn("D:\\OpenCode\\OpenCode.exe", [`--remote-debugging-port=${opts.port}`], { detached: true, stdio: "ignore" });
  proc.unref();
  console.log(`  PID: ${proc.pid}`);

  // 3. Wait for CDP
  console.log("[3/8] Waiting for CDP...");
  if (!await waitForCdp(opts.port, opts.timeout)) { console.error("  FAIL: CDP timeout"); return; }
  console.log("  PASS\n");

  // 4. Connect
  console.log("[4/8] Connecting to renderer...");
  await new Promise(r => setTimeout(r, 3000));
  const target = await findRendererTarget(opts.port);
  if (!target) { console.error("  FAIL: No target"); return; }
  const session = new CdpSession(target.webSocketDebuggerUrl);
  await session.open();
  console.log(`  Target: ${target.id.slice(0, 12)}\n`);

  // 5. Inject skin
  console.log("[5/8] Injecting skin...");
  await injectSkin(session);
  const skinOk = await session.evaluate(`JSON.stringify({ hasSkin: document.documentElement.classList.contains('opencode-dream-skin'), hasState: !!window.__OPENCODE_DREAM_SKIN_STATE__ })`);
  console.log(`  ${skinOk}\n`);

  // 6. Open panel
  console.log("[6/8] Opening settings panel...");
  await openPanel(session);
  await new Promise(r => setTimeout(r, 300));
  console.log("  Panel opened\n");

  // 7. Detect page type
  const pageInfo = JSON.parse(await detectPageType(session));
  console.log(`  Page type: ${JSON.stringify(pageInfo)}\n`);

  // 8. Test all sliders
  console.log("[7/8] Testing all sliders...\n");

  // Define all sliders to test
  const sliders = [
    // Background section
    { key: "blur", testVal: 15, cssVar: "--dream-blur", target: "#root > div:first-child", prop: "backdropFilter", label: "Blur" },
    { key: "brightness", testVal: 150, cssVar: "--dream-brightness", target: "#root > div:first-child", prop: "filter", label: "Brightness" },
    { key: "contrast", testVal: 150, cssVar: "--dream-contrast", target: "#root > div:first-child", prop: "filter", label: "Contrast" },
    { key: "saturate", testVal: 150, cssVar: "--dream-saturate", target: "#root > div:first-child", prop: "filter", label: "Saturate" },
    { key: "containerAlpha", testVal: 30, cssVar: "--dream-container-alpha", target: "#root > div:first-child", prop: "backgroundColor", label: "Opacity (container)" },
    // UI section
    { key: "titlebarAlpha", testVal: 30, cssVar: "--dream-titlebar-alpha", target: 'header[data-slot="titlebar-v2"]', prop: "backgroundColor", label: "Titlebar" },
    { key: "contentAlpha", testVal: 30, cssVar: "--dream-content-alpha", target: "main .bg-v2-background-bg-base", prop: "backgroundColor", label: "Content" },
    { key: "composerAlpha", testVal: 30, cssVar: "--dream-composer-alpha", target: '[data-component="session-composer"]', prop: "backgroundColor", label: "Composer" },
  ];

  const results = [];

  for (const s of sliders) {
    // Get default value from CSS
    const defaultVal = await session.evaluate(`
      (function() {
        var root = document.documentElement;
        var cs = getComputedStyle(root);
        return cs.getPropertyValue(${JSON.stringify(s.cssVar)}).trim();
      })()
    `);

    // Get computed style BEFORE
    const beforeJson = await getComputedBg(session, s.target);
    const before = JSON.parse(beforeJson);

    // Set slider to test value
    const setResult = JSON.parse(await setSlider(session, s.key, s.testVal));
    await new Promise(r => setTimeout(r, 200)); // wait for rAF + style recalc

    // Get CSS variable AFTER
    const afterVar = await session.evaluate(`
      (function() {
        var cs = getComputedStyle(document.documentElement);
        return cs.getPropertyValue(${JSON.stringify(s.cssVar)}).trim();
      })()
    `);

    // Get computed style AFTER
    const afterJson = await getComputedBg(session, s.target);
    const after = JSON.parse(afterJson);

    // Compare
    const varChanged = defaultVal !== afterVar;
    const styleChanged = before[s.prop] !== after[s.prop];

    const status = varChanged ? (styleChanged ? "PASS" : "PARTIAL") : "FAIL";
    const icon = status === "PASS" ? "✅" : status === "PARTIAL" ? "⚠️" : "❌";

    results.push({ slider: s.label, key: s.key, status, defaultVal, testVal: afterVar, beforeProp: before[s.prop], afterProp: after[s.prop], varChanged, styleChanged });

    console.log(`  ${icon} ${s.label.padEnd(20)} var: ${defaultVal.padEnd(10)} → ${afterVar.padEnd(10)} | ${s.prop}: ${before[s.prop]?.substring(0, 40)} → ${after[s.prop]?.substring(0, 40)}`);
  }

  // Reset all sliders to defaults
  console.log("\n  Resetting sliders...");
  for (const s of sliders) {
    const defaults = { blur: 3, brightness: 100, contrast: 100, saturate: 100, containerAlpha: 65, titlebarAlpha: 75, contentAlpha: 70, composerAlpha: 80 };
    await setSlider(session, s.key, defaults[s.key]);
  }
  await new Promise(r => setTimeout(r, 300));

  // 9. Take screenshot
  console.log("\n[8/8] Taking screenshot...");
  await fs.mkdir(opts.outputDir, { recursive: true });
  await session.screenshot(path.join(opts.outputDir, "slider-test-final.png"));
  console.log("  Saved\n");

  // ── Report ──
  console.log(`${"═".repeat(70)}`);
  console.log(`  SLIDER FUNCTIONAL TEST REPORT`);
  console.log(`${"═".repeat(70)}\n`);

  const passed = results.filter(r => r.status === "PASS").length;
  const partial = results.filter(r => r.status === "PARTIAL").length;
  const failed = results.filter(r => r.status === "FAIL").length;

  console.log(`  Results: ${passed} passed, ${partial} partial, ${failed} failed\n`);

  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : r.status === "PARTIAL" ? "⚠️" : "❌";
    console.log(`  ${icon} ${r.key.padEnd(20)} status=${r.status}`);
    if (r.status !== "PASS") {
      console.log(`     CSS var changed: ${r.varChanged} (${r.defaultVal} → ${r.testVal})`);
      console.log(`     Computed ${r.prop} changed: ${r.styleChanged}`);
      console.log(`     Before: ${r.beforeProp}`);
      console.log(`     After:  ${r.afterProp}`);
    }
  }

  console.log(`\n${"═".repeat(70)}\n`);

  // Save report
  const reportPath = path.join(opts.outputDir, "slider-test-report.json");
  await fs.writeFile(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), pageInfo, results }, null, 2));

  session.close();
  imgServer.close();
  try { execSync("taskkill /F /IM OpenCode.exe 2>nul", { stdio: "ignore" }); } catch {}
}

main().catch(e => { console.error("Fatal:", e); process.exit(2); });
