// Enforces the byte budget for synthesized instrument voices
// (src/audio/voices.js): the spike this unit replaces rejected embedding a
// +2.15MB sample library as too big for a double-click single-file app, so
// the alternative -- Web Audio synthesis -- must earn its keep by staying
// cheap. This is an upstream gate on the build artifact itself, not a
// number quoted in a PR description.
//
// It used to measure the size of the whole built FILE minus a baseline
// captured at commit 1319b31, before voices.js existed. That charges every
// byte added anywhere since that commit to a budget named after one audio
// module: a UI change 400 commits later failed this test (41027 bytes
// against a 40960 budget) while voices.js itself was using under 4KB of it.
// A budget has to measure its own subject, so this now reads voices.js's
// real contribution out of esbuild's metafile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, moduleBytes } from '../../build/build.mjs';

const VOICES = 'src/audio/voices.js';
const VOICE_BUDGET_BYTES = 40 * 1024;

test('synthesized instrument voices cost at most 40KB of the bundle', async () => {
  const bytes = await moduleBytes(VOICES);
  console.log(`${VOICES}: ${bytes} bytes in the dev bundle (budget ${VOICE_BUDGET_BYTES})`);
  assert.ok(
    bytes <= VOICE_BUDGET_BYTES,
    `${VOICES} contributes ${bytes} bytes, budget is ${VOICE_BUDGET_BYTES} -- `
      + 'synthesis was chosen over a 2.15MB sample library precisely to stay small',
  );
});

// moduleBytes() throws on an unknown path rather than returning 0, so this
// budget cannot quietly pass by measuring a module that no longer exists
// under that name. Without this, renaming voices.js would turn the gate above
// into a no-op that reports success for ever.
test('the voices budget fails loudly if its module is renamed away', async () => {
  await assert.rejects(
    () => moduleBytes('src/audio/does-not-exist.js'),
    /is not in the bundle/,
    'a missing module must throw, never measure as zero',
  );
});

// A SEPARATE concern from the voices budget, named separately rather than
// ridden along on it: the whole point of this app is a single file a
// non-technical person downloads and double-clicks, so the bundle as a whole
// has a ceiling too. It was 640KB. Raised to 1MB per plan decision D1 ("raise
// only if A1's breakdown shows T0 cannot fit -- then to 1 MB, measured"):
// measured 645,040 bytes on main after the dead-code sweep found 0 bytes to
// cut, with the next open features alone needing ~13KB more. The release
// file is minified (~362KB) and has its own 1.5MB gate in tests/release.
// 1MB still leaves no room to embed a media library by accident.
const TOTAL_BUDGET_BYTES = 1024 * 1024;

test('the built single-file app stays under its total size ceiling', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'band-coach-total-budget-'));
  try {
    const outFile = await build({ outDir });
    const bytes = statSync(outFile).size;
    console.log(`dist/band-coach.html: ${bytes} bytes (ceiling ${TOTAL_BUDGET_BYTES})`);
    assert.ok(
      bytes <= TOTAL_BUDGET_BYTES,
      `the built app is ${bytes} bytes, ceiling is ${TOTAL_BUDGET_BYTES} -- `
        + 'it has to stay a file someone can download and double-click',
    );
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
