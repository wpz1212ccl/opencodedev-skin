// 控制变量对照：同一环境交替测 无皮肤 vs 有皮肤 的主界面就绪时间
// 用法: node perf-compare.mjs bare|skin
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";

const PORT = 9335;
const mode = process.argv[2] || "bare";
const OUT = "D:/code/codex移植opencode/opencode-skin/windows/tests/.mock-test/perf-report";
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
const log = (m) => { console.log(`[${mode}] t=${elapsed()} ${m}`); fs.appendFileSync(`${OUT}/compare-${mode}.txt`, `t=${elapsed()} ${m}\n`); };

try { execFileSync("taskkill", ["/IM", "OpenCode.exe", "/F"], { stdio: "ignore" }); } catch {}
await sleep(4000);
log("旧 OpenCode 已清理");

if (mode === "skin") {
  // 完整链路：通过 start.ps1（含注入）
  const ps = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", "D:\\oc-skin\\windows\\scripts\\start.ps1",
    "-OpenCodePath", "D:\\OpenCode\\OpenCode.exe", "-CdpPort", "9335", "-NoTray"],
    { stdio: ["ignore", "pipe", "pipe"] });
  ps.stdout.on("data", () => {});
  log("start.ps1 已启动（完整链路）");
} else {
  // 裸启动：只有 CDP 参数
  spawn("D:/OpenCode/OpenCode.exe", [`--remote-debugging-port=${PORT}`], { detached: true, stdio: "ignore" }).unref();
  log("OpenCode 裸启动（无皮肤）");
}

// 等待 CDP
let cdpAt = null;
while (Date.now() - t0 < 60000) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(800) }); if (r.ok) { cdpAt = Date.now(); break; } } catch {}
  await sleep(300);
}
log(`CDP 就绪: ${((cdpAt - t0) / 1000).toFixed(1)}s`);

// 等页面 + 主界面就绪
let pageAt = null, contentAt = null, wsCdp = null;
const send = (method, params = {}) => new Promise((resolve) => {
  if (!wsCdp) return resolve(null);
  const id = Math.floor(Math.random() * 1e9);
  const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { wsCdp.removeEventListener("message", h); resolve(m); } };
  wsCdp.addEventListener("message", h);
  wsCdp.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { wsCdp.removeEventListener("message", h); resolve(null); }, 4000);
});
const EXPR = `JSON.stringify({ content: !!document.querySelector('[data-component="prompt-input-v2"], [data-component="session-prompt-dock"]'), skin: !!document.getElementById('opencode-dream-skin-style') })`;

while (Date.now() - t0 < 90000) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(800) });
    const page = (await r.json()).find((t) => t.type === "page" && t.url?.startsWith("oc://"));
    if (page && !pageAt) {
      pageAt = Date.now();
      log(`页面出现: ${((pageAt - t0) / 1000).toFixed(1)}s`);
      wsCdp = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { wsCdp.addEventListener("open", res, { once: true }); wsCdp.addEventListener("error", rej, { once: true }); setTimeout(() => rej(new Error("t")), 4000); }).catch(() => {});
    }
  } catch {}
  if (wsCdp && !contentAt) {
    const r = await send("Runtime.evaluate", { expression: EXPR, returnByValue: true });
    const v = r?.result?.result?.value ? JSON.parse(r.result.result.value) : null;
    if (v?.content) { contentAt = Date.now(); log(`★★ 主界面就绪: ${((contentAt - t0) / 1000).toFixed(1)}s skin=${v.skin}`); break; }
  }
  await sleep(500);
}
if (wsCdp) wsCdp.close();
log(`\n═══ ${mode} 结果: CDP=${((cdpAt - t0) / 1000).toFixed(1)}s 页面=${pageAt ? ((pageAt - t0) / 1000).toFixed(1) : "?"}s 主界面=${contentAt ? ((contentAt - t0) / 1000).toFixed(1) : "?"}s ═══`);
process.exit(0);
