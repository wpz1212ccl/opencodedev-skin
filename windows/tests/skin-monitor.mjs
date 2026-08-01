#!/usr/bin/env node
/**
 * skin-monitor.mjs — OpenCode Dream Skin 注入监控 + 启动性能基准
 *
 * 监控对象：双击桌面图标(OpenCode.lnk) → start.ps1 → OpenCode + image-server + injector 注入皮肤
 * 注册成功判定：与 injector.mjs 的 verifySession 完全一致 ——
 *   html 有 opencode-dream-skin class
 *   window.__OPENCODE_DREAM_SKIN_STATE__.version === "2.0.0"
 *   #opencode-dream-skin-style 存在
 *   输入框元素 [data-component="prompt-input-v2"|...] 存在
 *
 * 用法：
 *   node skin-monitor.mjs bench                 # 性能基准：提示后请双击桌面图标
 *   node skin-monitor.mjs bench --auto          # 脚本自动通过桌面图标启动（等价双击）
 *   node skin-monitor.mjs bench --auto --runs 5 # 多轮基准 + 统计（自动开关 OpenCode）
 *   node skin-monitor.mjs watch                 # 持续监看注入注册状态（Ctrl+C 退出）
 *   node skin-monitor.mjs status                # 一次性检查当前注入状态
 *
 * 选项：
 *   --port <n>        CDP 端口（默认 9335）
 *   --image-port <n>  image-server 端口（默认 18765）
 *   --timeout <s>     每轮等待超时秒数（默认 90）
 *   --runs <n>        基准轮数（默认 1）
 *   --auto            通过桌面图标 lnk 自动启动 OpenCode
 *   --force           自动关闭正在运行的 OpenCode（多轮基准必需）
 *   --lnk <path>      桌面图标路径（默认 %USERPROFILE%\Desktop\OpenCode.lnk）
 *   --out <dir>       结果输出目录（默认 <脚本目录>/results）
 *   --no-art          不等待壁纸加载阶段（主指标仍是皮肤注册）
 */

import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// ───────────────────────── 常量 ─────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKIN_VERSION = "2.0.0"; // 与 injector.mjs 保持一致
const POLL_MS = 100;           // 主轮询间隔
const DEFAULT_LNK = path.join(os.homedir(), "Desktop", "OpenCode.lnk");
const APP_PROCESS = "OpenCode.exe";

// 注册判定表达式（与 injector.mjs verifySession 等价，返回 JSON 字符串）
const VERIFY_EXPR = `(() => {
  const state = window.__OPENCODE_DREAM_SKIN_STATE__;
  const composer = document.querySelector(
    '[data-component="prompt-input-v2"], [data-component="session-prompt-dock"], [data-component="prompt-input"]');
  return JSON.stringify({
    installed: document.documentElement.classList.contains('opencode-dream-skin'),
    version: state?.version ?? null,
    stylePresent: !!document.getElementById('opencode-dream-skin-style'),
    chromePresent: !!document.getElementById('opencode-dream-skin-chrome'),
    homePresent: !!document.querySelector('.dream-home'),
    composer: !!composer,
    art: getComputedStyle(document.documentElement).getPropertyValue('--dream-art').trim(),
  });
})()`;

// ───────────────────────── CLI 解析 ─────────────────────────

function parseArgs(argv) {
  const opt = {
    command: "bench", port: 9335, imagePort: 18765, timeoutSec: 90,
    runs: 1, auto: false, force: false, lnk: DEFAULT_LNK, out: null, noArt: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") opt.port = Number(argv[++i]);
    else if (a === "--image-port") opt.imagePort = Number(argv[++i]);
    else if (a === "--timeout") opt.timeoutSec = Number(argv[++i]);
    else if (a === "--runs") opt.runs = Number(argv[++i]);
    else if (a === "--auto") opt.auto = true;
    else if (a === "--force") opt.force = true;
    else if (a === "--lnk") opt.lnk = argv[++i];
    else if (a === "--out") opt.out = path.resolve(argv[++i]);
    else if (a === "--no-art") opt.noArt = true;
    else if (a.startsWith("-")) { console.error(`未知参数: ${a}`); process.exit(2); }
    else positional.push(a);
  }
  if (positional.length) opt.command = positional[0];
  if (!["bench", "watch", "status"].includes(opt.command)) {
    console.error(`未知命令: ${opt.command}（支持 bench / watch / status）`); process.exit(2);
  }
  opt.outDir = opt.out || path.join(HERE, "results");
  return opt;
}

