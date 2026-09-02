// 生成 Video Studio 应用图标（coral 圆环 + 播放三角）：node tools/make-icon.mjs
// 输出 512 PNG 后由 `tauri icon` 生成全套尺寸（见 package.json 的 icon 脚本）。
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const S = 512;
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons", "app-icon.png");

const BG = [20, 23, 28, 255];
const ACCENT = [204, 120, 92, 255]; // 与 web 端品牌色 --coral 一致
const cx = S / 2;
const cy = S / 2;
const R = 170;
const RING_W = 26;

// 播放三角：中心略微右移，视觉上更居中
const tri = { ax: cx - 62, ay: cy - 96, bx: cx - 62, by: cy + 96, cx: cx + 112, cy };

function inTriangle(x, y, t) {
  const d1 = (x - t.bx) * (t.ay - t.by) - (t.ax - t.bx) * (y - t.by);
  const d2 = (x - t.cx) * (t.by - t.cy) - (t.bx - t.cx) * (y - t.cy);
  const d3 = (x - t.ax) * (t.cy - t.ay) - (t.cx - t.ax) * (y - t.ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

const buf = Buffer.alloc(S * S * 4);
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - cx, y - cy);
    let c = BG;
    if (Math.abs(d - R) <= RING_W) c = ACCENT;
    else if (inTriangle(x, y, tri)) c = ACCENT;
    const i = (y * S + x) * 4;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = c[3];
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6;

const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  buf.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log("icon written:", out);
