// Songs kit steps with a device whose closed and open hi-hat share one note: the hit carries `alt` (the other hat piece) and the judge, timed
// and in any-order, takes it for either hat piece. A hit without `alt` still has to name the exact piece.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeAttempt } from '../../src/ui/songs/practice.js';

const note = (start, piece) => ({ start, dur: 480, midi: 42, piece });
const run = (expected, played, timed = true) => judgeAttempt(expected, played, { bpm: 100, ticksPerQuarter: 480, percussion: true, timed });

for (const timed of [true, false]) {
  const kind = timed ? 'timed' : 'order';
  test(kind + ': a shared hat hit passes an open-hat note', () => {
    const r = run([note(0, 'hihat-open')], [{ piece: 'hihat-closed', alt: 'hihat-open', atSec: 0, source: 'midi' }], timed);
    assert.deepEqual(r.matches.map(m => m.pieceOk), [true]);
  });
  test(kind + ': a shared hat hit passes a closed-hat note (single-hit control)', () => {
    const r = run([note(0, 'hihat-closed')], [{ piece: 'hihat-closed', alt: 'hihat-open', atSec: 0, source: 'midi' }], timed);
    assert.deepEqual(r.matches.map(m => m.pieceOk), [true]);
  });
  test(kind + ': without the share a closed hit on an open note is the wrong drum (control)', () => {
    const r = run([note(0, 'hihat-open')], [{ piece: 'hihat-closed', atSec: 0, source: 'midi' }], timed);
    assert.deepEqual(r.matches.map(m => m.pieceOk), [false]);
  });
  test(kind + ': a shared hat hit never passes a snare note', () => {
    const r = run([note(0, 'snare')], [{ piece: 'hihat-closed', alt: 'hihat-open', atSec: 0, source: 'midi' }], timed);
    assert.deepEqual(r.matches.map(m => m.pieceOk), [false]);
  });
}