// ───────────────────────── 工具函数 ─────────────────────────

const PS_PREFIX = "[Console]::OutputEncoding=[Text.Encoding]::UTF8;";

function runPs(script, timeoutMs = 8000) {
  try {
    return execFileSync("powershell", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", PS_PREFIX + script,
    ], { encoding: "utf8", timeout: timeoutMs, windowsHide: true }).trim();
  } catch {
    return "";
  }
}

function isOpenCodeRunning() {
  try {
    const out = execFileSync("tasklist", ["/FI", `IMAGENAME eq ${APP_PROCESS}`, "/FO", "CSV", "/NH"],
      { encoding: "utf8", timeout: 3000, windowsHide: true });
    return out.includes(APP_PROCESS);
  } catch { return false; }
}

function getOpenCodePids() {
  const out = runPs('Get-Process OpenCode -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }', 5000);
  return out.split(/\s+/).map((s) => parseInt(s, 10)).filter((n) => n > 0);
}

function killOpenCode() {
  const pids = getOpenCodePids();
  if (pids.length === 0) return;
  runPs('Get-Process OpenCode -ErrorAction SilentlyContinue | Stop-Process -Force', 8000);
}

// 查找 node 进程中含指定关键字的命令行（用于定位 injector / image-server）
// 返回 [{ pid, cmd }]，cmd 用于诊断（如发现多个 injector 可能端口冲突）
function findNodeProcess(keyword) {
  const out = runPs(
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ` +
    `Where-Object { $_.CommandLine -like '*${keyword}*' } | ForEach-Object { \"$($_.ProcessId)|$($_.CommandLine)\" }`, 6000);
  return out.split(/\r?\n/).map((line) => {
    const idx = line.indexOf("|");
    if (idx < 0) return null;
    const pid = parseInt(line.slice(0, idx), 10);
    return pid > 0 ? { pid, cmd: line.slice(idx + 1) } : null;
  }).filter(Boolean);
}

async function httpOk(url, timeoutMs = 1500) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { method: "HEAD", signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch { return false; }
}

async function getTargets(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

function findOpenCodeTarget(targets) {
  return targets.find((t) => t.type === "page" && t.url?.startsWith("oc://"));
}

// ───────────────────────── CDP 会话 ─────────────────────────

class CdpSession {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    // 处理收到的 CDP 回复，resolve 对应的挂起请求
    this.ws.addEventListener("message", (event) => this.onMessage(event));
    // 连接意外断开时立即失败所有挂起请求，避免长时间挂起
    this.ws.addEventListener("close", () => this.failAll(new Error("CDP 连接已关闭")));
    this.ws.addEventListener("error", () => this.failAll(new Error("CDP 连接错误")));
  }

  onMessage(event) {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg?.id && this.pending.has(msg.id)) {
      const waiter = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(waiter.timer);
      waiter.resolve(msg);
    }
  }

  failAll(err) {
    this.closed = true;
    for (const [id, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
    this.pending.clear();
  }

  open(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { try { this.ws.close(); } catch {} reject(new Error("CDP 连接超时")); }, timeoutMs);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP 连接失败")); }, { once: true });
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (this.closed) { reject(new Error("CDP 连接已关闭")); return; }
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} 超时`)); }, 5000);
      this.pending.set(id, { timer, resolve, reject });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }

  async evaluate(expression) {
    const msg = await this.send("Runtime.evaluate", { expression, returnByValue: true });
    if (msg.result?.exceptionDetails) throw new Error("页面执行异常");
    return msg.result?.result?.value;
  }

  close() { try { this.ws.close(); } catch {} }
}

// ───────────────────────── 注册状态查询 ─────────────────────────

async function querySkinState(target, session) {
  const raw = await session.evaluate(VERIFY_EXPR);
  return JSON.parse(raw);
}

function isRegistered(v) {
  return Boolean(v.installed && v.version === SKIN_VERSION && v.stylePresent && v.composer);
}

// 连接 oc:// 目标并返回 { target, session }，失败返回 null
// 带节流：失败后 retryDelayMs 内不重试，避免 CDP 未就绪时每 tick 空等超时
let lastConnectFailAt = 0;
let connectRetryDelayMs = 0;

async function connectTarget(port, retryDelayMs = 1000) {
  const now = Date.now();
  if (now - lastConnectFailAt < connectRetryDelayMs) return null;
  const targets = await getTargets(port);
  const target = findOpenCodeTarget(targets);
  if (!target) return null;
  try {
    const session = new CdpSession(target.webSocketDebuggerUrl);
    await session.open(4000);
    connectRetryDelayMs = 0;
    return { target, session };
  } catch {
    lastConnectFailAt = Date.now();
    connectRetryDelayMs = retryDelayMs;
    return null;
  }
}

// ───────────────────────── 桌面图标启动 ─────────────────────────

function launchDesktopIcon(lnkPath) {
  if (!fs.existsSync(lnkPath)) {
    throw new Error(`桌面图标不存在: ${lnkPath}`);
  }
  // 通过 WScript.Shell 运行 .lnk —— 等价于资源管理器中双击
  const esc = lnkPath.replace(/'/g, "''");
  runPs(`$ws = New-Object -ComObject WScript.Shell; $ws.Run('${esc}', 1, $false)`, 8000);
}

// 等待 OpenCode 及其附属进程完全退出（最多 waitSec 秒）
async function waitAllExited(port, imagePort, waitSec = 20) {
  const deadline = Date.now() + waitSec * 1000;
  while (Date.now() < deadline) {
    const oc = isOpenCodeRunning();
    const cdp = await httpOk(`http://127.0.0.1:${port}/json/version`, 800);
    const img = await httpOk(`http://127.0.0.1:${imagePort}/skin-image`, 800);
    if (!oc && !cdp && !img) return true;
    await sleep(300);
  }
  return false;
}

// ───────────────────────── bench 单轮 ─────────────────────────

/**
 * 一轮基准测试。返回事件时间线（相对 t0）。
 * 时间线阶段：
 *   process       OpenCode 进程出现（= 双击生效的最早信号）
 *   cdp           CDP 端口 9335 就绪
 *   imageServer   image-server(:18765) 就绪
 *   injector      injector.mjs 进程出现（--once 短命进程，尽力捕获）
 *   target        oc:// 渲染页面 target 出现
 *   skin          皮肤注册成功（主指标终点）
 *   art           壁纸 --dream-art 生效（附加）
 */
async function benchOnce(opt, t0) {
  const events = [];
  const mark = (name, detail = "") => events.push({ name, at: Date.now() - t0, detail });
  mark("start");

  const deadline = Date.now() + opt.timeoutSec * 1000;
  const base = `http://127.0.0.1:${opt.port}`;
  const seen = { process: false, cdp: false, imageServer: false, injector: false, target: false, skin: false, art: false };
  let conn = null;            // { target, session }
  let lastCimAt = 0;          // injector 检测节流
  let skinState = null;

  while (Date.now() < deadline) {
    // 1. 进程出现
    if (!seen.process && isOpenCodeRunning()) {
      seen.process = true;
      mark("process", `PID=${getOpenCodePids().join(",")}`);
    }

    // 2. CDP 就绪
    if (!seen.cdp && await httpOk(`${base}/json/version`, 800)) {
      seen.cdp = true;
      mark("cdp");
    }

    // 3. image-server 就绪
    if (!seen.imageServer && await httpOk(`http://127.0.0.1:${opt.imagePort}/skin-image`, 800)) {
      seen.imageServer = true;
      mark("imageServer");
    }

    // 4. injector 进程出现（CIM 查询较重，节流到 500ms 一次）
    //    参考信息：--once 模式进程短命，可能捕获不到；若发现多个 injector 说明存在端口竞争
    if (!seen.injector && Date.now() - lastCimAt >= 500) {
      lastCimAt = Date.now();
      const procs = findNodeProcess("injector.mjs");
      if (procs.length) {
        seen.injector = true;
        const desc = procs.map((p) => {
          const idx = p.cmd.indexOf("injector.mjs");
          const short = idx > 0 ? `...${p.cmd.slice(Math.max(0, idx - 28), idx + 12)}` : p.cmd.slice(0, 50);
          return `${p.pid}(${short})`;
        }).join(", ");
        mark("injector", `PID=${desc}${procs.length > 1 ? "（多个 injector，注意端口竞争!）" : ""}`);
      }
    }

    // 5. oc:// target 出现
    if (!seen.target && seen.cdp) {
      const targets = await getTargets(opt.port);
      const target = findOpenCodeTarget(targets);
      if (target) { seen.target = true; mark("target", target.id); }
    }

    // 6. 皮肤注册成功（复用 injector 判定标准）
    if (!seen.skin) {
      if (!conn) conn = await connectTarget(opt.port, 500);
      if (conn) {
        try {
          skinState = await querySkinState(conn.target, conn.session);
          if (isRegistered(skinState)) {
            seen.skin = true;
            mark("skin", `version=${skinState.version}`);
          }
        } catch (err) {
          // 页面正在加载/上下文切换，关闭并稍后重连
          if (process.env.SKIN_MONITOR_DEBUG) {
            console.error(`[debug] skin 检测失败: ${err.message} (${Date.now() - t0}ms)`);
          }
          conn.session.close();
          conn = null;
          await sleep(300);
        }
      }
    }

    // 7. 壁纸生效（注册成功后最多再等 10 秒）
    if (seen.skin && !seen.art && !opt.noArt) {
      if (skinState?.art?.includes("url(")) {
        seen.art = true;
        mark("art");
      } else {
        const artDeadline = events.find((e) => e.name === "skin").at + 10000;
        if (Date.now() - t0 > artDeadline) {
          seen.art = true;
          mark("art", "FAIL: --dream-art 未生效");
        }
      }
    }

    if (seen.skin && (seen.art || opt.noArt)) break;
    await sleep(POLL_MS);
  }

  if (conn) conn.session.close();

  // 汇总结果
  const byName = Object.fromEntries(events.map((e) => [e.name, e]));
  const ok = seen.skin;
  return {
    ok,
    t0,
    events,
    byName,
    totalMs: byName.skin ? byName.skin.at : Date.now() - t0,
    skinState,
    missing: Object.entries(seen).filter(([, v]) => !v).map(([k]) => k),
  };
}

// ───────────────────────── 报告输出 ─────────────────────────

function printTimeline(r, title) {
  console.log("");
  console.log(`  ── ${title} ──`);
  const names = ["process", "cdp", "imageServer", "injector", "target", "skin", "art"];
  const labels = {
    process: "① OpenCode 进程出现", cdp: "② CDP 端口就绪", imageServer: "③ image-server 就绪",
    injector: "④ injector 进程出现", target: "⑤ oc:// 页面出现", skin: "⑥ 皮肤注册成功 ★", art: "⑦ 壁纸生效",
  };
  let prev = 0;
  for (const n of names) {
    const e = r.byName[n];
    if (!e) { console.log(`  · ${labels[n]} — 未观测到`); continue; }
    const delta = e.at - prev;
    prev = e.at;
    const icon = n === "skin" ? "✅" : (e.detail.startsWith("FAIL") ? "⚠️" : "✅");
    console.log(`  ${icon} ${labels[n]}  +${String(delta).padStart(6)}ms  (累计 ${String(e.at).padStart(7)}ms)  ${e.detail}`);
  }
}

function formatMs(ms) { return `${ms}ms`; }

function benchSummary(runs) {
  const ok = runs.filter((r) => r.ok);
  const times = ok.map((r) => r.totalMs);
  console.log("");
  console.log("  ── 多轮汇总 ──");
  if (times.length === 0) { console.log("  全部轮次失败"); return; }
  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))];
  console.log(`  成功 ${times.length}/${runs.length} 轮`);
  console.log(`  最快: ${formatMs(times[0])}   最慢: ${formatMs(times[times.length - 1])}   平均: ${formatMs(Math.round(avg))}   P95: ${formatMs(p95)}`);
  console.log("");
  times.forEach((t, i) => console.log(`  轮次 ${i + 1}: ${formatMs(t)}`));
}

