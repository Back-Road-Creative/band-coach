// `npm run stage` copies the built release file to the drive the hand check
// is run from (D: on the Windows box, `/mnt/d` under WSL), so nobody has to
// walk a \\wsl.localhost path by hand. These pin the copy helper itself; the
// build it runs first is covered by tests/release/gate.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync as readSrc } from 'node:fs';
import { stage } from '../../build/stage.mjs';

function tmp() { return mkdtempSync(join(tmpdir(), 'bc-stage-')); }

test('stage copies the file into the target dir under its own name and reports hash and size', () => {
  const src = tmp(); const dst = tmp();
  try {
    const from = join(src, 'band-coach.html');
    writeFileSync(from, '<!doctype html><title>x</title>');
    const r = stage({ from, dir: dst });
    assert.equal(r.to, join(dst, 'band-coach.html'));
    assert.equal(readFileSync(r.to, 'utf8'), '<!doctype html><title>x</title>');
    assert.equal(r.bytes, 31);
    assert.equal(r.sha256, createHash('sha256').update(readFileSync(from)).digest('hex'));
  } finally { rmSync(src, { recursive: true }); rmSync(dst, { recursive: true }); }
});

test('stage overwrites an older copy rather than leaving it beside the new one', () => {
  const src = tmp(); const dst = tmp();
  try {
    const from = join(src, 'band-coach.html');
    writeFileSync(join(dst, 'band-coach.html'), 'old');
    writeFileSync(from, 'new');
    const r = stage({ from, dir: dst });
    assert.equal(readFileSync(r.to, 'utf8'), 'new');
  } finally { rmSync(src, { recursive: true }); rmSync(dst, { recursive: true }); }
});

test('stage refuses a target dir that does not exist instead of creating a drive-shaped path', () => {
  const src = tmp();
  try {
    const from = join(src, 'band-coach.html');
    writeFileSync(from, 'x');
    const missing = join(src, 'no-such-drive');
    assert.throws(() => stage({ from, dir: missing }), /no-such-drive/);
    assert.equal(existsSync(missing), false);
  } finally { rmSync(src, { recursive: true }); }
});

test('stage refuses a missing source file with a message that names it', () => {
  const dst = tmp();
  try {
    assert.throws(() => stage({ from: join(dst, 'nope.html'), dir: dst }), /nope\.html/);
  } finally { rmSync(dst, { recursive: true }); }
});

test('stage writes the bytes itself rather than calling copyFileSync, which EPERMs on the WSL D: mount', () => {
  const src = readSrc(new URL('../../build/stage.mjs', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /copyFileSync|copyFile\(/);
  assert.match(code, /writeFileSync\(to, data\)/);
});
