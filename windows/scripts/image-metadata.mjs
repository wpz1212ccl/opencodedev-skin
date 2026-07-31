import { createReadStream } from "node:fs";

const MAX_DIMENSION = 16384;
const MAX_PIXELS = 50_000_000;

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_SIGNATURE = Buffer.from([0x52, 0x49, 0x46, 0x46]); // "RIFF"
const WEBP_FORMAT_SIGNATURE = Buffer.from([0x57, 0x45, 0x42, 0x50]); // "WEBP"

const IMAGE_FORMATS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function detectImageFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 3).equals(JPEG_SIGNATURE)) return "jpeg";
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return "png";
  if (buffer.subarray(0, 4).equals(WEBP_SIGNATURE) &&
      buffer.subarray(8, 12).equals(WEBP_FORMAT_SIGNATURE)) return "webp";
  return null;
}

export function detectImageMime(buffer, extension = null) {
  const format = detectImageFormat(buffer);
  if (format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  if (extension && IMAGE_FORMATS.has(extension.toLowerCase())) {
    const ext = extension.toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".png") return "image/png";
    if (ext === ".webp") return "image/webp";
  }
  return null;
}

function readUint16BE(buffer, offset) {
  return (buffer[offset] << 8) | buffer[offset + 1];
}

function readUint32BE(buffer, offset) {
  return (buffer[offset] << 24) | (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3];
}

function readInt32BE(buffer, offset) {
  const value = readUint32BE(buffer, offset);
  return value > 0x7fffffff ? value - 0x100000000 : value;
}

function parseJpeg(buffer) {
  if (buffer.length < 3 || !buffer.subarray(0, 3).equals(JPEG_SIGNATURE)) return null;
  let offset = 2;
  while (offset < buffer.length - 1) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    if (marker === 0xd9) break;
    if (marker === 0xda) {
      offset += 2;
      const length = readUint16BE(buffer, offset);
      offset += length;
      while (offset < buffer.length - 1) {
        if (buffer[offset] !== 0xff) { offset++; continue; }
        if (buffer[offset + 1] === 0x00) { offset += 2; continue; }
        break;
      }
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 9 >= buffer.length) return null;
      const height = readUint16BE(buffer, offset + 5);
      const width = readUint16BE(buffer, offset + 7);
      return { width, height };
    }
    if (marker === 0xd0 || marker === 0xd1 || marker === 0xd2 || marker === 0xd3 ||
        marker === 0xd4 || marker === 0xd5 || marker === 0xd6 || marker === 0xd7 ||
        marker === 0xd8 || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (offset + 3 >= buffer.length) return null;
    const length = readUint16BE(buffer, offset + 2);
    offset += 2 + length;
  }
  return null;
}

function parsePng(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const width = readInt32BE(buffer, 16);
  const height = readInt32BE(buffer, 20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function parseWebp(buffer) {
  if (buffer.length < 30 || !buffer.subarray(0, 4).equals(WEBP_SIGNATURE)) return null;
  if (!buffer.subarray(8, 12).equals(WEBP_FORMAT_SIGNATURE)) return null;
  const format = buffer.subarray(12, 16).toString("ascii");
  if (format === "VP8 " || format === "VP8L") {
    if (buffer.length < 30) return null;
    const width = readUint16BE(buffer, 26) & 0x3fff;
    const height = readUint16BE(buffer, 28) & 0x3fff;
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  }
  if (format === "VP8X") {
    if (buffer.length < 30) return null;
    const hasAlpha = (buffer[20] & 0x10) !== 0;
    const width = 1 + readUint32BE(buffer, 21) & 0xffffff;
    const height = 1 + readUint32BE(buffer, 24) & 0xffffff;
    if (width <= 0 || height <= 0) return null;
    return { width, height, hasAlpha };
  }
  return null;
}

export function readImageMetadata(buffer, extension) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1) return null;
  const format = detectImageFormat(buffer);
  let result = null;
  if (format === "jpeg") result = parseJpeg(buffer);
  else if (format === "png") result = parsePng(buffer);
  else if (format === "webp") result = parseWebp(buffer);
  else if (extension === ".jpg" || extension === ".jpeg") result = parseJpeg(buffer);
  else if (extension === ".png") result = parsePng(buffer);
  else if (extension === ".webp") result = parseWebp(buffer);
  else return null;
  if (!result) return null;
  if (result.width > MAX_DIMENSION || result.height > MAX_DIMENSION) return null;
  if (result.width * result.height > MAX_PIXELS) return null;
  return result;
}