// ───────────────────────── bench 主流程 ─────────────────────────

async function cmdBench(opt) {
  fs.mkdirSync(opt.outDir, { recursive: true });
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  OpenCode Dream Skin 启动性能基准（双击图标 → 注册成功）  ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`  CDP 端口: ${opt.port}   image-server: ${opt.imagePort}   超时: ${opt.timeoutSec}s   轮数: ${opt.runs}`);
  console.log(`  注册判定: class=opencode-dream-skin + state.version=${SKIN_VERSION} + style 节点 + 输入框`);
  console.log(`  桌面图标: ${opt.lnk}`);
  if (!fs.existsSync(opt.lnk)) {
    console.error(`\n❌ 桌面图标不存在: ${opt.lnk}\n   可用 --lnk 指定路径，或先运行 setup-autostart.ps1 创建。`);
    process.exit(1);
  }

  // 前置：处理正在运行的 OpenCode
  if (isOpenCodeRunning()) {
    if (!opt.force) {
      console.error("\n⚠️  OpenCode 正在运行。请先关闭它，或加 --force 让脚本自动关闭。");
      process.exit(1);
    }
    console.log("\n⏹  OpenCode 正在运行，自动关闭中...");
    killOpenCode();
    if (!(await waitAllExited(opt.port, opt.imagePort, 20))) {
      console.error("❌ 无法完全关闭 OpenCode 及其附属进程"); process.exit(1);
    }
    console.log("   ✓ 已完全退出");
    await sleep(1000);
  }

  const allRuns = [];
  for (let run = 1; run <= opt.runs; run++) {
    console.log(`\n════════════ 第 ${run}/${opt.runs} 轮 ════════════`);

    if (!opt.auto) {
      console.log("\n  👉 请现在双击桌面图标「OpenCode」...");
    } else {
      console.log("\n  🖱  模拟双击桌面图标...");
      try {
        launchDesktopIcon(opt.lnk);
      } catch (e) {
        console.error(`  ❌ 启动失败: ${e.message}`); process.exit(1);
      }
    }

    // T0 基准点：脚本就绪（若进程已出现则用进程出现时刻近似）
    const t0 = Date.now();
    const r = await benchOnce(opt, t0);
    r.run = run;
    allRuns.push(r);

    if (r.ok) {
      printTimeline(r, `第 ${run} 轮时间线（双击 → 注册成功 ${formatMs(r.totalMs)}）`);
      if (r.skinState) {
        console.log(`  注册详情: installed=${r.skinState.installed} version=${r.skinState.version} style=${r.skinState.stylePresent} chrome=${r.skinState.chromePresent} home=${r.skinState.homePresent} composer=${r.skinState.composer}`);
        console.log(`  --dream-art: ${(r.skinState.art || "(空)").slice(0, 80)}`);
      }
    } else {
      console.log(`\n  ❌ 第 ${run} 轮失败，未观测到: ${r.missing.join(", ")}`);
      printTimeline(r, `第 ${run} 轮时间线（失败）`);
      if (r.skinState) console.log(`  注册详情: ${JSON.stringify(r.skinState)}`);
    }

    // 保存单轮 JSON
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const jsonPath = path.join(opt.outDir, `skin-bench-${stamp}-run${run}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify({
      timestamp: new Date().toISOString(), run, ok: r.ok,
      totalMs: r.totalMs, skinState: r.skinState, missing: r.missing,
      events: r.events.map((e) => ({ ...e, atMs: e.at })),
    }, null, 2));
    console.log(`  📄 报告已保存: ${jsonPath}`);

    // 追加历史 CSV
    appendHistory(opt.outDir, r);

    // 轮间清理
    if (run < opt.runs) {
      console.log("\n  ⏹  关闭 OpenCode，准备下一轮...");
      killOpenCode();
      if (!(await waitAllExited(opt.port, opt.imagePort, 25))) {
        console.error("  ❌ 关闭超时"); process.exit(1);
      }
      await sleep(1500);
    }
  }

  // 最终汇总
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║                       基准结果                            ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  if (allRuns.length === 1) {
    const r = allRuns[0];
    console.log(`  双击图标 → 皮肤注册成功: ${formatMs(r.totalMs)}  (${r.ok ? "✅ 成功" : "❌ 失败"})`);
  } else {
    benchSummary(allRuns);
  }
  console.log(`  历史记录: ${path.join(opt.outDir, "skin-bench-history.csv")}`);
}

function appendHistory(outDir, r) {
  const csvPath = path.join(outDir, "skin-bench-history.csv");
  const header = "timestamp,run,ok,totalMs,processMs,cdpMs,imageServerMs,injectorMs,targetMs,skinMs,artMs,missing\n";
  if (!fs.existsSync(csvPath)) fs.writeFileSync(csvPath, header);
  const g = (n) => (r.byName[n] ? r.byName[n].at : "");
  const line = [
    new Date().toISOString(), r.run, r.ok ? "OK" : "FAIL", r.totalMs,
    g("process"), g("cdp"), g("imageServer"), g("injector"), g("target"), g("skin"), g("art"),
    r.missing.join("|"),
  ].join(",") + "\n";
  fs.appendFileSync(csvPath, line);
}

// ───────────────────────── watch 模式 ─────────────────────────

async function cmdWatch(opt) {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  持续监看：皮肤注入注册状态（Ctrl+C 退出）    ║");
  console.log("╚══════════════════════════════════════════════╝");
  const timeline = [];
  let lastLine = "";
  let lastConn = null;

  const snapshot = async () => {
    const s = { at: Date.now(), process: isOpenCodeRunning() };
    s.cdp = await httpOk(`http://127.0.0.1:${opt.port}/json/version`, 800);
    s.registered = false;
    s.state = null;
    if (s.cdp) {
      const conn = await connectTarget(opt.port);
      if (conn) {
        try { s.state = await querySkinState(conn.target, conn.session); s.registered = isRegistered(s.state); }
        catch {}
        conn.session.close();
      }
    }
    return s;
  };

  const render = (s) => {
    const t = new Date(s.at).toLocaleTimeString("zh-CN", { hour12: false });
    const p = s.process ? "●" : "○";
    const c = s.cdp ? "●" : "○";
    const r = s.registered ? "✅ 已注册" : (s.state ? "❌ 未注册" : "—");
    let detail = "";
    if (s.state) {
      const st = s.state;
      detail = `[class=${st.installed} ver=${st.version ?? "无"} style=${st.stylePresent} chrome=${st.chromePresent} home=${st.homePresent} composer=${st.composer}]`;
    }
    const line = `${t}  进程${p} CDP${c}  皮肤: ${r}  ${detail}`;
    if (line !== lastLine) {
      lastLine = line;
      console.log(line);
      timeline.push({ at: s.at, registered: s.registered, process: s.process, cdp: s.cdp, state: s.state });
    }
  };

  // 首帧立即输出，之后每 1s 轮询；状态变化自动打印
  render(await snapshot());
  const timer = setInterval(async () => { render(await snapshot()); }, 1000);

  const shutdown = () => {
    clearInterval(timer);
    console.log("\n\n── 事件时间线 ──");
    if (timeline.length === 0) { console.log("  （无）"); return; }
    const t0 = timeline[0].at;
    let prev = timeline[0];
    for (const e of timeline) {
      const delta = e.at - prev.at;
      const mark = e.registered ? "✅ 注册成功" : e.process ? "ℹ️ 状态变化" : "💤 进程退出";
      console.log(`  +${String(e.at - t0).padStart(7)}ms  (Δ${String(delta).padStart(6)}ms)  ${mark}`);
      prev = e;
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ───────────────────────── status 模式 ─────────────────────────

async function cmdStatus(opt) {
  const pids = getOpenCodePids();
  console.log(`OpenCode 进程: ${pids.length ? `运行中 PID=${pids.join(",")}` : "未运行"}`);
  const cdp = await httpOk(`http://127.0.0.1:${opt.port}/json/version`, 1500);
  console.log(`CDP 端口 ${opt.port}: ${cdp ? "就绪" : "未开放"}`);
  if (!cdp) { console.log("皮肤: 无法检测（CDP 未就绪）"); return; }
  const img = await httpOk(`http://127.0.0.1:${opt.imagePort}/skin-image`, 1500);
  console.log(`image-server ${opt.imagePort}: ${img ? "运行中" : "未运行"}`);
  const injector = findNodeProcess("injector.mjs");
  console.log(`injector 进程: ${injector.length ? injector.map((p) => p.pid).join(",") : "未运行"}`);
  const conn = await connectTarget(opt.port);
  if (!conn) { console.log("皮肤: oc:// 页面未找到"); return; }
  try {
    const st = await querySkinState(conn.target, conn.session);
    console.log(`皮肤注册: ${isRegistered(st) ? "✅ 成功" : "❌ 未注册"}`);
    console.log(`  class(opencode-dream-skin): ${st.installed}`);
    console.log(`  state.version: ${st.version}（期望 ${SKIN_VERSION}）`);
    console.log(`  #opencode-dream-skin-style: ${st.stylePresent}`);
    console.log(`  #opencode-dream-skin-chrome: ${st.chromePresent}`);
    console.log(`  .dream-home: ${st.homePresent}`);
    console.log(`  输入框(composer): ${st.composer}`);
    console.log(`  --dream-art: ${(st.art || "(空)").slice(0, 80)}`);
  } catch (e) {
    console.log(`皮肤: 查询失败 ${e.message}`);
  } finally {
    conn.session.close();
  }
}

// ───────────────────────── 入口 ─────────────────────────

const opt = parseArgs(process.argv.slice(2));
if (opt.command === "bench") await cmdBench(opt);
else if (opt.command === "watch") await cmdWatch(opt);
else await cmdStatus(opt);
