// 因果实验：让更新检查立即失败（HTTPS_PROXY=无效端口）→ 主界面是否提前？
// 对比对照组（无代理，更新检查 21s 超时）
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 9335;
const mode = process.argv[2] || "control"; // control | noproxy-update
const t0 = Date.now();
const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
const log = (m) => console.log(`[${mode}] t=${elapsed()} ${m}`);

try { execFileSync("taskkill", ["/IM", "OpenCode.exe", "/F"], { stdio: "ignore" }); } catch {}
await sleep(4000);
log("已清理");

// 启动 OpenCode，环境变量控制更新检查行为
const env = { ...process.env };
if (mode === "noproxy-update") {
  // 让所有 https 请求立即失败（连接被拒），更新检查秒失败
  env.HTTPS_PROXY = "http://127.0.0.1:9";
  env.HTTP_PROXY = "http://127.0.0.1:9";
  log("已设置 HTTPS_PROXY=127.0.0.1:9（更新检查将立即失败）");
} else {
  log("对照组：正常环境（更新检查 21s 超时）");
}
spawn("D:/OpenCode/OpenCode.exe", [`--remote-debugging-port=${PORT}`], { detached: true, stdio: "ignore", env }).unref();
log("OpenCode 已启动");

// 测 CDP 就绪
let cdpAt = null;
while (Date.now() - t0 < 60000) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(800) }); if (r.ok) { cdpAt = Date.now(); break; } } catch {}
  await sleep(300);
}
log(`CDP 就绪: ${((cdpAt - t0) / 1000).toFixed(1)}s`);

// 等页面 + 主界面
let pageAt = null, contentAt = null, wsCdp = null;
const send = (method, params = {}) => new Promise((resolve) => {
  if (!wsCdp) return resolve(null);
  const id = Math.floor(Math.random() * 1e9);
  const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { wsCdp.removeEventListener("message", h); resolve(m); } };
  wsCdp.addEventListener("message", h);
  wsCdp.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { wsCdp.removeEventListener("message", h); resolve(null); }, 4000);
});
const EXPR = `JSON.stringify({ content: !!document.querySelector('[data-component="prompt-input-v2"], [data-component="session-prompt-dock"]') })`;

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
    if (v?.content) { contentAt = Date.now(); log(`★★ 主界面就绪: ${((contentAt - t0) / 1000).toFixed(1)}s`); break; }
  }
  await sleep(500);
}
if (wsCdp) wsCdp.close();
log(`═══ ${mode} 结果: CDP=${((cdpAt - t0) / 1000).toFixed(1)}s 页面=${pageAt ? ((pageAt - t0) / 1000).toFixed(1) : "?"}s 主界面=${contentAt ? ((contentAt - t0) / 1000).toFixed(1) : "?"}s ═══`);
process.exit(0);
