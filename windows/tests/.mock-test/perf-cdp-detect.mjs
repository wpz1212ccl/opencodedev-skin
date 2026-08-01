// 实验：start.ps1 报告 CDP ready 的时刻 vs node 探测真实 CDP 就绪时刻
// 验证 Wait-OpenCodeReady 的 Invoke-WebRequest 是否虚报延迟
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";

const PORT = 9335;
const OUT = "D:/code/codex移植opencode/opencode-skin/windows/tests/.mock-test/perf-report";
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const elapsed = () => ((Date.now() - t0) / 1000).toFixed(2) + "s";
const log = (m) => { console.log(`[t=${elapsed()}] ${m}`); fs.appendFileSync(`${OUT}/cdp-detection.txt`, `[t=${elapsed()}] ${m}\n`); };

try { execFileSync("taskkill", ["/IM", "OpenCode.exe", "/F"], { stdio: "ignore" }); } catch {}
await sleep(3000);
log("旧 OpenCode 已清理");

// 启动 start.ps1（完整链路），捕获其输出
const ps = spawn("powershell", [
  "-NoProfile", "-ExecutionPolicy", "Bypass",
  "-File", "D:\\oc-skin\\windows\\scripts\\start.ps1",
  "-OpenCodePath", "D:\\OpenCode\\OpenCode.exe",
  "-CdpPort", "9335", "-NoTray",
], { stdio: ["ignore", "pipe", "pipe"] });
let psOut = "";
ps.stdout.on("data", (d) => psOut += d);
ps.stderr.on("data", (d) => psOut += d);

// node 侧高频探测真实 CDP 就绪时刻（每 100ms）
let nodeSeen = null;
const probe = async () => {
  while (!nodeSeen) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(300) });
      if (r.ok) { nodeSeen = Date.now(); log(`【node 探测】CDP 真实就绪: ${elapsed()}`); break; }
    } catch {}
    await sleep(100);
  }
};
probe();

// 等待 start.ps1 输出 "CDP is ready"
const waitPs = async () => {
  while (Date.now() - t0 < 60000) {
    if (psOut.includes("CDP is ready")) {
      log(`【start.ps1】报告 CDP ready: ${elapsed()}`);
      return;
    }
    if (psOut.includes("CDP did not become ready")) { log("start.ps1 报告超时失败"); return; }
    await sleep(100);
  }
};
await Promise.all([probe(), waitPs()]);
await sleep(5000); // 等注入完成看后续输出

log("\n── start.ps1 完整输出 ──");
psOut.split("\n").forEach((l) => l.trim() && log("  " + l.trim()));
process.exit(0);
