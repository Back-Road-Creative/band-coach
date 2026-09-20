// Enforces the byte budget for synthesized instrument voices
// (src/audio/voices.js): the spike this unit replaces rejected embedding a
// +2.15MB sample library as too big for a double-click single-file app, so
// the alternative -- Web Audio synthesis -- must earn its keep by staying
// cheap. This is an upstream gate on the build artifact itself, not a
// number quoted in a PR description.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../../build/build.mjs';

const OUT_DIR = mkdtempSync(join(tmpdir(), 'band-coach-voice-budget-'));
after(() => rmSync(OUT_DIR, { recursive: true, force: true }));

// Measured on origin/main before src/audio/voices.js existed (git show
// 1319b31:build -- built the dev bundle and stat'd it).
const BASELINE_BYTES = 549475;
const BUDGET_BYTES = 40 * 1024;

test('the dev build (dist/band-coach.html) grows by at most 40KB adding instrument voices', async () => {
  const outFile = await build({ outDir: OUT_DIR });
  const bytes = statSync(outFile).size;
  const grew = bytes - BASELINE_BYTES;
  console.log(`dist/band-coach.html: ${bytes} bytes (baseline ${BASELINE_BYTES}, grew ${grew})`);
  assert.ok(grew <= BUDGET_BYTES, `grew by ${grew} bytes, budget is ${BUDGET_BYTES}`);
});
