// The src/core line-coverage floor behind `npm run coverage` (package.json).
// Reads the lcov file the coverage run wrote and exits non-zero when the
// src/core line coverage falls below COVERAGE_FLOOR_PERCENT. Not a *.test.mjs
// file on purpose: it needs a finished coverage run, so the normal test globs
// must not pick it up. tests/unit/coverage-floor.test.mjs tests the logic.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Measured src/core line coverage, rounded down: 98.75% (5364 of 5432 lines, 48 files) on 2026-10-05,
// from per-batch lcovs merged by hand (the browser-launching unit tests were not in that merge).
// The first weekly `npm run coverage` run prints the exact figure for the real command.
// Raise it when coverage rises; never lower it to get a run green (a test pins it at 98 or more).
export const COVERAGE_FLOOR_PERCENT = 98;

// lcov text -> { found, hit, percent } for every file whose path sits under `dir`.
// percent is null when no file under `dir` was reported at all.
export function lineCoverageUnder(lcov, dir) {
  const prefix = dir.replace(/\/+$/, '') + '/';
  let found = 0;
  let hit = 0;
  let inside = false;
  for (const raw of String(lcov).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      const file = line.slice(3).replace(/\\/g, '/');
      inside = file.startsWith(prefix) || file.includes('/' + prefix);
    } else if (inside && line.startsWith('LF:')) found += Number(line.slice(3)) || 0;
    else if (inside && line.startsWith('LH:')) hit += Number(line.slice(3)) || 0;
  }
  return { found, hit, percent: found ? (hit / found) * 100 : null };
}

// -> { ok, percent, message }. A missing report is a failure, never a pass.
export function checkFloor(lcov, floor = COVERAGE_FLOOR_PERCENT, dir = 'src/core') {
  const { found, hit, percent } = lineCoverageUnder(lcov, dir);
  if (percent === null) return { ok: false, percent: null, message: 'coverage floor: no ' + dir + ' files in the report, so the floor cannot be checked' };
  const shown = percent.toFixed(2);
  if (percent < floor) return { ok: false, percent, message: 'coverage floor: ' + dir + ' line coverage ' + shown + '% (' + hit + '/' + found + ') is below the floor of ' + floor + '%' };
  return { ok: true, percent, message: 'coverage floor: ' + dir + ' line coverage ' + shown + '% (' + hit + '/' + found + ') meets the floor of ' + floor + '%' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let result;
  try {
    result = checkFloor(readFileSync(process.argv[2] || 'coverage/lcov.info', 'utf8'));
  } catch (err) {
    result = { ok: false, message: 'coverage floor: cannot read the lcov report (' + err.message + ')' };
  }
  console.log(result.message);
  process.exit(result.ok ? 0 : 1);
}
