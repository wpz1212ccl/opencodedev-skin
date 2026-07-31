#!/usr/bin/env node
/**
 * OpenCode-Skin Performance Test: Video Background + Slider Interaction
 *
 * 测试流程：
 *   1. 启动 OpenCode（带 CDP 端口）
 *   2. 连接 CDP，注入皮肤
 *   3. 基准测试：图片背景 + 拖动滑块 → FPS / Long Task
 *   4. 视频测试：视频背景 + 拖动滑块 → FPS / Long Task
 *   5. 对比报告
 *
 * Usage:
 *   node perf-video-slider.mjs [--port 9335] [--cycles 20] [--no-launch]
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";
import http from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── CLI args ──
function parseArgs(argv) {
  const opts = { port: 9335, cycles: 20, launch: true, timeout: 45000, outputDir: path.join(__dirname, "results") };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--port") opts.port = Number(argv[++i]);
    else if (argv[i] === "--cycles") opts.cycles = Number(argv[++i]);
    else if (argv[i] === "--no-launch") opts.launch = false;
    else if (argv[i] === "--timeout") opts.timeout = Number(argv[++i]);
    else if (argv[i] === "--output-dir") opts.outputDir = path.resolve(argv[++i]);
  }
  return opts;
}

// ── CDP helpers ──
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
      this.ws.addEventListener("close", () => {
        this.closed = true;
        for (const p of this.pending.values()) { clearTimeout(p.timeout); p.reject(new Error("WS closed")); }
        this.pending.clear();
      });
    });
  }
  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("Session closed"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 60000);
      this.pending.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`Eval error: ${r.exceptionDetails.text || JSON.stringify(r.exceptionDetails)}`);
    return r.result?.value;
  }
  async screenshot(outputPath) {
    const r = await this.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await fs.writeFile(outputPath, Buffer.from(r.data, "base64"));
    return outputPath;
  }
  close() { if (!this.closed) try { this.ws?.close(); } catch {} this.closed = true; }
}

// ── Wait for CDP ──
async function waitForCdp(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await fetchCdp(port, "/json/version"); return true; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

// ── Find OpenCode renderer target (with retry) ──
async function findRendererTarget(port, maxRetries = 10, delayMs = 2000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const targets = await fetchCdp(port, "/json/list");
      console.log(`  CDP targets: ${targets.length}`);
      for (const t of targets) console.log(`    ${t.type}: ${t.url}`);
      const found = targets.find(t => t.type === "page" && t.url?.startsWith("oc://") && t.webSocketDebuggerUrl);
      if (found) return found;
    } catch (e) {
      console.log(`  Retry ${i+1}/${maxRetries}: ${e.message}`);
    }
    if (i < maxRetries - 1) {
      console.log(`  Waiting ${delayMs}ms for renderer...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return null;
}

// ── Local HTTP server for serving video files ──
function startVideoServer(videoPath, port = 18766) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/video") {
        const ext = path.extname(videoPath).toLowerCase();
        const mime = ext === ".mp4" ? "video/mp4" : ext === ".webm" ? "video/webm" : "video/mp4";
        fs.readFile(videoPath).then(data => {
          res.writeHead(200, { "Content-Type": mime, "Content-Length": data.length, "Access-Control-Allow-Origin": "*" });
          res.end(data);
        }).catch(() => { res.writeHead(404); res.end("Not found"); });
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(port, "127.0.0.1", () => {
      console.log(`  Video server: http://127.0.0.1:${port}/video`);
      resolve({ server, url: `http://127.0.0.1:${port}/video` });
    });
    server.on("error", reject);
  });
}

// ── Kill existing OpenCode ──
function killOpenCode() {
  try { execSync("taskkill /F /IM OpenCode.exe 2>nul", { stdio: "ignore" }); } catch {}
}

// ── Launch OpenCode ──
function launchOpenCode(port) {
  const exe = "D:\\OpenCode\\OpenCode.exe";
  const proc = spawn(exe, [`--remote-debugging-port=${port}`], {
    detached: true, stdio: "ignore",
  });
  proc.unref();
  console.log(`  OpenCode launched (PID: ${proc.pid})`);
  return proc;
}

// ── Inject performance monitor into page ──
async function injectPerfMonitor(session) {
  await session.evaluate(`
    (function() {
      if (window.__PERF_MONITOR__) return;

      const monitor = {
        fps: 0,
        frames: 0,
        frameTimes: [],
        longTasks: [],
        running: false,
        _rafId: null,
        _observer: null,

        start() {
          this.frames = 0;
          this.frameTimes = [];
          this.longTasks = [];
          this.running = true;
          this._startTime = performance.now();

          // Long task observer
          this._observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (entry.duration > 16) {
                this.longTasks.push(Math.round(entry.duration));
              }
            }
          });
          try { this._observer.observe({ entryTypes: ['longtask'] }); } catch {}

          // FPS counter
          const tick = () => {
            if (!this.running) return;
            this.frames++;
            this.frameTimes.push(performance.now());
            this._rafId = requestAnimationFrame(tick);
          };
          this._rafId = requestAnimationFrame(tick);
        },

        stop() {
          this.running = false;
          if (this._rafId) cancelAnimationFrame(this._rafId);
          if (this._observer) { this._observer.disconnect(); this._observer = null; }
          const elapsed = (performance.now() - this._startTime) / 1000;
          const fps = elapsed > 0 ? Math.round(this.frames / elapsed) : 0;
          const avgFrameTime = this.frames > 1 ? 
            ((this.frameTimes[this.frameTimes.length-1] - this.frameTimes[0]) / (this.frames - 1)) : 0;
          return {
            fps,
            totalFrames: this.frames,
            elapsedMs: Math.round(elapsed * 1000),
            avgFrameTimeMs: Math.round(avgFrameTime * 100) / 100,
            longTaskCount: this.longTasks.length,
            longTaskMaxMs: this.longTasks.length > 0 ? Math.max(...this.longTasks) : 0,
            longTaskAvgMs: this.longTasks.length > 0 ? 
              Math.round(this.longTasks.reduce((a,b) => a+b, 0) / this.longTasks.length) : 0,
            droppedFrames: this.longTasks.filter(d => d > 32).length,
          };
        }
      };

      window.__PERF_MONITOR__ = monitor;
    })();
  `);
}

// ── Start monitoring ──
async function startMonitor(session) {
  await session.evaluate(`window.__PERF_MONITOR__.start()`);
}

// ── Stop monitoring and get results ──
async function stopMonitor(session) {
  return await session.evaluate(`JSON.stringify(window.__PERF_MONITOR__.stop())`);
}

// ── Drag slider programmatically (simulates rapid input events) ──
async function dragSlider(session, key, fromVal, toVal, steps) {
  const stepDelay = 8; // ms between steps (~120Hz)
  await session.evaluate(`
    (function() {
      const slider = document.querySelector('.dream-slider[data-key="${key}"]');
      if (!slider) return false;
      const from = ${fromVal}, to = ${toVal}, steps = ${steps};
      const delay = ${stepDelay};
      
      return new Promise((resolve) => {
        let i = 0;
        function step() {
          if (i > steps) {
            slider.dispatchEvent(new Event('change', { bubbles: true }));
            resolve(true);
            return;
          }
          const val = from + (to - from) * (i / steps);
          slider.value = val;
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          i++;
          setTimeout(step, delay);
        }
        step();
      });
    })()
  `);
}

// ── Open settings panel ──
async function openPanel(session) {
  await session.evaluate(`
    (function() {
      const panel = document.getElementById('dream-settings-panel');
      if (panel) panel.classList.remove('hidden');
    })()
  `);
}

// ── Close settings panel ──
async function closePanel(session) {
  await session.evaluate(`
    (function() {
      const panel = document.getElementById('dream-settings-panel');
      if (panel) panel.classList.add('hidden');
    })()
  `);
}

// ── Switch to video background ──
async function switchToVideo(session, videoUrl) {
  await session.evaluate(`
    (function() {
      var root = document.documentElement;
      root.style.removeProperty('--dream-art');
      root.style.removeProperty('background-image');
      root.classList.add('dream-video-active');
      
      var vc = document.getElementById('opencode-dream-skin-video');
      if (!vc) {
        vc = document.createElement('div');
        vc.id = 'opencode-dream-skin-video';
        vc.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;overflow:visible;z-index:-2147483647;pointer-events:none;background:#000;';
        document.body.insertBefore(vc, document.body.firstChild);
      }
      
      var vid = document.getElementById('opencode-dream-skin-video-el');
      if (!vid) {
        vid = document.createElement('video');
        vid.id = 'opencode-dream-skin-video-el';
        vid.autoplay = true;
        vid.loop = true;
        vid.muted = true;
        vid.playsInline = true;
        vid.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        vc.appendChild(vid);
      }
      
      vid.src = ${JSON.stringify(videoUrl)};
      vid.load();
      return true;
    })()
  `);
  // Wait for video to be ready
  await session.evaluate(`
    new Promise(function(resolve) {
      var vid = document.getElementById('opencode-dream-skin-video-el');
      if (!vid) { resolve(false); return; }
      if (vid.readyState >= 2) { resolve(true); return; }
      vid.addEventListener('canplay', function() { resolve(true); }, { once: true });
      setTimeout(function() { resolve(vid.readyState >= 2); }, 10000);
    })
  `);
}

// ── Switch back to image background ──
async function switchToImage(session) {
  await session.evaluate(`
    (function() {
      var vc = document.getElementById('opencode-dream-skin-video');
      if (vc) vc.remove();
      document.documentElement.classList.remove('dream-video-active');
      var root = document.documentElement;
      root.style.removeProperty('--dream-art');
      root.style.backgroundImage = 'none';
      root.style.backgroundSize = 'cover';
      root.style.backgroundRepeat = 'no-repeat';
      root.style.backgroundAttachment = 'fixed';
      root.style.backgroundColor = 'transparent';
      return true;
    })()
  `);
}

// ── Run a single test cycle (drag multiple sliders) ──
async function runSliderDragCycle(session, cycleNum, cycles) {
  const blurFrom = 3, blurTo = 15;
  const brightFrom = 100, brightTo = 150;
  const contrastFrom = 100, contrastTo = 130;
  const steps = 20;

  // Drag blur slider
  await dragSlider(session, "blur", blurFrom, blurTo, steps);
  await dragSlider(session, "blur", blurTo, blurFrom, steps);
  
  // Drag brightness slider
  await dragSlider(session, "brightness", brightFrom, brightTo, steps);
  await dragSlider(session, "brightness", brightTo, brightFrom, steps);
  
  // Drag contrast slider
  await dragSlider(session, "contrast", contrastFrom, contrastTo, steps);
  await dragSlider(session, "contrast", contrastTo, contrastFrom, steps);
}

// ── Get current CSS computed values for verification ──
async function getComputedStyles(session) {
  return await session.evaluate(`JSON.stringify({
    backdropFilter: getComputedStyle(document.querySelector('#root > div:first-child')).backdropFilter,
    filter: getComputedStyle(document.querySelector('#root > div:first-child')).filter,
    hasVideoActive: document.documentElement.classList.contains('dream-video-active'),
    hasVideo: !!document.getElementById('opencode-dream-skin-video-el'),
    videoReady: document.getElementById('opencode-dream-skin-video-el')?.readyState ?? -1,
    videoPaused: document.getElementById('opencode-dream-skin-video-el')?.paused ?? true,
    videoTime: document.getElementById('opencode-dream-skin-video-el')?.currentTime ?? 0,
  })`);
}

// ── Main ──
async function main() {
  const opts = parseArgs(process.argv);
  let videoServer = null;
  const results = {
    timestamp: new Date().toISOString(),
    opts: { port: opts.port, cycles: opts.cycles, launch: opts.launch },
    tests: [],
    metrics: {},
    screenshots: [],
  };

  console.log(`\n${"═".repeat(64)}`);
  console.log(`  OpenCode-Skin Performance Test`);
  console.log(`  Video Background + Slider Interaction Benchmark`);
  console.log(`${"═".repeat(64)}`);
  console.log(`  Port: ${opts.port} | Cycles: ${opts.cycles} | Launch: ${opts.launch}\n`);

  // ── Step 1: Launch OpenCode ──
  if (opts.launch) {
    console.log("[1/7] Launching OpenCode...");
    killOpenCode();
    await new Promise(r => setTimeout(r, 1000));
    launchOpenCode(opts.port);
  } else {
    console.log("[1/7] Connecting to existing OpenCode...");
  }

  // ── Step 2: Wait for CDP ──
  console.log("[2/7] Waiting for CDP...");
  const cdpReady = await waitForCdp(opts.port, opts.timeout);
  results.tests.push({ name: "CDP ready", pass: cdpReady });
  if (!cdpReady) {
    console.error("  FAIL: CDP not available after timeout");
    report(results, opts.outputDir);
    return;
  }
  console.log("  PASS: CDP ready\n");

  // Give OpenCode time to fully initialize renderer
  console.log("  Waiting 3s for renderer to initialize...");
  await new Promise(r => setTimeout(r, 3000));

  // ── Step 3: Connect to renderer ──
  console.log("[3/7] Connecting to renderer...");
  const target = await findRendererTarget(opts.port);
  if (!target) {
    console.error("  FAIL: No renderer target found");
    results.tests.push({ name: "Find renderer", pass: false });
    report(results, opts.outputDir);
    return;
  }
  console.log(`  Target: ${target.id.slice(0, 12)} — ${target.url}`);

  const session = new CdpSession(target.webSocketDebuggerUrl);
  await session.open();
  results.tests.push({ name: "Connect renderer", pass: true });
  console.log("  PASS: Connected\n");

  // ── Step 4: Inject skin directly via CDP ──
  console.log("[4/7] Injecting skin...");
  try {
    const cssPath = path.join(ROOT, "assets", "dream-skin.css");
    const jsPath = path.join(ROOT, "assets", "renderer-inject.js");
    const themePath = path.join(ROOT, "assets", "theme.json");

    const cssText = await fs.readFile(cssPath, "utf-8");
    const jsText = await fs.readFile(jsPath, "utf-8");
    const themeJson = await fs.readFile(themePath, "utf-8");
    const theme = JSON.parse(themeJson);

    // Inject CSS
    await session.evaluate(`
      (function() {
        var style = document.getElementById('opencode-dream-skin-style');
        if (!style) {
          style = document.createElement('style');
          style.id = 'opencode-dream-skin-style';
          (document.head || document.documentElement).appendChild(style);
        }
        style.textContent = ${JSON.stringify(cssText)};
        return true;
      })()
    `);

    // Build and inject JS (with template replacements)
    const artPath = theme.art?.image || "assets/wallpapers/五条悟.png";
    const fullArtPath = path.join(ROOT, "assets", artPath);
    let artDataUrl;
    try {
      const artBuf = await fs.readFile(fullArtPath);
      const ext = path.extname(fullArtPath).toLowerCase();
      const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
      artDataUrl = `data:${mime};base64,${artBuf.toString("base64")}`;
    } catch {
      artDataUrl = "data:image/png;base64,";
    }

    // Prepare JS with template replacements (matching injector.mjs pattern)
    let preparedJs = jsText;
    preparedJs = preparedJs.replace('"__DREAM_CSS_JSON__"', JSON.stringify(cssText));
    preparedJs = preparedJs.replace("'__DREAM_ART_JSON__'", JSON.stringify(artDataUrl));
    preparedJs = preparedJs.replace("__DREAM_THEME_JSON__", JSON.stringify(theme));

    // Execute JS
    await session.evaluate(`
      (function() {
        ${preparedJs}
        return true;
      })()
    `);

    // Verify injection
    const skinState = await session.evaluate(`
      JSON.stringify({
        hasSkinClass: document.documentElement.classList.contains('opencode-dream-skin'),
        hasStyleEl: !!document.getElementById('opencode-dream-skin-style'),
        stateExists: !!window.__OPENCODE_DREAM_SKIN_STATE__,
      })
    `);
    const parsed = JSON.parse(skinState);
    const injected = parsed.hasSkinClass && parsed.hasStyleEl && parsed.stateExists;
    results.tests.push({ name: "Inject skin", pass: injected, detail: skinState });
    console.log(`  ${injected ? "PASS" : "FAIL"}: skinClass=${parsed.hasSkinClass} style=${parsed.hasStyleEl} state=${parsed.stateExists}`);
  } catch (e) {
    results.tests.push({ name: "Inject skin", pass: false, detail: e.message });
    console.log(`  FAIL: ${e.message}`);
  }

  // ── Step 5: Inject performance monitor ──
  console.log("\n[5/7] Injecting performance monitor...");
  await injectPerfMonitor(session);
  await openPanel(session);
  results.tests.push({ name: "Perf monitor", pass: true });
  console.log("  PASS: Monitor ready\n");

  // ── Step 6: Run performance tests ──
  console.log("[6/7] Running performance tests...\n");

  // ── Test A: Image background (baseline) ──
  console.log("  ── Test A: Image Background (Baseline) ──");
  await switchToImage(session);
  await new Promise(r => setTimeout(r, 500)); // let rendering settle
  
  // Screenshot before test
  const imgScreenshot = path.join(opts.outputDir, "test-image-background.png");
  try { await session.screenshot(imgScreenshot); } catch {}

  await startMonitor(session);
  for (let i = 0; i < opts.cycles; i++) {
    await runSliderDragCycle(session, i, opts.cycles);
  }
  const imageResult = JSON.parse(await stopMonitor(session));
  results.metrics.image = imageResult;
  
  console.log(`    FPS: ${imageResult.fps}`);
  console.log(`    Frames: ${imageResult.totalFrames} in ${imageResult.elapsedMs}ms`);
  console.log(`    Avg frame time: ${imageResult.avgFrameTimeMs}ms`);
  console.log(`    Long tasks (>16ms): ${imageResult.longTaskCount}`);
  console.log(`    Max long task: ${imageResult.longTaskMaxMs}ms`);
  console.log(`    Dropped frames (>32ms): ${imageResult.droppedFrames}`);
  console.log();

  // ── Test B: Video background ──
  console.log("  ── Test B: Video Background ──");
  const videoPath = "D:\\code\\codex移植opencode\\opencode-skin\\windows\\assets\\video-bg.mp4";
  const { server: vs, url: videoUrl } = await startVideoServer(videoPath);
  videoServer = vs;
  await switchToVideo(session, videoUrl);
  
  // Wait for video to fully start playing
  await new Promise(r => setTimeout(r, 3000));
  
  // Verify video is playing
  const videoState = JSON.parse(await getComputedStyles(session));
  console.log(`    Video ready: ${videoState.videoReady}, paused: ${videoState.videoPaused}, time: ${videoState.videoTime}s`);
  console.log(`    Video active class: ${videoState.hasVideoActive}`);
  console.log(`    Backdrop filter: ${videoState.backdropFilter}`);

  // Screenshot before test
  const vidScreenshot = path.join(opts.outputDir, "test-video-background.png");
  try { await session.screenshot(vidScreenshot); } catch {}

  await startMonitor(session);
  for (let i = 0; i < opts.cycles; i++) {
    await runSliderDragCycle(session, i, opts.cycles);
  }
  const videoResult = JSON.parse(await stopMonitor(session));
  results.metrics.video = videoResult;
  
  console.log(`    FPS: ${videoResult.fps}`);
  console.log(`    Frames: ${videoResult.totalFrames} in ${videoResult.elapsedMs}ms`);
  console.log(`    Avg frame time: ${videoResult.avgFrameTimeMs}ms`);
  console.log(`    Long tasks (>16ms): ${videoResult.longTaskCount}`);
  console.log(`    Max long task: ${videoResult.longTaskMaxMs}ms`);
  console.log(`    Dropped frames (>32ms): ${videoResult.droppedFrames}`);
  console.log();

  // ── Test C: Video + all sliders rapid fire ──
  console.log("  ── Test C: Video + All Sliders Rapid Fire ──");
  await startMonitor(session);
  for (let i = 0; i < opts.cycles; i++) {
    // Drag ALL sliders in rapid succession
    await dragSlider(session, "blur", 3, 20, 15);
    await dragSlider(session, "brightness", 100, 200, 15);
    await dragSlider(session, "contrast", 100, 180, 15);
    await dragSlider(session, "saturate", 100, 180, 15);
    await dragSlider(session, "containerAlpha", 65, 30, 15);
    await dragSlider(session, "blur", 20, 3, 15);
    await dragSlider(session, "brightness", 200, 100, 15);
    await dragSlider(session, "contrast", 180, 100, 15);
    await dragSlider(session, "saturate", 180, 100, 15);
    await dragSlider(session, "containerAlpha", 30, 65, 15);
  }
  const rapidResult = JSON.parse(await stopMonitor(session));
  results.metrics.rapidFire = rapidResult;
  
  console.log(`    FPS: ${rapidResult.fps}`);
  console.log(`    Frames: ${rapidResult.totalFrames} in ${rapidResult.elapsedMs}ms`);
  console.log(`    Avg frame time: ${rapidResult.avgFrameTimeMs}ms`);
  console.log(`    Long tasks (>16ms): ${rapidResult.longTaskCount}`);
  console.log(`    Max long task: ${rapidResult.longTaskMaxMs}ms`);
  console.log(`    Dropped frames (>32ms): ${rapidResult.droppedFrames}`);
  console.log();

  // ── Cleanup ──
  await closePanel(session);
  session.close();
  if (videoServer) videoServer.close();
  results.tests.push({ name: "All tests completed", pass: true });

  // ── Step 7: Generate report ──
  console.log("[7/7] Generating report...\n");
  await fs.mkdir(opts.outputDir, { recursive: true });
  report(results, opts.outputDir);
}

function report(results, outputDir) {
  const { image, video, rapidFire } = results.metrics;

  console.log(`${"═".repeat(64)}`);
  console.log(`  PERFORMANCE TEST REPORT`);
  console.log(`  ${results.timestamp}`);
  console.log(`${"═".repeat(64)}\n`);

  // Test results
  const passed = results.tests.filter(t => t.pass).length;
  const failed = results.tests.filter(t => !t.pass).length;
  console.log(`  Setup: ${passed}/${results.tests.length} passed\n`);

  if (image && video) {
    // Comparison table
    console.log(`  ${"─".repeat(60)}`);
    console.log(`  ${"Metric".padEnd(25)} ${"Image".padStart(10)} ${"Video".padStart(10)} ${"Rapid".padStart(10)} ${"Delta".padStart(10)}`);
    console.log(`  ${"─".repeat(60)}`);

    const rows = [
      ["FPS", image.fps, video.fps, rapidFire?.fps],
      ["Avg frame time (ms)", image.avgFrameTimeMs, video.avgFrameTimeMs, rapidFire?.avgFrameTimeMs],
      ["Long tasks (>16ms)", image.longTaskCount, video.longTaskCount, rapidFire?.longTaskCount],
      ["Max long task (ms)", image.longTaskMaxMs, video.longTaskMaxMs, rapidFire?.longTaskMaxMs],
      ["Dropped frames (>32ms)", image.droppedFrames, video.droppedFrames, rapidFire?.droppedFrames],
      ["Total frames", image.totalFrames, video.totalFrames, rapidFire?.totalFrames],
    ];

    for (const [label, img, vid, rapid] of rows) {
      const delta = vid != null && img != null ? vid - img : null;
      const deltaStr = delta != null ? (delta > 0 ? `+${delta}` : `${delta}`) : "—";
      console.log(`  ${label.padEnd(25)} ${String(img ?? "—").padStart(10)} ${String(vid ?? "—").padStart(10)} ${String(rapid ?? "—").padStart(10)} ${deltaStr.padStart(10)}`);
    }
    console.log(`  ${"─".repeat(60)}\n`);

    // Verdict
    const fpsDrop = image.fps - video.fps;
    const longTaskIncrease = video.longTaskCount - image.longTaskCount;
    
    console.log(`  Analysis:`);
    if (fpsDrop <= 5) {
      console.log(`  ✅ FPS impact minimal: ${fpsDrop <= 0 ? "no drop" : `-${fpsDrop} fps`} (video vs image)`);
    } else if (fpsDrop <= 15) {
      console.log(`  ⚠️  FPS moderate drop: -${fpsDrop} fps (video vs image)`);
    } else {
      console.log(`  ❌ FPS severe drop: -${fpsDrop} fps (video vs image)`);
    }

    if (longTaskIncrease <= 3) {
      console.log(`  ✅ Long tasks acceptable: +${longTaskIncrease} (video vs image)`);
    } else if (longTaskIncrease <= 10) {
      console.log(`  ⚠️  Long tasks elevated: +${longTaskIncrease} (video vs image)`);
    } else {
      console.log(`  ❌ Long tasks too high: +${longTaskIncrease} (video vs image)`);
    }

    if (video.longTaskMaxMs <= 50) {
      console.log(`  ✅ Max frame time OK: ${video.longTaskMaxMs}ms (< 50ms threshold)`);
    } else if (video.longTaskMaxMs <= 100) {
      console.log(`  ⚠️  Max frame time borderline: ${video.longTaskMaxMs}ms`);
    } else {
      console.log(`  ❌ Max frame time too high: ${video.longTaskMaxMs}ms (> 100ms = visible jank)`);
    }

    if (rapidFire) {
      console.log(`  ${rapidFire.fps >= 20 ? "✅" : "⚠️"} Rapid fire FPS: ${rapidFire.fps} (all sliders + video)`);
    }
  } else {
    console.log(`  ⚠️  Insufficient data for comparison`);
    if (image) console.log(`  Image baseline: FPS=${image.fps}, longTasks=${image.longTaskCount}`);
    if (video) console.log(`  Video test: FPS=${video.fps}, longTasks=${video.longTaskCount}`);
  }

  console.log(`\n${"═".repeat(64)}`);

  // Save JSON report
  const reportPath = path.join(outputDir, "perf-report.json");
  fs.writeFile(reportPath, JSON.stringify(results, null, 2)).catch(() => {});
  console.log(`  Report saved: ${reportPath}`);

  // Save screenshots list
  if (results.screenshots?.length) {
    console.log(`  Screenshots:`);
    for (const s of results.screenshots) console.log(`    ${s.path}`);
  }
  console.log();
}

main().catch(e => { console.error("Fatal:", e); process.exit(2); });
