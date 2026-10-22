// CURRENT BEHAVIOUR: `npm run shots` must produce real, viewable PNGs of the
// built app -- not just report success. Before this, the only way to LOOK at
// the UI was a human pasting an ad hoc shell command; nothing in the repo
// proved a screenshot could be taken at all, so a UI regression could ship
// with zero visual evidence anywhere the next session (or CI) could see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { inflateSync } from 'node:zlib';
import * as shots from '../../build/shots.mjs';
import { captureShots, shoot, SHOTS } from '../../build/shots.mjs';
import { INSTRUMENTS } from '../../src/instruments/index.js';
import { howKindFor } from '../../src/instruments/how-kind.js';
import { HTML_PATH } from '../helpers/html-path.mjs';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('shots writes a real PNG per configured size, into its own outDir', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'band-coach-shots-'));
  try {
    const written = await captureShots({ htmlPath: HTML_PATH, outDir });
    assert.equal(written.length, SHOTS.length, 'one file written per configured shot');

    for (const { name } of SHOTS) {
      const outPath = join(outDir, name);
      assert.ok(existsSync(outPath), `${name} should exist`);
      const bytes = readFileSync(outPath);
      assert.ok(bytes.length > 1000, `${name} should be a non-trivial file, got ${bytes.length} bytes`);
      assert.deepEqual(bytes.subarray(0, 8), PNG_MAGIC, `${name} should start with the PNG magic bytes`);
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

// `captureShots` only ever checked that the built file EXISTS. A stale one
// exists, so `npm run shots` would happily photograph a build from hours ago
// and report success -- and a screenshot is the one artefact whose whole job
// is to be believed. On 2026-09-21 that produced a phone shot of a five-hour-old
// bundle showing none of the day's UI work, and it was nearly reported as a
// regression in shipped code.
//
// Guarding freshness would be a late gate: it catches the bad artefact after
// the fact and still costs a confusing failure. `shoot()` removes the failure
// mode instead -- it builds, THEN captures, so there is no stale-input state
// for `npm run shots` to be in.
test('shoot() builds before capturing, so a screenshot can never be of a stale bundle', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'band-coach-shoot-'));
  try {
    const builtFile = join(outDir, 'band-coach.html');
    assert.ok(!existsSync(builtFile), 'outDir starts with no build at all');

    const written = await shoot({ outDir });

    assert.ok(existsSync(builtFile), 'shoot() produced the build itself rather than requiring one');
    assert.equal(written.length, SHOTS.length, 'and still wrote one PNG per configured shot');

    // The PNGs must be newer than the bundle they claim to depict: that is the
    // property "not stale" actually means, and it holds by construction here.
    const builtAt = statSync(builtFile).mtimeMs;
    for (const outPath of written) {
      assert.ok(
        statSync(outPath).mtimeMs >= builtAt,
        `${outPath} should be at least as new as the bundle it depicts`,
      );
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('one shot is desktop-width and one is phone-width', () => {
  const widths = SHOTS.map((s) => s.width);
  assert.ok(widths.some((w) => w >= 1024), 'at least one shot is desktop-width');
  assert.ok(widths.some((w) => w <= 480), 'at least one shot is phone-width');
});

// Decodes an 8-bit RGB/RGBA non-interlaced PNG and returns the set of distinct
// pixel values, so a blank (single-colour) screenshot can be told from a real one.
function distinctPixels(buf) {
  let pos = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  assert.equal(depth, 8, 'bit depth 8');
  assert.ok(ctype === 2 || ctype === 6, `colour type 2 or 6, got ${ctype}`);
  assert.equal(interlace, 0, 'not interlaced');
  const bpp = ctype === 2 ? 3 : 4, stride = w * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  let prev = Buffer.alloc(stride);
  const seen = new Set();
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (ft === 1) add = a; else if (ft === 2) add = b; else if (ft === 3) add = (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = (line[i] + add) & 255;
    }
    for (let x = 0; x < w; x++) seen.add(line.readUIntBE(x * bpp, bpp));
    prev = line;
    if (seen.size >= 2) break;
  }
  return seen;
}

test('captureInstrumentShots writes idle/how/target shots per instrument and a contact sheet', async () => {
  assert.equal(typeof shots.captureInstrumentShots, 'function', 'captureInstrumentShots is exported');
  const outDir = mkdtempSync(join(tmpdir(), 'band-coach-inst-shots-'));
  try {
    const r = await shots.captureInstrumentShots({ htmlPath: HTML_PATH, outDir });
    const byId = Object.fromEntries(INSTRUMENTS.map((x) => [x.id, x]));
    assert.deepEqual([...r.ids].sort(), INSTRUMENTS.map((x) => x.id).sort());
    const dir = join(outDir, 'shots');
    const labels = SHOTS.map((s) => (s.mobile ? 'phone' : 'desktop'));
    const expectNoHow = INSTRUMENTS.filter((x) => howKindFor(x) == null).map((x) => x.id).sort();
    assert.deepEqual([...new Set(r.noHow)].sort(), expectNoHow);
    for (const id of r.ids) for (const l of labels) {
      assert.ok(existsSync(join(dir, `${id}-idle-${l}.png`)), `${id} idle ${l}`);
      assert.equal(existsSync(join(dir, `${id}-how-${l}.png`)), howKindFor(byId[id]) != null, `${id} how ${l}`);
      const tgt = existsSync(join(dir, `${id}-target-${l}.png`));
      const sk = r.skipped.find((s) => s.id === id && s.state === 'target' && s.size === l);
      assert.ok(tgt || (sk && sk.reason), `${id} target ${l} written or skipped with a reason`);
    }
    for (const p of r.written) {
      const bytes = readFileSync(p);
      assert.deepEqual(bytes.subarray(0, 8), PNG_MAGIC, `${p} PNG magic`);
      assert.ok(distinctPixels(bytes).size >= 2, `${p} is not a single colour`);
    }
    const sheet = readFileSync(join(dir, 'index.html'), 'utf8');
    assert.ok(!sheet.includes(outDir), 'sheet has no absolute paths');
    for (const p of r.written) assert.ok(sheet.includes(`src="${basename(p)}"`), `sheet references ${basename(p)}`);
    for (const id of r.noHow) assert.ok(sheet.includes(id) && sheet.includes('no how panel'));
    for (const s of r.skipped) assert.ok(sheet.includes(s.id) && sheet.includes(s.state) && sheet.includes(s.size));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
