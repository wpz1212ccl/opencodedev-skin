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

  const ext = path.extname(imagePath).toLowerCase();
  const mimeMap = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4" };
  const contentType = mimeMap[ext] || "application/octet-stream";

  let cachedData = null;
  let cachedPath = null;

  const server = http.createServer(async (req, res) => {
    if (req.url === "/skin-image") {
      try {
        if (!cachedData || cachedPath !== imagePath) {
          cachedData = await fs.readFile(imagePath);
          cachedPath = imagePath;
        }
        res.writeHead(200, {
          "Content-Type": contentType,
          "Content-Length": cachedData.length,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
        });
        res.end(cachedData);
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
