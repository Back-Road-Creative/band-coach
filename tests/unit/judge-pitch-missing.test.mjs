import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgePitch } from '../../src/core/judge.js';
import { judgeAttempt } from '../../src/ui/songs/practice.js';

// A missing heard pitch (null: nothing heard at all, undefined: an event
// with no midi field) is never a match under any octave policy -- it must
// read as a miss, not as a lucky Math.round(null) === 0 hit on middle C.
for (const policy of ['exact', 'fold', 'nearest-octave']) {
  for (const heardMidi of [null, undefined]) {
    test(`judgePitch(${policy}): heardMidi=${heardMidi} is always a miss with reason 'no-pitch'`, () => {
      assert.deepEqual(judgePitch({ heardMidi, targetMidi: 60, policy }), { ok: false, reason: 'no-pitch' });
    });
  }
}

test('judgeAttempt: a null heard midi never matches C under fold (was a false hit on Math.round(null) === 0)', () => {
  const expected = [{ start: 0, dur: 480, midi: 60 }];
  const played = [{ midi: null, atSec: 0 }];
  const result = judgeAttempt(expected, played, { bpm: 120, ticksPerQuarter: 480, policy: 'fold', timed: false });
  assert.equal(result.hitRate, 0);
});
