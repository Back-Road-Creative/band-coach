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
import { build, moduleBytes, bundleBreakdown } from '../../build/build.mjs';

const VOICES = 'src/audio/voices.js';
const VOICE_BUDGET_BYTES = 40 * 1024;

// The breakdown is what makes a ceiling failure actionable: without it, "the
// bundle is 41 KB over" names no culprit. These are unit tests on the real
// dev bundle -- the SAME bundle the ceiling test below measures -- because a
// breakdown computed from anything else could disagree with what the ceiling
// is actually enforcing.
test('bundleBreakdown sorts modules biggest-first and rolls up by directory', async () => {
  const { modules, total, byDirectory } = await bundleBreakdown();

  assert.ok(modules.length > 0, 'expected at least one module in the bundle');
  for (let i = 1; i < modules.length; i++) {
    assert.ok(
      modules[i - 1].bytes >= modules[i].bytes,
      `modules not sorted descending at index ${i}: ${modules[i - 1].path} (${modules[i - 1].bytes}) `
        + `before ${modules[i].path} (${modules[i].bytes})`,
    );
  }

  const directorySum = Object.values(byDirectory).reduce((sum, n) => sum + n, 0);
  assert.equal(directorySum, total, 'the directory rollup must sum to the same total as the per-module list');

  const moduleTotal = modules.reduce((sum, m) => sum + m.bytes, 0);
  assert.equal(moduleTotal, total, 'the reported total must equal the sum of the per-module bytes');

  assert.ok(
    modules.some((m) => m.path === VOICES),
    `expected ${VOICES} to be present in the breakdown`,
  );
  assert.ok(
    'src/audio' in byDirectory,
    'expected the src/audio rollup (voices.js\'s directory) to be present',
  );
});

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
// has a ceiling too. Current size is ~590KB; this leaves room to build
// without leaving room to embed a media library by accident.
const TOTAL_BUDGET_BYTES = 640 * 1024;

test('the built single-file app stays under its total size ceiling', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'band-coach-total-budget-'));
  try {
    const outFile = await build({ outDir });
    const bytes = statSync(outFile).size;

    // Printed unconditionally (not only on failure): the whole point of a
    // breakdown is that a future ceiling failure already has the "where did
    // the bytes go" answer sitting in the log that ran right before it went
    // red, not a number to go re-derive by hand under time pressure.
    const { modules, byDirectory } = await bundleBreakdown();
    console.log('--- bundle breakdown: top 15 modules ---');
    for (const m of modules.slice(0, 15)) {
      console.log(`  ${m.bytes.toString().padStart(7)}  ${m.path}`);
    }
    console.log('--- bundle breakdown: by directory ---');
    for (const [dir, dirBytes] of Object.entries(byDirectory).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${dirBytes.toString().padStart(7)}  ${dir}`);
    }
    console.log(`dist/band-coach.html: ${bytes} bytes (ceiling ${TOTAL_BUDGET_BYTES}, `
      + `headroom ${TOTAL_BUDGET_BYTES - bytes} bytes)`);

    assert.ok(
      bytes <= TOTAL_BUDGET_BYTES,
      `the built app is ${bytes} bytes, ceiling is ${TOTAL_BUDGET_BYTES} -- `
        + 'it has to stay a file someone can download and double-click',
    );
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
