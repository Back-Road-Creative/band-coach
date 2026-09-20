// The Microsoft Store icons must be pictures, not coloured rectangles.
//
// They were rectangles. All four slots in store/build-resources/appx/ held a
// single distinct pixel value — #2563EB at full alpha, the 44x44 weighing 124
// bytes — because the generator wrote deliberate placeholders and the note
// asking somebody to replace them was the only thing enforcing it. A solid
// PNG is a perfectly valid PNG, so the build never objected: the blanks
// shipped inside a real package (store-package run 35543421547) and would
// have reached the Store listing.
//
// Two separate things are checked, on purpose:
//   1. the committed files are real images — this is the invariant that
//      matters, and it stays true whether the art came from the generator or
//      was drawn by hand and dropped in;
//   2. the generator itself still draws something at every size, so it cannot
//      quietly rot back into placeholders even while hand-made files sit in
//      the directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import {
  REQUIRED_SIZES,
  renderIcon,
  BACKGROUND_RGBA,
} from '../../store/scripts/generate-icons.mjs';

// Minimal PNG reader: 8-bit RGBA, all five scanline filters. Written out
// rather than pulled in so this test has no dependency the app does not.
function decodePng(buf) {
  assert.deepEqual(
    [...buf.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    'not a PNG',
  );
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colourType = buf[25];
  assert.equal(bitDepth, 8, 'expected 8-bit channels');
  assert.equal(colourType, 6, 'expected RGBA');

  let idat = Buffer.alloc(0);
  let i = 8;
  while (i < buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('ascii');
    if (type === 'IDAT') idat = Buffer.concat([idat, buf.subarray(i + 8, i + 8 + len)]);
    i += 12 + len;
  }
  const raw = inflateSync(idat);

  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let recon;
      switch (filter) {
        case 0: recon = line[x]; break;
        case 1: recon = line[x] + a; break;
        case 2: recon = line[x] + b; break;
        case 3: recon = line[x] + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          recon = line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      }
      cur[x] = recon & 0xff;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, pixels: out };
}

function describe(pixels, width, height) {
  const colours = new Set();
  let ink = 0;
  for (let p = 0; p < width * height; p++) {
    const o = p * 4;
    colours.add(pixels.readUInt32BE(o));
    const isBg =
      pixels[o] === BACKGROUND_RGBA[0] &&
      pixels[o + 1] === BACKGROUND_RGBA[1] &&
      pixels[o + 2] === BACKGROUND_RGBA[2];
    if (!isBg) ink++;
  }
  return { colours: colours.size, inkFraction: ink / (width * height) };
}

for (const { name, width, height } of REQUIRED_SIZES) {
  test(`${name} is a real image at its declared size`, () => {
    const file = new URL(`../../store/build-resources/appx/${name}`, import.meta.url);
    const png = decodePng(readFileSync(file));
    assert.equal(png.width, width, `${name} is ${png.width}px wide, manifest slot expects ${width}`);
    assert.equal(png.height, height, `${name} is ${png.height}px tall, manifest slot expects ${height}`);

    const { colours, inkFraction } = describe(png.pixels, png.width, png.height);
    assert.ok(
      colours > 1,
      `${name} is a single flat colour — that is a placeholder, not an icon`,
    );
    assert.ok(
      inkFraction > 0.03,
      `${name} is ${(inkFraction * 100).toFixed(1)}% non-background; it is effectively empty`,
    );
    assert.ok(
      inkFraction < 0.95,
      `${name} is ${(inkFraction * 100).toFixed(1)}% non-background; it is effectively a solid fill`,
    );
  });
}

test('the generator still draws a mark at every required size', () => {
  // Guards the generator independently of the committed files, so replacing
  // the art by hand cannot hide a generator that has gone back to blanks.
  for (const { name, width, height } of REQUIRED_SIZES) {
    const { colours, inkFraction } = describe(renderIcon(width, height), width, height);
    assert.ok(colours > 1, `renderIcon(${width}, ${height}) for ${name} is a single flat colour`);
    assert.ok(
      inkFraction > 0.03 && inkFraction < 0.95,
      `renderIcon(${width}, ${height}) for ${name} covers ${(inkFraction * 100).toFixed(1)}% — not a mark`,
    );
  }
});

test('the smallest slot stays legible — the mark is not a single blob', () => {
  // At 44x44 the five bars must still be five separate bars: scan the middle
  // row and count runs of non-background pixels. A mark that has smeared into
  // one block reads as a smudge in the Store's app list.
  const { name, width, height } = REQUIRED_SIZES.find(s => s.name === 'Square44x44Logo.png');
  const png = decodePng(
    readFileSync(new URL(`../../store/build-resources/appx/${name}`, import.meta.url)),
  );
  const y = Math.floor(height / 2);
  let runs = 0;
  let inRun = false;
  for (let x = 0; x < width; x++) {
    const o = (y * png.width + x) * 4;
    const isBg =
      png.pixels[o] === BACKGROUND_RGBA[0] &&
      png.pixels[o + 1] === BACKGROUND_RGBA[1] &&
      png.pixels[o + 2] === BACKGROUND_RGBA[2];
    if (!isBg && !inRun) runs++;
    inRun = !isBg;
  }
  assert.equal(runs, 5, `expected 5 separate bars across the middle row at 44x44, found ${runs}`);
});
