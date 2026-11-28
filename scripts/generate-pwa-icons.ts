/**
 * Generates the PWA icon set (PNG + ICO) with zero runtime dependencies.
 *
 * The harness logo is drawn procedurally into an RGBA buffer and encoded as a
 * real PNG (zlib via node:zlib). Run with:
 *
 *   bun run scripts/generate-pwa-icons.ts
 *
 * Outputs land in packages/web/public so Vite copies them to dist/ verbatim.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const OUT_DIR = join(import.meta.dir, "..", "packages", "web", "public");

// ─── Tiny PNG encoder ─────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Prefix every scanline with filter byte 0 (none).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1
    );
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** Wrap a single PNG inside a one-entry .ico container (PNG-in-ICO is legal). */
function encodeIco(png: Buffer, size: number): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; // width (0 == 256)
  entry[1] = size >= 256 ? 0 : size; // height
  entry[2] = 0; // palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8); // payload size
  entry.writeUInt32LE(6 + 16, 12); // offset
  return Buffer.concat([header, entry, png]);
}

// ─── Drawing helpers (supersampled, with coverage-based anti-aliasing) ─────────

type Rgb = [number, number, number];

const BG_TOP: Rgb = [24, 20, 43];
const BG_BOTTOM: Rgb = [9, 9, 11];
const ACCENT: Rgb = [124, 92, 255];
const ACCENT_SOFT: Rgb = [167, 139, 250];
const FG: Rgb = [237, 236, 245];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Signed distance from point p to the segment ab. */
function segmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function roundedRectSdf(
  px: number,
  py: number,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  radius: number
): number {
  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - radius;
}

/**
 * Renders the harness mark: a rounded tile with a terminal prompt glyph
 * (`>` chevron plus a `_` cursor line).
 */
function renderIcon(size: number, opts: { maskable: boolean }): Uint8Array {
  const ss = 4; // supersample factor
  const s = size * ss;

  // Glyph box: maskable icons keep everything inside the inner 80% safe zone.
  const glyphScale = opts.maskable ? 0.5 : 0.62;
  const g = s * glyphScale;
  const cx = s / 2;
  const cy = s / 2;
  const stroke = g * 0.14;

  const chevronTop = { x: cx - g * 0.44, y: cy - g * 0.34 };
  const chevronTip = { x: cx - g * 0.04, y: cy };
  const chevronBottom = { x: cx - g * 0.44, y: cy + g * 0.34 };
  const underscoreFrom = { x: cx + g * 0.14, y: cy + g * 0.34 };
  const underscoreTo = { x: cx + g * 0.48, y: cy + g * 0.34 };

  const tileRadius = opts.maskable ? s * 0.5 : s * 0.22;
  const tileHalf = s * 0.5;
  const lineColor = mix(ACCENT, FG, 0.12);

  // Render every supersample into a straight-alpha RGBA sample.
  const hi = new Float32Array(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const idx = (y * s + x) * 4;

      const tileDist = roundedRectSdf(px, py, cx, cy, tileHalf, tileHalf, tileRadius);
      const tileCov = Math.max(0, Math.min(1, 0.5 - tileDist));
      if (tileCov <= 0) continue;

      const bg = mix(BG_TOP, BG_BOTTOM, Math.min(1, Math.max(0, py / s)));
      const glow = Math.max(0, 1 - Math.hypot(px - cx, py - cy) / (s * 0.62));
      let [r, gg, b] = mix(bg, ACCENT, glow * 0.18);

      const dChev =
        Math.min(
          segmentDistance(px, py, chevronTop.x, chevronTop.y, chevronTip.x, chevronTip.y),
          segmentDistance(px, py, chevronTip.x, chevronTip.y, chevronBottom.x, chevronBottom.y)
        ) -
        stroke / 2;
      const chevCov = Math.max(0, Math.min(1, 0.5 - dChev));
      if (chevCov > 0) {
        r = lerp(r, lineColor[0], chevCov);
        gg = lerp(gg, lineColor[1], chevCov);
        b = lerp(b, lineColor[2], chevCov);
      }

      const dUnd =
        segmentDistance(
          px,
          py,
          underscoreFrom.x,
          underscoreFrom.y,
          underscoreTo.x,
          underscoreTo.y
        ) -
        stroke / 2;
      const undCov = Math.max(0, Math.min(1, 0.5 - dUnd));
      if (undCov > 0) {
        r = lerp(r, ACCENT_SOFT[0], undCov);
        gg = lerp(gg, ACCENT_SOFT[1], undCov);
        b = lerp(b, ACCENT_SOFT[2], undCov);
      }

      hi[idx] = r;
      hi[idx + 1] = gg;
      hi[idx + 2] = b;
      hi[idx + 3] = tileCov;
    }
  }

  // Box-downsample with premultiplied alpha, then un-premultiply.
  const out = new Uint8Array(size * size * 4);
  const samples = ss * ss;
  for (let oy = 0; oy < size; oy++) {
    for (let ox = 0; ox < size; ox++) {
      let pr = 0;
      let pg = 0;
      let pb = 0;
      let pa = 0;
      for (let dy = 0; dy < ss; dy++) {
        for (let dx = 0; dx < ss; dx++) {
          const idx = ((oy * ss + dy) * s + (ox * ss + dx)) * 4;
          pa += hi[idx + 3];
          pr += hi[idx] * hi[idx + 3];
          pg += hi[idx + 1] * hi[idx + 3];
          pb += hi[idx + 2] * hi[idx + 3];
        }
      }
      const alpha = pa / samples;
      const o = (oy * size + ox) * 4;
      out[o + 3] = Math.round(Math.min(1, alpha) * 255);
      if (alpha > 0) {
        out[o] = Math.round(Math.min(255, pr / pa));
        out[o + 1] = Math.round(Math.min(255, pg / pa));
        out[o + 2] = Math.round(Math.min(255, pb / pa));
      }
    }
  }

  return out;
}

function writeIcon(relPath: string, size: number, opts: { maskable: boolean }): Buffer {
  const png = encodePng(size, size, renderIcon(size, opts));
  const full = join(OUT_DIR, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, png);
  return png;
}

// ─── Emit the set ─────────────────────────────────────────────────────────────

console.log(`Writing PWA icons to ${OUT_DIR}`);
writeIcon(join("icons", "icon-192.png"), 192, { maskable: false });
writeIcon(join("icons", "icon-512.png"), 512, { maskable: false });
writeIcon(join("icons", "maskable-512.png"), 512, { maskable: true });
writeIcon(join("icons", "apple-touch-icon.png"), 180, { maskable: true });

const favicon32 = encodePng(32, 32, renderIcon(32, { maskable: false }));
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "favicon-32.png"), favicon32);
writeFileSync(join(OUT_DIR, "favicon.ico"), encodeIco(favicon32, 32));
console.log("Done.");
