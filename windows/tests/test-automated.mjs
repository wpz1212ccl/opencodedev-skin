#!/usr/bin/env node
/**
 * Automated OpenCode Skin Test
 * Connects via CDP, injects skin, takes screenshots, validates DOM, generates report.
 *
 * Usage:
 *   node test-automated.mjs --port 9335 --theme-dir ../assets --output-dir ./results
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── CLI args ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { port: 9335, themeDir: path.join(ROOT, "assets"), outputDir: path.join(__dirname, "results"), timeout: 30000 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--port") opts.port = Number(argv[++i]);
    else if (argv[i] === "--theme-dir") opts.themeDir = path.resolve(argv[++i]);
    else if (argv[i] === "--output-dir") opts.outputDir = path.resolve(argv[++i]);
    else if (argv[i] === "--timeout") opts.timeout = Number(argv[++i]);
  }
  return opts;
}

// ── CDP helpers ───────────────────────────────────────────────────────
async function fetchCdp(port, resource) {
  const res = await fetch(`http://127.0.0.1:${port}${resource}`, { redirect: "error" });
  if (!res.ok) throw new Error(`CDP ${resource} returned ${res.status}`);
  return res.json();
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
  }
  open() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.ws?.close(); reject(new Error("WS open timeout")); }, 5000);
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("WS open failed")); }, { once: true });
      this.ws.addEventListener("message", (e) => {
        const msg = JSON.parse(String(e.data));
        if (msg.id != null && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          clearTimeout(p.timeout);
          msg.error ? p.reject(new Error(`${msg.error.message} (${msg.error.code})`)) : p.resolve(msg.result);
        }
      });
      this.ws.addEventListener("close", () => { this.closed = true; for (const p of this.pending.values()) { clearTimeout(p.timeout); p.reject(new Error("WS closed")); } this.pending.clear(); });
    });
  }
  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("Session closed"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
      this.pending.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: false });
    if (r.exceptionDetails) throw new Error(`Eval error: ${r.exceptionDetails.text || JSON.stringify(r.exceptionDetails)}`);
    return r.result?.value;
  }
  async screenshot(outputPath, opts = {}) {
    const r = await this.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false, ...opts });
    await fs.writeFile(outputPath, Buffer.from(r.data, "base64"));
    return outputPath;
  }
  close() { if (!this.closed) try { this.ws?.close(); } catch {} this.closed = true; }
}

// ── Wait for CDP ──────────────────────────────────────────────────────
async function waitForCdp(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await fetchCdp(port, "/json/version"); return true; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

// ── Find OpenCode targets ─────────────────────────────────────────────
async function findTargets(port) {
  const targets = await fetchCdp(port, "/json/list");
  return targets.filter(t => t.type === "page" && t.url?.startsWith("oc://") && t.webSocketDebuggerUrl);
}

// ── Probe: is this an OpenCode page? ──────────────────────────────────
async function probePage(session) {
  return session.evaluate(`(() => {
    return {
      protocol: location.protocol,
      hasRoot: !!document.getElementById("root"),
      hasDataComponent: !!document.querySelector("[data-component]"),
      hasComposer: !!document.querySelector("[data-component='session-composer']"),
      hasDialogStack: !!document.querySelector("[data-component='dialog-stack']"),
      hasTitlebar: !!document.querySelector("header[data-slot='titlebar-v2']"),
      isHome: !!document.querySelector("[data-component='home'], [data-component='welcome']"),
      htmlClasses: document.documentElement.className,
      bodyChildCount: document.body?.children.length ?? 0,
    };
  })()`);
}

// ── Check skin state ──────────────────────────────────────────────────
async function checkSkinState(session) {
  return session.evaluate(`(() => {
    const root = document.documentElement;
    return {
      hasSkinClass: root.classList.contains("opencode-dream-skin"),
      hasThemeLight: root.classList.contains("dream-theme-light"),
      hasThemeDark: root.classList.contains("dream-theme-dark"),
      hasDreamHome: !!document.querySelector(".dream-home"),
      hasDreamTask: !!document.querySelector(".dream-task"),
      bgColor: getComputedStyle(root).backgroundColor,
      backgroundImage: root.style.backgroundImage?.substring(0, 80) || "none",
      hasStyleElement: !!document.getElementById("opencode-dream-skin-style"),
      styleElementLength: document.getElementById("opencode-dream-skin-style")?.textContent?.length ?? 0,
      stateExists: !!window.__OPENCODE_DREAM_SKIN_STATE__,
    };
  })()`);
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv);
  const results = { timestamp: new Date().toISOString(), port: opts.port, tests: [], screenshots: [] };

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  OpenCode Skin Automated Test`);
  console.log(`  Port: ${opts.port} | Theme: ${opts.themeDir}`);
  console.log(`${"═".repeat(60)}\n`);

  // 1. Wait for CDP
  console.log("[1/6] Waiting for CDP...");
  const cdpReady = await waitForCdp(opts.port, opts.timeout);
  results.tests.push({ name: "CDP available", pass: cdpReady, detail: `Port ${opts.port}` });
  if (!cdpReady) { console.error("  FAIL: CDP not available"); report(results, opts.outputDir); return; }
  console.log("  PASS: CDP ready\n");

  // 2. Find targets
  console.log("[2/6] Finding OpenCode targets...");
  let targets;
  try { targets = await findTargets(opts.port); } catch (e) { targets = []; }
  results.tests.push({ name: "Find targets", pass: targets.length > 0, detail: `Found ${targets.length} target(s)` });
  if (targets.length === 0) { console.error("  FAIL: No OpenCode targets found"); report(results, opts.outputDir); return; }
  for (const t of targets) console.log(`  Target: ${t.id} — ${t.url}`);
  console.log();

  // 3. Connect & probe each target
  console.log("[3/6] Connecting and probing targets...");
  const sessions = [];
  for (const target of targets) {
    const session = new CdpSession(target.webSocketDebuggerUrl);
    try {
      await session.open();
      const probe = await probePage(session);
      const isOpenCode = probe.protocol === "oc:" && probe.hasRoot && probe.hasDataComponent;
      results.tests.push({ name: `Probe ${target.id.slice(0, 8)}`, pass: isOpenCode, detail: JSON.stringify(probe) });
      console.log(`  ${isOpenCode ? "PASS" : "SKIP"}: ${target.id.slice(0, 8)} — protocol=${probe.protocol} root=${probe.hasRoot} composer=${probe.hasComposer} home=${probe.isHome}`);
      if (isOpenCode) sessions.push({ target, session, probe });
      else session.close();
    } catch (e) {
      results.tests.push({ name: `Connect ${target.id.slice(0, 8)}`, pass: false, detail: e.message });
      console.log(`  FAIL: ${target.id.slice(0, 8)} — ${e.message}`);
      session.close();
    }
  }
  console.log();

  if (sessions.length === 0) {
    console.error("  No valid OpenCode sessions found");
    report(results, opts.outputDir);
    return;
  }

  // 4. Screenshot BEFORE injection
  console.log("[4/6] Taking screenshots...");
  await fs.mkdir(opts.outputDir, { recursive: true });
  for (const { target, session, probe } of sessions) {
    const label = probe.isHome ? "home" : "chat";
    const beforePath = path.join(opts.outputDir, `before-${label}-${target.id.slice(0, 8)}.png`);
    try {
      await session.screenshot(beforePath);
      results.screenshots.push({ label: `before-${label}`, path: beforePath });
      console.log(`  Saved: ${path.basename(beforePath)}`);
    } catch (e) { console.log(`  Screenshot failed: ${e.message}`); }
  }
  console.log();

  // 5. Inject skin (run injector in once mode)
  console.log("[5/6] Injecting skin...");
  const injectorPath = path.join(ROOT, "scripts", "injector.mjs");
  const { exec } = await import("node:child_process");
  for (const { target, session, probe } of sessions) {
    try {
      const output = await new Promise((resolve, reject) => {
        const proc = exec(`node "${injectorPath}" --once --port ${opts.port} --auto-browser-id --theme-dir "${opts.themeDir}"`, { timeout: 30000 }, (err, stdout, stderr) => {
          if (err) reject(err);
          else resolve(stdout);
        });
      });
      const parsed = JSON.parse(output.trim().split("\n").pop());
      results.tests.push({ name: `Inject ${target.id.slice(0, 8)}`, pass: parsed.targets?.[0]?.result?.pass === true, detail: JSON.stringify(parsed) });
      console.log(`  ${parsed.targets?.[0]?.result?.pass ? "PASS" : "FAIL"}: ${target.id.slice(0, 8)}`);
    } catch (e) {
      results.tests.push({ name: `Inject ${target.id.slice(0, 8)}`, pass: false, detail: e.message });
      console.log(`  FAIL: ${target.id.slice(0, 8)} — ${e.message}`);
    }
  }
  console.log();

  // 6. Screenshot AFTER injection & validate DOM
  console.log("[6/6] Post-injection validation...");
  for (const { target, session, probe } of sessions) {
    const label = probe.isHome ? "home" : "chat";
    const afterPath = path.join(opts.outputDir, `after-${label}-${target.id.slice(0, 8)}.png`);
    try {
      await session.screenshot(afterPath);
      results.screenshots.push({ label: `after-${label}`, path: afterPath });
      console.log(`  Saved: ${path.basename(afterPath)}`);
    } catch (e) { console.log(`  Screenshot failed: ${e.message}`); }

    try {
      const skinState = await checkSkinState(session);
      const pass = skinState.hasSkinClass && skinState.hasStyleElement && skinState.stateExists;
      results.tests.push({ name: `Skin state ${label}`, pass, detail: JSON.stringify(skinState) });
      console.log(`  ${pass ? "PASS" : "FAIL"}: skinClass=${skinState.hasSkinClass} theme=${skinState.hasThemeDark ? "dark" : skinState.hasThemeLight ? "light" : "?"} home=${skinState.hasDreamHome} style=${skinState.styleElementLength}b state=${skinState.stateExists}`);
    } catch (e) {
      results.tests.push({ name: `Skin state ${label}`, pass: false, detail: e.message });
      console.log(`  FAIL: ${e.message}`);
    }
    session.close();
  }

  report(results, opts.outputDir);
}

function report(results, outputDir) {
  const passed = results.tests.filter(t => t.pass).length;
  const failed = results.tests.filter(t => !t.pass).length;
  const total = results.tests.length;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  RESULTS: ${passed}/${total} passed, ${failed} failed`);
  console.log(`${"═".repeat(60)}`);
  for (const t of results.tests) {
    console.log(`  ${t.pass ? "✅" : "❌"} ${t.name}`);
    if (!t.pass && t.detail) console.log(`     ${t.detail.substring(0, 120)}`);
  }
  if (results.screenshots.length) {
    console.log(`\n  Screenshots:`);
    for (const s of results.screenshots) console.log(`    ${s.label}: ${s.path}`);
  }
  console.log();

  const reportPath = path.join(outputDir, "report.json");
  fs.writeFile(reportPath, JSON.stringify(results, null, 2)).catch(() => {});
  console.log(`  Report: ${reportPath}\n`);

  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(e => { console.error("Fatal:", e); process.exit(2); });
