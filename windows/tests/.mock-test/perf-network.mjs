// 实验：追踪主界面渲染期间的所有网络请求（找"等什么"）
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";

const PORT = 9335;
const OUT = "D:/code/codex移植opencode/opencode-skin/windows/tests/.mock-test/perf-report";
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
const log = (m) => { console.log(`[t=${elapsed()}] ${m}`); fs.appendFileSync(`${OUT}/network-trace.txt`, `[t=${elapsed()}] ${m}\n`); };

try { execFileSync("taskkill", ["/IM", "OpenCode.exe", "/F"], { stdio: "ignore" }); } catch {}
await sleep(3000);
log("旧 OpenCode 已清理");

// 无皮肤直接启动（隔离皮肤变量）
spawn("D:/OpenCode/OpenCode.exe", [`--remote-debugging-port=${PORT}`], { detached: true, stdio: "ignore" }).unref();
log("OpenCode 已启动（无皮肤）");

// 等 CDP
while (Date.now() - t0 < 60000) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(800) }); if (r.ok) break; } catch {}
  await sleep(300);
}
log(`CDP 就绪 ${elapsed()}`);

// 等页面并连接
let page = null;
while (Date.now() - t0 < 90000) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(800) });
    page = (await r.json()).find((t) => t.type === "page" && t.url?.startsWith("oc://"));
    if (page) break;
  } catch {}
  await sleep(300);
}
if (!page) { log("❌ 页面未出现"); process.exit(1); }
log(`页面出现 ${elapsed()}，连接并开启 Network 追踪`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const events = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Network.requestWillBeSent") {
    events.push({ kind: "req", ts: Date.now() - t0, url: m.params.request.url, method: m.params.request.method });
  }
  if (m.method === "Network.responseReceived") {
    events.push({ kind: "resp", ts: Date.now() - t0, url: m.params.response.url, status: m.params.response.status });
  }
  if (m.method === "Network.loadingFailed") {
    events.push({ kind: "fail", ts: Date.now() - t0, url: m.params.requestId, error: m.params.errorText });
  }
});
await new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); setTimeout(() => j(new Error("t")), 4000); });
const send = (method, params = {}) => new Promise((resolve) => {
  const i = ++msgId; pending.set(i, resolve);
  ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); resolve(null); } }, 4000);
});
await send("Network.enable");
log("Network 追踪已开启，等待主界面就绪...");

// 轮询主界面 + 每 3s 打印新请求
const EXPR = `JSON.stringify({ content: !!document.querySelector('[data-component="prompt-input-v2"], [data-component="session-prompt-dock"]') })`;
let contentAt = null;
let lastPrinted = 0;
while (Date.now() - t0 < 90000) {
  if (!contentAt) {
    const r = await send("Runtime.evaluate", { expression: EXPR, returnByValue: true });
    const v = r?.result?.result?.value ? JSON.parse(r.result.result.value) : null;
    if (v?.content) { contentAt = Date.now(); log(`★★ 主界面就绪 ${elapsed()}`); }
  }
  // 打印新事件
  const now = Date.now() - t0;
  if (events.length > lastPrinted) {
    for (let i = lastPrinted; i < events.length; i++) {
      const e = events[i];
      const url = e.url.length > 90 ? e.url.slice(0, 90) + "…" : e.url;
      if (e.kind === "req") log(`  REQ  ${e.method} ${url}`);
      else if (e.kind === "resp") log(`  RESP ${e.status} ${url}`);
      else log(`  FAIL ${e.error} ${url}`);
    }
    lastPrinted = events.length;
  }
  if (contentAt) break;
  await sleep(500);
}
ws.close();
log("\n════ 网络请求汇总 ════");
const reqs = events.filter((e) => e.kind === "req");
log(`总请求数: ${reqs.length}`);
const fails = events.filter((e) => e.kind === "fail");
log(`失败数: ${fails.length}`);
fails.slice(0, 10).forEach((f) => log(`  ❌ ${f.error} (t=${(f.ts / 1000).toFixed(1)}s)`));
process.exit(0);
