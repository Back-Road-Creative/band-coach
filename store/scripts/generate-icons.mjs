// Writes the AppX logo PNGs electron-builder substitutes generic sample art
// for when nothing is provided (see vendorAssetsForDefaultAssets in
// node_modules/app-builder-lib/out/targets/AppxTarget.js).
//
// These used to be solid #2563EB rectangles — literally one distinct pixel
// value across all four files, the 44x44 being 124 bytes — on the theory that
// the owner would swap in real art before submitting. Nobody did, and a solid
// blue square is a valid PNG, so nothing downstream complained: the icons
// shipped into a real built package (store-package run 35543421547) and would
// have gone to the Store that way. Drawing the real mark HERE, rather than
// leaving a note asking for one, is the only version of this that cannot rot.
// `tests/unit/store-icons.test.mjs` fails if any slot goes blank again.
//
// The mark is a five-bar level meter — what the app does is listen — in the
// app's own palette: bars on the #1c1c1c the tile already declares as its
// BackgroundColor (store/electron-builder.json), the centre bar in the same
// #5be08a the tuner uses for "in tune" (src/app.js:1000). Rectangles with
// rounded ends stay legible at 44x44 and need no font.
//
// Pure Node: only node:zlib for DEFLATE and a hand-rolled CRC32/PNG chunk
// writer. No image library, no new dependency.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const storeRoot = dirname(here);
const OUT_DIR = join(storeRoot, 'build-resources', 'appx');

// Required AppX logo slots (electron-builder's vendorAssetsForDefaultAssets
// keys) — these are the ones a build silently falls back to generic
// Electron sample art for if missing, so they're the ones worth a real
// placeholder here.
export const REQUIRED_SIZES = [
  { name: 'StoreLogo.png', width: 50, height: 50 },
  { name: 'Square44x44Logo.png', width: 44, height: 44 },
  { name: 'Square150x150Logo.png', width: 150, height: 150 },
  { name: 'Wide310x150Logo.png', width: 310, height: 150 },
];

// Solid brand-neutral blue, fully opaque. Kept for `encodeSolidPng`, which
// the PNG-writing tests still exercise directly.
const FILL_RGBA = [0x25, 0x63, 0xeb, 0xff];

// The app's own colours, not new ones: see the header note for where each is
// already used.
export const BACKGROUND_RGBA = [0x1c, 0x1c, 0x1c, 0xff];
export const BAR_RGBA = [0x25, 0x63, 0xeb, 0xff];
export const IN_TUNE_RGBA = [0x5b, 0xe0, 0x8a, 0xff];

// Bar heights as a fraction of the mark's height, centre tallest. Symmetric
// so the mark reads the same in the square and wide tiles.
const BAR_SCALE = [0.42, 0.7, 1, 0.7, 0.42];
const SUPERSAMPLE = 4;

// True when (px, py) is inside a vertical bar of width `bw` and height `bh`
// centred on (cx, cy), with semicircular ends of radius bw/2.
function inBar(px, py, cx, cy, bw, bh) {
  const halfW = bw / 2;
  const straightHalf = Math.max(0, bh / 2 - halfW);
  const dx = Math.abs(px - cx);
  if (dx > halfW) return false;
  const dy = Math.abs(py - cy);
  if (dy <= straightHalf) return true;
  const ey = dy - straightHalf;
  return dx * dx + ey * ey <= halfW * halfW;
}

// Renders the level-meter mark into an RGBA buffer. Supersampled so the
// rounded ends are smooth at 44x44 without pulling in a rasteriser.
export function renderIcon(width, height) {
  const buf = Buffer.alloc(width * height * 4);
  const s = Math.min(width, height);
  const markH = s * 0.72;
  const barW = s * 0.1;
  const gap = s * 0.055;
  const totalW = BAR_SCALE.length * barW + (BAR_SCALE.length - 1) * gap;
  const left = width / 2 - totalW / 2;
  const cy = height / 2;
  const centreIdx = (BAR_SCALE.length - 1) / 2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Accumulate subpixel coverage per bar colour, then composite once.
      let barHits = 0;
      let tunedHits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const px = x + (sx + 0.5) / SUPERSAMPLE;
          const py = y + (sy + 0.5) / SUPERSAMPLE;
          for (let i = 0; i < BAR_SCALE.length; i++) {
            const bx = left + i * (barW + gap) + barW / 2;
            if (inBar(px, py, bx, cy, barW, markH * BAR_SCALE[i])) {
              if (i === centreIdx) tunedHits++;
              else barHits++;
              break;
            }
          }
        }
      }
      const total = SUPERSAMPLE * SUPERSAMPLE;
      const ink = barHits + tunedHits;
      const fg = tunedHits >= barHits ? IN_TUNE_RGBA : BAR_RGBA;
      const a = ink / total;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        buf[o + c] = Math.round(BACKGROUND_RGBA[c] * (1 - a) + fg[c] * a);
      }
      buf[o + 3] = 0xff;
    }
  }
  return buf;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// Encodes a width*height*4 RGBA buffer as a PNG. Filter type 0 on every row:
// the images are flat-ish and tiny, so the DEFLATE saving from adaptive
// filtering is not worth the code.
export function encodePng(width, height, rgba) {
  const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // colour type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdrData),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function encodeSolidPng(width, height, [r, g, b, a]) {
  const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // colour type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = a;
    }
  }
  const idatData = deflateSync(raw);

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdrData),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const { name, width, height } of REQUIRED_SIZES) {
    const png = encodePng(width, height, renderIcon(width, height));
    writeFileSync(join(OUT_DIR, name), png);
    console.log('wrote ' + join(OUT_DIR, name) + ' (' + width + 'x' + height + ')');
  }
}
