// Characterizes build/apply-review.mjs: applies a review packet's downloaded
// result file to src/instruments/review-ledger.js's LEDGER literal, and only
// that literal -- the rest of the file, and the real file on disk, must come
// out byte-identical. Fixture reviewer/reference names are invented, never a
// real person; every rev comes from reviewItems('kbd') at test time, never a
// hard-coded hash (a curriculum edit would otherwise silently rot this file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { reviewItems } from '../../build/review-packet.mjs';
import { LEDGER } from '../../src/instruments/review-ledger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_PATH = path.join(__dirname, '..', '..', 'src', 'instruments', 'review-ledger.js');
const LESSON_RESUME_PATH = path.join(__dirname, '..', '..', 'src', 'song', 'lesson-resume.js');
const LEDGER_SOURCE = readFileSync(LEDGER_PATH, 'utf8');

const { validateResult, applyReviewResult } = await import('../../build/apply-review.mjs');

const KBD_ITEMS = reviewItems('kbd');
const CURR1 = KBD_ITEMS.find((i) => i.id === 'kbd.curriculum.1');

function baseResult(overrides = {}) {
  return {
    schema: 'band-coach-review-result/1',
    instrument: 'kbd',
    reference: 'Test Method Book',
    reviewedBy: 'Test Reviewer',
    reviewedAt: '2026-09-27',
    items: [{ id: CURR1.id, rev: CURR1.rev, verdict: 'pass', note: '' }],
    ...overrides
  };
}

// Writes a module's source text to a tmp file with its relative
// lesson-resume.js import rewritten to an absolute file:// URL, then
// dynamic-imports it -- the only way to load the rewritten LEDGER module
// from outside src/instruments/ without also copying its sibling files.
async function importRewritten(source) {
  const patched = source.replace(
    "'../song/lesson-resume.js'",
    JSON.stringify(pathToFileURL(LESSON_RESUME_PATH).href)
  );
  const dir = mkdtempSync(path.join(tmpdir(), 'apply-review-'));
  const file = path.join(dir, 'review-ledger.mjs');
  writeFileSync(file, patched, 'utf8');
  return import(pathToFileURL(file).href);
}

test('a pass row at the current rev makes the entry current, and stale otherwise', async () => {
  const result = baseResult();
  const { source, applied, corrections } = applyReviewResult(result, { ledgerSource: LEDGER_SOURCE });
  assert.deepEqual(applied, [CURR1.id]);
  assert.deepEqual(corrections, []);
  const mod = await importRewritten(source);
  const { isReviewCurrent } = await import('../../src/instruments/review.js');
  assert.equal(isReviewCurrent(mod.itemReview(CURR1.id, CURR1.rev)), true);
  assert.equal(isReviewCurrent(mod.itemReview(CURR1.id, 'deadbeef')), false);
  for (const [id, entry] of Object.entries(mod.LEDGER)) {
    assert.ok(typeof entry.reference === 'string' && entry.reference.length > 0, id + ': missing reference');
    assert.ok(typeof entry.reviewedBy === 'string' && entry.reviewedBy.length > 0, id + ': missing reviewedBy');
    assert.ok(typeof entry.reviewedAt === 'string' && entry.reviewedAt.length > 0, id + ': missing reviewedAt');
    assert.equal(typeof entry.reviewedRev, 'string', id + ': reviewedRev must be a string');
  }
});

test('a stale rev is refused, naming the id', () => {
  const result = baseResult({ items: [{ id: CURR1.id, rev: 'deadbeef', verdict: 'pass', note: '' }] });
  assert.throws(
    () => applyReviewResult(result, { ledgerSource: LEDGER_SOURCE }),
    (err) => /kbd\.curriculum\.1/.test(err.message) && /stale/.test(err.message)
  );
});

test('an unknown id is refused, naming the id', () => {
  const result = baseResult({ items: [{ id: 'kbd.curriculum.999', rev: 'deadbeef', verdict: 'pass', note: '' }] });
  assert.throws(
    () => applyReviewResult(result, { ledgerSource: LEDGER_SOURCE }),
    (err) => /kbd\.curriculum\.999/.test(err.message) && /unknown id/.test(err.message)
  );
});

test('an empty or blank reference is refused', () => {
  for (const reference of ['', '   ']) {
    const result = baseResult({ reference });
    assert.throws(
      () => applyReviewResult(result, { ledgerSource: LEDGER_SOURCE }),
      /reference/
    );
  }
});

test('a missing reviewedBy is refused', () => {
  const result = baseResult({ reviewedBy: '' });
  assert.throws(() => applyReviewResult(result, { ledgerSource: LEDGER_SOURCE }), /reviewedBy/);
});

test('a malformed or invalid-calendar reviewedAt is refused', () => {
  for (const reviewedAt of ['27/09/2026', '2026-02-30']) {
    const result = baseResult({ reviewedAt });
    assert.throws(() => applyReviewResult(result, { ledgerSource: LEDGER_SOURCE }), /reviewedAt/);
  }
});

test('a correction row is never written but is returned for a human to act on', () => {
  const result = baseResult({ items: [{ id: CURR1.id, rev: CURR1.rev, verdict: 'correction', note: 'wrong note order' }] });
  const { source, applied, corrections } = applyReviewResult(result, { ledgerSource: LEDGER_SOURCE });
  assert.deepEqual(applied, []);
  assert.deepEqual(corrections, [{ id: CURR1.id, note: 'wrong note order' }]);
  assert.ok(!new RegExp(CURR1.id).test(source.slice(source.indexOf('LEDGER'), source.indexOf(');', source.indexOf('LEDGER')))));
});

