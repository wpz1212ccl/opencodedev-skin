// 对照实验 B：OpenCode + CDP（无皮肤注入）——测基线启动与主界面渲染时间
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";

const PORT = 9335;
const OUT = "D:/code/codex移植opencode/opencode-skin/windows/tests/.mock-test/perf-report";
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
const log = (m) => { console.log(`[t=${elapsed()}] ${m}`); fs.appendFileSync(`${OUT}/baseline-no-skin.txt`, `[t=${elapsed()}] ${m}\n`); };

try { execFileSync("taskkill", ["/IM", "OpenCode.exe", "/F"], { stdio: "ignore" }); } catch {}
await sleep(3000);
log("旧 OpenCode 已清理");

// 直接启动 OpenCode（带 CDP，不经过 start.ps1，不注入皮肤）
spawn("D:/OpenCode/OpenCode.exe", [`--remote-debugging-port=${PORT}`], { detached: true, stdio: "ignore" }).unref();
log("OpenCode 已启动（仅 CDP 参数，无皮肤）");

// 等待 CDP
let cdpAt = null;
while (Date.now() - t0 < 60000) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(800) }); if (r.ok) { cdpAt = Date.now(); break; } } catch {}
  await sleep(300);
}
log(`CDP 就绪: ${cdpAt ? ((cdpAt - t0) / 1000).toFixed(1) : "?"}s`);

// 等待页面 target，轮询 prompt-input 出现时间（主界面就绪标志）
let pageAt = null, contentAt = null;
const check = async () => {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(800) });
    const list = await r.json();
    const page = list.find((t) => t.type === "page" && t.url?.startsWith("oc://"));
    if (page) return page;
  } catch {}
  return null;
};

let wsCdp = null;
const send = (method, params = {}) => new Promise((resolve) => {
  if (!wsCdp) return resolve(null);
  const id = Math.floor(Math.random() * 1e9);
  const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { wsCdp.removeEventListener("message", h); resolve(m); } };
  wsCdp.addEventListener("message", h);
  wsCdp.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { wsCdp.removeEventListener("message", h); resolve(null); }, 5000);
});

const EXPR = `JSON.stringify({ content: !!document.querySelector('[data-component="prompt-input-v2"], [data-component="session-prompt-dock"]'), ready: document.readyState, tabs: document.querySelectorAll('[role="tab"]').length })`;

while (Date.now() - t0 < 90000) {
  const page = await check();
  if (page && !pageAt) {
    pageAt = Date.now();
    log(`oc:// 页面出现: ${((pageAt - t0) / 1000).toFixed(1)}s`);
    wsCdp = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { wsCdp.addEventListener("open", r, { once: true }); wsCdp.addEventListener("error", j, { once: true }); setTimeout(() => j(new Error("t")), 4000); }).catch(() => {});
    log("已连接页面");
  }
  if (wsCdp && !contentAt) {
    const r = await send("Runtime.evaluate", { expression: EXPR, returnByValue: true });
    const v = r?.result?.result?.value ? JSON.parse(r.result.result.value) : null;
    if (v?.content) { contentAt = Date.now(); log(`主界面就绪（输入框出现）: ${((contentAt - t0) / 1000).toFixed(1)}s`); }
  }
  if (contentAt) break;
  await sleep(500);
}

if (wsCdp) wsCdp.close();
log("\n════════ 基线（无皮肤）════════");
log(`CDP 就绪: ${cdpAt ? ((cdpAt - t0) / 1000).toFixed(1) : "?"}s`);
log(`页面出现: ${pageAt ? ((pageAt - t0) / 1000).toFixed(1) : "?"}s`);
log(`主界面就绪: ${contentAt ? ((contentAt - t0) / 1000).toFixed(1) : "90s 内未就绪"}s`);
process.exit(0);
