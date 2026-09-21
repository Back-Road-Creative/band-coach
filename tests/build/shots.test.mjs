// CURRENT BEHAVIOUR: `npm run shots` must produce real, viewable PNGs of the
// built app -- not just report success. Before this, the only way to LOOK at
// the UI was a human pasting an ad hoc shell command; nothing in the repo
// proved a screenshot could be taken at all, so a UI regression could ship
// with zero visual evidence anywhere the next session (or CI) could see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureShots, SHOTS } from '../../build/shots.mjs';
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

test('one shot is desktop-width and one is phone-width', () => {
  const widths = SHOTS.map((s) => s.width);
  assert.ok(widths.some((w) => w >= 1024), 'at least one shot is desktop-width');
  assert.ok(widths.some((w) => w <= 480), 'at least one shot is phone-width');
});
