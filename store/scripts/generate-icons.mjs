// Writes minimal, valid, solid-colour placeholder PNGs for the AppX logo
// slots electron-builder substitutes generic sample art for when nothing is
// provided (see vendorAssetsForDefaultAssets in
// node_modules/app-builder-lib/out/targets/AppxTarget.js). These are stand-
// ins only — the owner replaces them with real branded art before shipping
// to the Store (see README.md "Store assets").
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

// Solid brand-neutral blue, fully opaque.
const FILL_RGBA = [0x25, 0x63, 0xeb, 0xff];

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
    const png = encodeSolidPng(width, height, FILL_RGBA);
    writeFileSync(join(OUT_DIR, name), png);
    console.log('wrote ' + join(OUT_DIR, name) + ' (' + width + 'x' + height + ')');
  }
}
