/**
 * Lightweight local HTTP server for serving skin assets.
 * Avoids injecting huge base64 data via CDP.
 *
 * Usage: node image-server.mjs --port 18765 --theme-dir ../assets
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectImageMimeType } from "./image-metadata.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { port: 18765, themeDir: path.join(__dirname, "..", "assets") };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--port") opts.port = Number(argv[++i]);
    else if (argv[i] === "--theme-dir") opts.themeDir = path.resolve(argv[++i]);
  }
  return opts;
}

const opts = parseArgs(process.argv);

async function main() {
  const themeJson = path.join(opts.themeDir, "theme.json");
  const theme = JSON.parse(await fs.readFile(themeJson, "utf-8"));
  const imagePath = path.join(opts.themeDir, theme.image);

  // Verify image exists
  try {
    await fs.access(imagePath);
  } catch {
    console.error(`Image not found: ${imagePath}`);
    process.exit(1);
  }

  const mimeMap = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4" };

  let cachedData = null;
  let cachedPath = null;
  let cachedContentType = null;

  const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
  const VIDEO_EXTS = new Set([".mp4", ".webm", ".ogg", ".mov"]);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${opts.port}`);

    if (url.pathname === "/skin-image") {
      try {
        if (!cachedData || cachedPath !== imagePath) {
          cachedData = await fs.readFile(imagePath);
          cachedPath = imagePath;
          cachedContentType = detectImageMimeType(cachedData, path.extname(imagePath).toLowerCase());
        }
        res.writeHead(200, {
          "Content-Type": cachedContentType || "application/octet-stream",
          "Content-Length": cachedData.length,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
        });
        res.end(cachedData);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
    } else if (url.pathname === "/api/images") {
      try {
        const allFiles = await fs.readdir(opts.themeDir);
        const images = allFiles
          .filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
          .sort((a, b) => a.localeCompare(b, "zh"));
        const videos = allFiles
          .filter(f => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
          .sort((a, b) => a.localeCompare(b, "zh"));
        const result = { images, videos, current: theme.image };
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
        });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    } else if (url.pathname.startsWith("/asset-image/")) {
      const fileName = decodeURIComponent(url.pathname.slice("/asset-image/".length));
      const safeName = path.basename(fileName);
      const filePath = path.join(opts.themeDir, safeName);
      try {
        const data = await fs.readFile(filePath);
        const ext = path.extname(safeName).toLowerCase();
        const mime = VIDEO_EXTS.has(ext)
          ? (mimeMap[ext] || "application/octet-stream")
          : detectImageMimeType(data, ext);
        res.writeHead(200, {
          "Content-Type": mime,
          "Content-Length": data.length,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
        });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  server.listen(opts.port, "127.0.0.1", () => {
    console.log(`[skin-server] Serving ${theme.image} on http://127.0.0.1:${opts.port}/skin-image`);
  });
}

main();
