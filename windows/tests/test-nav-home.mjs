#!/usr/bin/env node
/**
 * Page Navigation Test
 *
 * 复现场景：从对话页退出重启 → 导航到新建会话页 → 壁纸是否被遮挡
 *
 * 流程：
 *   1. 启动 OpenCode → 注入皮肤 → 确认首页正常
 *   2. 模拟导航到对话页 → 确认对话页正常
 *   3. 重启 OpenCode → 注入皮肤（此时在对话页）
 *   4. 检查 dream-active-home class 是否正确
 *   5. 等待定时轮询 → 再次检查
 *   6. 截图对比
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

async function getPageState(cdp) {
  return JSON.parse(await cdp.eval(`
    (function() {
      var root = document.documentElement;
      var mainEl = document.querySelector('#root > div:first-child');
      var cs = mainEl ? getComputedStyle(mainEl) : null;
      return JSON.stringify({
        isHome: !!document.querySelector('[data-component="session-new-design"], [data-component="home"], [data-component="welcome"]'),
        hasDreamHome: mainEl ? mainEl.classList.contains('dream-home') : false,
        hasActiveHome: root.classList.contains('dream-active-home'),
        mainBgColor: cs ? cs.backgroundColor : 'N/A',
        rootClasses: root.className,
        mainClasses: mainEl ? mainEl.className : 'N/A',
        url: location.href,
      });
    })()
  `));
}

// Simulate clicking on a tab to navigate to a conversation
async function navigateToConversation(cdp) {
  // Click on the first conversation tab (not the new session tab)
  await cdp.eval(`
    (function() {
      var tabs = document.querySelectorAll('[data-slot="titlebar-tab-item"]');
      for (var i = 0; i < tabs.length; i++) {
        var text = tabs[i].textContent || '';
        if (text.indexOf('新建会话') === -1 && text.indexOf('New') === -1) {
          tabs[i].click();
          return text;
        }
      }
      return 'no conversation tab found';
    })()
  `);
  await new Promise(r => setTimeout(r, 500));
}

// Simulate clicking on the new session tab
async function navigateToNewSession(cdp) {
  await cdp.eval(`
    (function() {
      var tabs = document.querySelectorAll('[data-slot="titlebar-tab-item"]');
      for (var i = 0; i < tabs.length; i++) {
        var text = tabs[i].textContent || '';
        if (text.indexOf('新建会话') !== -1 || text.indexOf('New') !== -1) {
          tabs[i].click();
          return text;
        }
      }
      // Try clicking the + button
      var plus = document.querySelector('[data-component="icon-button-v2"]');
      if (plus) { plus.click(); return 'clicked plus'; }
      return 'no new session tab found';
    })()
  `);
  await new Promise(r => setTimeout(r, 500));
}

async function main() {
  const outDir = path.join(__dirname, "results");
  await fs.mkdir(outDir, { recursive: true });

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  Page Navigation Test: conversation→restart→new session`);
  console.log(`${"═".repeat(70)}\n`);

  // ═══ Step 1: Fresh start on home page ═══
  console.log("── Step 1: Fresh start on home page ──");
  killOC(); await new Promise(r => setTimeout(r, 1500));
  spawn("D:\\OpenCode\\OpenCode.exe", [`--remote-debugging-port=${PORT}`], { detached: true, stdio: "ignore" }).unref();
  if (!await waitCdp(PORT)) { console.error("CDP timeout"); return; }
  await new Promise(r => setTimeout(r, 3000));
  let t = await findTarget(PORT);
  if (!t) { console.error("No target"); return; }
  let cdp = new Cdp(t.webSocketDebuggerUrl);
  await cdp.open();
  await injectSkin(cdp);
  await new Promise(r => setTimeout(r, 500));

  let state = await getPageState(cdp);
  console.log(`  isHome=${state.isHome} dreamHome=${state.hasDreamHome} activeHome=${state.hasActiveHome}`);
  console.log(`  bg=${state.mainBgColor}`);
  await cdp.screenshot(path.join(outDir, "nav-step1-home.png"));

  // ═══ Step 2: Navigate to conversation ═══
  console.log("\n── Step 2: Navigate to conversation ──");
  await navigateToConversation(cdp);
  state = await getPageState(cdp);
  console.log(`  isHome=${state.isHome} dreamHome=${state.hasDreamHome} activeHome=${state.hasActiveHome}`);
  console.log(`  bg=${state.mainBgColor}`);
  await cdp.screenshot(path.join(outDir, "nav-step2-conversation.png"));

  // ═══ Step 3: Restart (simulating exit from conversation page) ═══
  console.log("\n── Step 3: Restart from conversation page ──");
  cdp.close();
  killOC(); await new Promise(r => setTimeout(r, 2000));
  spawn("D:\\OpenCode\\OpenCode.exe", [`--remote-debugging-port=${PORT}`], { detached: true, stdio: "ignore" }).unref();
  if (!await waitCdp(PORT)) { console.error("CDP timeout"); return; }
  await new Promise(r => setTimeout(r, 3000));
  t = await findTarget(PORT);
  if (!t) { console.error("No target"); return; }
  cdp = new Cdp(t.webSocketDebuggerUrl);
  await cdp.open();
  await injectSkin(cdp);
  await new Promise(r => setTimeout(r, 500));

  // Check state immediately after injection
  state = await getPageState(cdp);
  console.log(`  [immediate] isHome=${state.isHome} dreamHome=${state.hasDreamHome} activeHome=${state.hasActiveHome}`);
  console.log(`  [immediate] bg=${state.mainBgColor}`);
  await cdp.screenshot(path.join(outDir, "nav-step3-after-restart-immediate.png"));

  // ═══ Step 4: Wait for periodic poll and check again ═══
  console.log("\n── Step 4: Wait 1s for periodic poll ──");
  await new Promise(r => setTimeout(r, 1500));
  state = await getPageState(cdp);
  console.log(`  [after poll] isHome=${state.isHome} dreamHome=${state.hasDreamHome} activeHome=${state.hasActiveHome}`);
  console.log(`  [after poll] bg=${state.mainBgColor}`);
  await cdp.screenshot(path.join(outDir, "nav-step4-after-poll.png"));

  // ═══ Step 5: Navigate to new session tab ═══
  console.log("\n── Step 5: Navigate to new session ──");
  await navigateToNewSession(cdp);
  await new Promise(r => setTimeout(r, 1000)); // wait for poll to detect

  state = await getPageState(cdp);
  console.log(`  isHome=${state.isHome} dreamHome=${state.hasDreamHome} activeHome=${state.hasActiveHome}`);
  console.log(`  bg=${state.mainBgColor}`);
  await cdp.screenshot(path.join(outDir, "nav-step5-new-session.png"));

  // ═══ Step 6: Wait longer for poll ═══
  console.log("\n── Step 6: Wait 2s more for poll ──");
  await new Promise(r => setTimeout(r, 2000));
  state = await getPageState(cdp);
  console.log(`  [final] isHome=${state.isHome} dreamHome=${state.hasDreamHome} activeHome=${state.hasActiveHome}`);
  console.log(`  [final] bg=${state.mainBgColor}`);
  await cdp.screenshot(path.join(outDir, "nav-step6-final.png"));

  // ═══ Report ═══
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  Screenshots: ${outDir}`);
  console.log(`  Compare nav-step5-new-session.png with nav-step1-home.png`);
  console.log(`${"═".repeat(70)}\n`);

  cdp.close();
  killOC();
}

main().catch(e => { console.error("Fatal:", e); process.exit(2); });
