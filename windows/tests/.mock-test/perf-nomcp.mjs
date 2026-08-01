// 因果实验2：禁用 MCP → 主界面就绪时间是否缩短？
// 方法：临时把 opencode.json 的 mcp 置空，启动测试，然后恢复
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";

const PORT = 9335;
const CFG = "C:/Users/26859/.config/opencode/opencode.json";
const t0 = Date.now();
const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
const log = (m) => console.log(`t=${elapsed()} ${m}`);

// 备份并禁用 MCP
const orig = fs.readFileSync(CFG, "utf8");
const noMcp = orig.replace(/"mcp"\s*:\s*\{[^}]*\}[^,]*/s, '"mcp": {}');
fs.writeFileSync(CFG, noMcp);
log("已临时禁用 MCP 配置");

try { execFileSync("taskkill", ["/IM", "OpenCode.exe", "/F"], { stdio: "ignore" }); } catch {}
await sleep(4000);

spawn("D:/OpenCode/OpenCode.exe", [`--remote-debugging-port=${PORT}`], { detached: true, stdio: "ignore" }).unref();
log("OpenCode 已启动（无 MCP）");

let cdpAt = null;
while (Date.now() - t0 < 60000) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(800) }); if (r.ok) { cdpAt = Date.now(); break; } } catch {}
  await sleep(300);
}
log(`CDP 就绪: ${((cdpAt - t0) / 1000).toFixed(1)}s`);

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

// 恢复配置
fs.writeFileSync(CFG, orig);
log("已恢复 MCP 配置");
log(`═══ 无 MCP 结果: CDP=${((cdpAt - t0) / 1000).toFixed(1)}s 主界面=${contentAt ? ((contentAt - t0) / 1000).toFixed(1) : "?"}s ═══`);
process.exit(0);