test('the rewrite is confined to the LEDGER statement; everything else is byte-identical', () => {
  const result = baseResult();
  const { source } = applyReviewResult(result, { ledgerSource: LEDGER_SOURCE });
  const anchor = 'export const LEDGER = Object.freeze(';
  const beforeIn = LEDGER_SOURCE.slice(0, LEDGER_SOURCE.indexOf(anchor));
  const beforeOut = source.slice(0, source.indexOf(anchor));
  assert.equal(beforeOut, beforeIn);
  const afterIn = LEDGER_SOURCE.slice(LEDGER_SOURCE.indexOf(');', LEDGER_SOURCE.indexOf(anchor)) + 2);
  const afterOut = source.slice(source.indexOf(');', source.indexOf(anchor)) + 2);
  assert.equal(afterOut, afterIn);
});

test('a second apply on top of the first keeps both entries, and quotes/parens round-trip', () => {
  const first = applyReviewResult(baseResult(), { ledgerSource: LEDGER_SOURCE });
  const second = KBD_ITEMS.find((i) => i.id === 'kbd.curriculum.2');
  const trickyRef = 'Book "Two" -- level 1);';
  const secondResult = baseResult({
    reference: trickyRef,
    items: [{ id: second.id, rev: second.rev, verdict: 'pass', note: '' }]
  });
  const applied2 = applyReviewResult(secondResult, { ledgerSource: first.source });
  assert.deepEqual(applied2.applied, [second.id]);
  const mod = importRewritten(applied2.source);
  return mod.then((m) => {
    assert.ok(m.LEDGER[CURR1.id]);
    assert.ok(m.LEDGER[second.id]);
    assert.equal(m.LEDGER[second.id].reference, trickyRef);
  });
});

test('applying to the script\'s own prior output still works', () => {
  const first = applyReviewResult(baseResult(), { ledgerSource: LEDGER_SOURCE });
  assert.doesNotThrow(() => applyReviewResult(baseResult(), { ledgerSource: first.source }));
});

test('validateResult reports every problem for a badly-shaped file at once', () => {
  const { ok, errors } = validateResult({ schema: 'wrong', instrument: 'kbd', items: 'not-an-array' }, KBD_ITEMS);
  assert.equal(ok, false);
  assert.ok(errors.length > 0);
});

test('an unsupported instrument is caught and reported alongside other problems', () => {
  const result = baseResult({ instrument: 'gtr', reference: '', reviewedBy: '', reviewedAt: 'bad' });
  assert.throws(
    () => applyReviewResult(result, { ledgerSource: LEDGER_SOURCE }),
    (err) => /instrument/.test(err.message) && /reference/.test(err.message)
  );
});

test('an item missing its rev names the id, not a generic message', () => {
  const result = baseResult({ items: [{ id: CURR1.id, verdict: 'pass', note: '' }] });
  assert.throws(
    () => applyReviewResult(result, { ledgerSource: LEDGER_SOURCE }),
    (err) => /kbd\.curriculum\.1/.test(err.message) && /rev/.test(err.message)
  );
});

test('the real ledger file on disk is untouched by this suite', () => {
  const bytesNow = readFileSync(LEDGER_PATH, 'utf8');
  assert.equal(bytesNow, LEDGER_SOURCE);
});

test('CLI: a stale result exits 1 and names the stale id, writing to --ledger only', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'apply-review-cli-'));
  const ledgerCopy = path.join(dir, 'review-ledger.js');
  writeFileSync(ledgerCopy, LEDGER_SOURCE, 'utf8');
  const resultFile = path.join(dir, 'result.json');
  writeFileSync(resultFile, JSON.stringify(baseResult({ items: [{ id: CURR1.id, rev: 'deadbeef', verdict: 'pass', note: '' }] })), 'utf8');
  const scriptPath = path.join(__dirname, '..', '..', 'build', 'apply-review.mjs');
  const res = spawnSync('node', [scriptPath, resultFile, '--ledger', ledgerCopy], { encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.match(res.stdout + res.stderr, /kbd\.curriculum\.1/);
  assert.equal(readFileSync(ledgerCopy, 'utf8'), LEDGER_SOURCE);
});

// `npm run review-apply` runs the script from the package root, so a relative
// path the player typed from a subfolder must resolve against the folder they
// typed it in (npm's INIT_CWD), not the package root.
test('CLI: relative result and --ledger paths resolve against the folder npm was run from', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'apply-review-initcwd-'));
  writeFileSync(path.join(dir, 'review-ledger.js'), LEDGER_SOURCE, 'utf8');
  writeFileSync(path.join(dir, 'result.json'), JSON.stringify(baseResult({ items: [{ id: CURR1.id, rev: 'deadbeef', verdict: 'pass', note: '' }] })), 'utf8');
  const scriptPath = path.join(__dirname, '..', '..', 'build', 'apply-review.mjs');
  const res = spawnSync('node', [scriptPath, 'result.json', '--ledger', 'review-ledger.js'], {
    encoding: 'utf8', cwd: path.join(__dirname, '..', '..'), env: { ...process.env, INIT_CWD: dir }
  });
  assert.doesNotMatch(res.stdout + res.stderr, /ENOENT/);
  assert.match(res.stdout + res.stderr, /kbd\.curriculum\.1/, 'it read the result file and refused the stale rev');
  assert.equal(res.status, 1);
});
