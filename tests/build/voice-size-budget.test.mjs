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
// has a ceiling too. It was 640KB. Raised to 1MB per plan decision D1 ("raise
// only if A1's breakdown shows T0 cannot fit -- then to 1 MB, measured"):
// measured 645,040 bytes on main after the dead-code sweep found 0 bytes to
// cut, with the next open features alone needing ~13KB more. The release
// file is minified (~362KB) and has its own 1.5MB gate in tests/release.
// 1MB still leaves no room to embed a media library by accident.
// Raised again to 1.125MB (2026-09-27), measured the same way: main (00c5f76,
// after level 14) built to 1,050,348 bytes, over by 1,772, with no comments in
// the dev build to cut. The keyboard pathway's open units add bundled JS on
// top (measured at each pushed head against its base: +2.9KB to +6.3KB each,
// about 55KB for the whole pathway). 1.125MB leaves about 74KB past that and
// still leaves no room for a media library. The downloaded (release) file was
// 575,707 bytes against its own 1.5MB gate.
// Raised again to 1.15MB (2026-10-05), measured the same way: main (14fd84d,
// after the first hardening merges) built to 1,179,490 bytes, 158 under, with no
// comments in the dev build to cut. The open hardening units add, each measured
// at its pushed head against its base: +144 (store shell), +229 (stress test's
// leak fix), +336 (Pages CSP), +1,483 (storage blocked), +2,931 (error notice
// and Copy diagnostics), about 5.1KB in all. 1.15MB leaves about 21KB past that
// and still leaves no room for a media library.
// Raised again to 1.2MB (2026-10-20), measured the same way: main (d219cf6f
// plus the variant-names fix) built to 1,202,536 bytes, 3,326 under. The
// Spanish units of plan v4 (D21) add translated text, which has no comments
// to cut: L2 (level names) measured 1,210,823 at its head, +8,287. L3 (Songs
// status messages, 46 keys in two languages) and L4 (coach lines) come next.
// 1.2MB leaves about 47KB past L2 and still no room for a media library.
// Raised again to 1.25MB (2026-10-24), measured the same way: main (499e03f,
// after kit MIDI learn and the kit-name translations) built to 1,249,100
// bytes, 9,191 under. U11 (settings and progress screens, both languages)
// measured 1,262,945 merged onto that main, +13,845, which is 4,654 over.
// 1.25MB leaves about 47KB past U11 and still no room for a media library.
// Raised again to 1.3MB (2026-10-25), measured the same way: main (78757dc)
// built to 1,311,845 bytes, 1,125 over, so main itself went red. #593 and
// #594 each fit on their own base; landing together they did not. The next
// two units measured on that main: the Install offer and copy age at
// 1,314,438 (+2,593) and end-on-a-win at 1,314,719 (+2,874). 1.3MB leaves
// about 51KB past main and still no room for a media library.
// Raised again to 1.35MB (2026-10-25), measured the same way: the erase-all
// unit (U32a, stacked on main after #614) built to 1,362,649 bytes, 499 under.
// U34a (learn the keyboard's lowest and highest key, both languages) measured
// 1,368,304 on top of it, +5,655, which is 5,156 over. 1.35MB leaves about
// 47KB past U34a and still no room for a media library.
const TOTAL_BUDGET_BYTES = Math.floor(1.35 * 1024 * 1024);

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
