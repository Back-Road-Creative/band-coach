// CURRENT BEHAVIOUR: `npm run shots` must produce real, viewable PNGs of the
// built app -- not just report success. Before this, the only way to LOOK at
// the UI was a human pasting an ad hoc shell command; nothing in the repo
// proved a screenshot could be taken at all, so a UI regression could ship
// with zero visual evidence anywhere the next session (or CI) could see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureShots, shoot, SHOTS } from '../../build/shots.mjs';
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
