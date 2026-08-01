// 全流程性能监控：双击 lnk → OpenCode → CDP → 注入 → 页面交互
// 测量：各阶段耗时 + 页面内 Long Task（卡顿的直接证据）+ 自动截图
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";

const PORT = 9335;
const OUT = "D:/code/codex移植opencode/opencode-skin/windows/tests/.mock-test/perf-report";
fs.mkdirSync(OUT, { recursive: true });

const log = (m) => { const line = `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${m}`; console.log(line); fs.appendFileSync(`${OUT}/timeline.txt`, line + "\n"); };
const t0 = Date.now();
const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";

// ── 1. 清理旧进程 ──
try { execFileSync("taskkill", ["/IM", "OpenCode.exe", "/F"], { stdio: "ignore" }); } catch {}
await sleep(3000);
log(`[t=${elapsed()}] 旧 OpenCode 已清理`);

// ── 2. 通过桌面 lnk 启动（等价双击）──
const ws = spawn("powershell", ["-NoProfile", "-Command", "(New-Object -ComObject WScript.Shell).Run('C:\\Users\\26859\\Desktop\\OpenCode.lnk', 1, $false)"], { stdio: "ignore" });
log(`[t=${elapsed()}] 已触发桌面图标双击`);
const procT = Date.now();

// ── 3. 轮询观察：进程出现 / CDP 就绪 / image-server / 页面 target ──
let procSeen = null, cdpReady = null, imgReady = null, targetSeen = null;
const seen = new Set();
const check = async () => {
  // OpenCode 进程
  if (!procSeen) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(800) });
      if (r.ok) { procSeen = Date.now(); cdpReady = procSeen; log(`[t=${elapsed()}] CDP 就绪（进程+CDP 同刻出现）`); }
    } catch {}
  }
  // image-server
  if (!imgReady) {
    try {
      const r = await fetch("http://127.0.0.1:18765/skin-image", { signal: AbortSignal.timeout(800) });
      if (r.ok) { imgReady = Date.now(); log(`[t=${elapsed()}] image-server 就绪 (HTTP ${r.status})`); }
    } catch {}
  }
  // 页面 target
  if (!targetSeen) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(800) });
      const list = await r.json();
      const page = list.find((t) => t.type === "page" && t.url?.startsWith("oc://"));
      if (page) { targetSeen = Date.now(); log(`[t=${elapsed()}] oc:// 页面出现: ${page.url}`); return page; }
    } catch {}
  }
  return null;
};

let page = null;
while (Date.now() - t0 < 60000) {
  page = await check();
  if (page && imgReady && cdpReady) break;
  await sleep(300);
}

if (!page) { log("❌ 60s 内页面未出现"); process.exit(1); }

// ── 4. 连接页面，注入 Long Task 监听 + 性能指标 ──
log(`[t=${elapsed()}] 连接页面 WebSocket，注入监控...`);
const wsCdp = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
wsCdp.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r, j) => { wsCdp.addEventListener("open", r, { once: true }); wsCdp.addEventListener("error", j, { once: true }); setTimeout(() => j(new Error("ws timeout")), 4000); });
const send = (method, params = {}) => new Promise((resolve) => {
  const i = ++msgId; pending.set(i, resolve);
  wsCdp.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); resolve(null); } }, 5000);
});

// 页面 load 状态 + 注入 PerformanceObserver 记录 longtask
const INJECT_OBSERVER = `
(() => {
  if (window.__ltObs) return;
  window.__ltObs = { tasks: [] };
  new PerformanceObserver((list) => {
    list.getEntries().forEach((e) => window.__ltObs.tasks.push({
      start: Math.round(e.startTime), dur: Math.round(e.duration), name: e.name
    }));
  }).observe({ entryTypes: ['longtask'] });
  // 同时记录导航/资源时间
  window.__ltObs.nav = performance.getEntriesByType('navigation')[0]?.toJSON?.() ?? null;
  window.__ltObs.resources = performance.getEntriesByType('resource').map(r => ({ name: r.name.slice(-60), dur: Math.round(r.duration), size: r.transferSize })).sort((a,b) => b.dur - a.dur).slice(0, 15);
})(); 'ok'
`;
await send("Runtime.evaluate", { expression: INJECT_OBSERVER, returnByValue: true });
log(`[t=${elapsed()}] Long Task 监听已注入`);

