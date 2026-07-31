// 临时集成测试：mock OpenCode/CDP/image-server，验证 skin-monitor.mjs bench 全链路
import http from "node:http";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MOCK_DIR = path.join(os.tmpdir(), "skin-monitor-mock");
fs.mkdirSync(MOCK_DIR, { recursive: true });

// ── 1. 假 OpenCode.exe（拷贝 cmd.exe）──
const mockExe = path.join(MOCK_DIR, "OpenCode.exe");
if (!fs.existsSync(mockExe)) fs.copyFileSync("C:/Windows/System32/cmd.exe", mockExe);

// ── 2. mock image-server :18765 ──
const imgServer = http.createServer((req, res) => {
  if (req.url.startsWith("/skin-image")) { res.writeHead(200); res.end(); }
  else { res.writeHead(404); res.end(); }
});
await new Promise((r) => imgServer.listen(18765, "127.0.0.1", r));

// ── 3. mock CDP :9335 ──
const MOCK_STATE = {
  installed: true, version: "2.0.0", stylePresent: true, chromePresent: true,
  homePresent: true, composer: true, art: "url(\"http://127.0.0.1:18765/skin-image\")",
};

function wsFrame(payload) {
  const buf = Buffer.from(payload);
  let header;
  if (buf.length < 126) header = Buffer.from([0x81, buf.length]);
  else { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(buf.length, 2); }
  return Buffer.concat([header, buf]);
}

function handleWs(socket) {
  let acc = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    acc = Buffer.concat([acc, chunk]);
    while (acc.length >= 2) {
      const masked = (acc[1] & 0x80) !== 0;
      let len = acc[1] & 0x7f;
      let offset = 2;
      if (len === 126) { if (acc.length < 4) return; len = acc.readUInt16BE(2); offset = 4; }
      else if (len === 127) { if (acc.length < 10) return; len = Number(acc.readBigUInt64BE(2)); offset = 10; }
      let maskKey = null;
      if (masked) { if (acc.length < offset + 4) return; maskKey = acc.subarray(offset, offset + 4); offset += 4; }
      if (acc.length < offset + len) return;
      let payload = acc.subarray(offset, offset + len);
      if (maskKey) { const out = Buffer.alloc(len); for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i % 4]; payload = out; }
      acc = acc.subarray(offset + len);
      let msg;
      try { msg = JSON.parse(payload.toString()); } catch {
        // 可能是 ping/close 等控制帧，忽略
        console.log(`[mock] 非JSON帧 len=${len}`);
        continue;
      }
      console.log(`[mock] 收到 ${msg.method} id=${msg.id} len=${len}`);
      // 回复所有 CDP 方法（不只是 Runtime.evaluate），避免真实 injector 等第三方连接挂起
      let reply;
      if (msg.method === "Runtime.evaluate") {
        reply = { id: msg.id, result: { result: { type: "string", value: JSON.stringify(MOCK_STATE) } } };
      } else {
        reply = { id: msg.id, result: {} };
      }
      try { socket.write(wsFrame(JSON.stringify(reply))); console.log(`[mock] 已回复 id=${msg.id}`); } catch (e) { console.log(`[mock] write失败: ${e.message}`); }
    }
  });
  socket.on("close", () => {});
  socket.on("error", () => {});
}

const CDP_PORT = 9336;
const cdpServer = http.createServer((req, res) => {
  if (req.url.startsWith("/json/version")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ Browser: "Chrome/Mock" }));
  } else if (req.url.startsWith("/json/list")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([{
      type: "page", id: "mock-target-1", url: "oc://renderer/",
      webSocketDebuggerUrl: `ws://127.0.0.1:${CDP_PORT}/devtools/page/mock-target-1`,
    }]));
  } else { res.writeHead(404); res.end(); }
});
cdpServer.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
  handleWs(socket);
});
await new Promise((r) => cdpServer.listen(CDP_PORT, "127.0.0.1", r));

// ── 4. 假桌面图标 lnk → 指向假 OpenCode.exe ──
const mockLnk = path.join(MOCK_DIR, "OpenCode.lnk");
const ps = `$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('${mockLnk.replace(/'/g, "''")}'); $s.TargetPath = '${mockExe}'; $s.Save()`;
execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { encoding: "utf8" });

// ── 5. 运行 skin-monitor bench --auto ──
const outDir = path.join(MOCK_DIR, "results");
const script = "D:/code/codex移植opencode/opencode-skin/windows/tests/skin-monitor.mjs";
console.log("======== 运行 bench（mock 环境）========");
const child = spawn("node", [script, "bench", "--auto", "--lnk", mockLnk, "--out", outDir, "--timeout", "30", "--port", "9336"], { stdio: "inherit" });
const code = await new Promise((r) => {
  // 总超时保护：90 秒后强制结束
  const guard = setTimeout(() => { child.kill(); }, 90000);
  child.on("exit", (c) => { clearTimeout(guard); r(c); });
});

// ── 6. 清理 ──
try { execFileSync("taskkill", ["/IM", "OpenCode.exe", "/F"], { stdio: "ignore" }); } catch {}
imgServer.close();
cdpServer.close();

// ── 7. 校验产物 ──
console.log("\n======== 产物校验 ========");
const jsons = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((f) => f.endsWith(".json")) : [];
console.log(`JSON 报告: ${jsons.length} 个`);
if (jsons.length) {
  const rep = JSON.parse(fs.readFileSync(path.join(outDir, jsons[0]), "utf8"));
  console.log(`ok=${rep.ok} totalMs=${rep.totalMs}`);
  console.log("事件:", rep.events.map((e) => `${e.name}@${e.atMs}ms`).join(" → "));
}
const csv = path.join(outDir, "skin-bench-history.csv");
console.log(`CSV 历史: ${fs.existsSync(csv) ? "已生成" : "缺失"}`);
if (fs.existsSync(csv)) console.log(fs.readFileSync(csv, "utf8").trim());
console.log(`\n退出码: ${code}`);