// ── 5. 轮询采集：皮肤状态 + longtask + 交互响应时间（测量"卡顿"）──
// 交互响应测试：执行一个轻量 JS，测量从发起到返回的往返时间
const skinCheck = `JSON.stringify({ installed: document.documentElement.classList.contains('opencode-dream-skin'), state: !!window.__OPENCODE_DREAM_SKIN_STATE__, content: !!document.querySelector('[data-component="prompt-input-v2"]'), ready: document.readyState })`;
const ltCollect = `JSON.stringify({ tasks: window.__ltObs?.tasks ?? [], nav: window.__ltObs?.nav, resources: window.__ltObs?.resources ?? [] })`;

let lastSkin = null;
const ltAll = [];
for (let i = 0; i < 30; i++) {
  await sleep(2000);
  const t = Date.now();
  const r = await send("Runtime.evaluate", { expression: skinCheck, returnByValue: true });
  const rtt = Date.now() - t;
  if (!r) { log(`[t=${elapsed()}] ⚠️ evaluate 超时（渲染进程可能被阻塞！）`); continue; }
  const v = JSON.parse(r.result?.result?.value ?? "null");
  const changed = lastSkin !== v?.installed ? " ◀ 变化" : "";
  lastSkin = v?.installed;
  log(`[t=${elapsed()}] RTT=${rtt}ms installed=${v?.installed} content=${v?.content} ready=${v?.ready}${changed}`);

  // 采集 longtask（每 6 秒）
  if (i % 3 === 0) {
    const lt = await send("Runtime.evaluate", { expression: ltCollect, returnByValue: true });
    if (lt?.result?.result?.value) {
      const d = JSON.parse(lt.result.result.value);
      if (d.tasks?.length) { ltAll.push(...d.tasks); log(`[t=${elapsed()}]   发现 ${d.tasks.length} 个 Long Task，最长 ${Math.max(...d.tasks.map(x => x.dur))}ms`); }
      if (d.nav) log(`[t=${elapsed()}]   domContentLoaded=${Math.round(d.nav.domContentLoadedEventEnd)}ms loadEvent=${Math.round(d.nav.loadEventEnd)}ms`);
      if (d.resources?.length) d.resources.slice(0,5).forEach(res => log(`[t=${elapsed()}]   资源 ${res.name} = ${res.dur}ms (${res.size} bytes)`));
    }
  }

  // 截图（第 2、8、14 次采样）
  if (i === 1 || i === 7 || i === 13) {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    if (shot?.result?.data) {
      fs.writeFileSync(`${OUT}/shot-${i}.png`, Buffer.from(shot.result.data, "base64"));
      log(`[t=${elapsed()}] 截图已保存 shot-${i}.png`);
    }
  }

  // 皮肤注入成功且页面稳定后结束
  if (v?.installed && v?.content && i > 6) break;
}
wsCdp.close();

// ── 6. 汇总报告 ──
log("\n════════ 性能汇总 ════════");
log(`启动到 CDP 就绪: ${cdpReady ? ((cdpReady - t0)/1000).toFixed(1) : "?"}s`);
log(`启动到 image-server: ${imgReady ? ((imgReady - t0)/1000).toFixed(1) : "?"}s`);
log(`启动到页面出现: ${targetSeen ? ((targetSeen - t0)/1000).toFixed(1) : "?"}s`);
if (ltAll.length) {
  const total = ltAll.reduce((a, b) => a + b.dur, 0);
  const longest = ltAll.reduce((a, b) => (a.dur > b.dur ? a : b));
  log(`Long Task 总数: ${ltAll.length} 个，总阻塞 ${(total/1000).toFixed(1)}s，最长单个 ${longest.dur}ms (${longest.name})`);
} else {
  log("Long Task: 未捕获（页面可能已稳定）");
}
log(`报告目录: ${OUT}`);
process.exit(0);
