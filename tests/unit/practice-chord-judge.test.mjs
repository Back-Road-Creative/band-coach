import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeAttempt } from '../../src/ui/songs/practice.js';

// A chord: three expected notes sharing the same start tick. A keyboard
// player's MIDI events for a chord arrive in whatever order the fingers
// land, not the order the notes are listed in the song, and even a
// "rolled" chord (fingers land a few ms apart) is still one chord, not a
// sequence of misses.

test('a chord played in reverse order is fully matched, not marked missed', () => {
  const expected = [{ start: 0, dur: 480, midi: 60 }, { start: 0, dur: 480, midi: 64 }, { start: 0, dur: 480, midi: 67 }];
  const played = [{ midi: 67, atSec: 0 }, { midi: 64, atSec: 0.01 }, { midi: 60, atSec: 0.02 }];
  const result = judgeAttempt(expected, played, { bpm: 120, policy: 'exact' });
  assert.equal(result.hitCount, 3);
  assert.equal(result.hitRate, 1);
});

test('a rolled chord within the spread window is fully matched', () => {
  const expected = [{ start: 0, dur: 480, midi: 60 }, { start: 0, dur: 480, midi: 64 }, { start: 0, dur: 480, midi: 67 }];
  // 60ms of total roll, well inside the 80ms spread constant.
  const played = [{ midi: 60, atSec: 0 }, { midi: 64, atSec: 0.03 }, { midi: 67, atSec: 0.06 }];
  const result = judgeAttempt(expected, played, { bpm: 120, policy: 'exact' });
  assert.equal(result.hitCount, 3);
  assert.equal(result.hitRate, 1);
});

test('one missing chord note is the only one marked missed', () => {
  const expected = [{ start: 0, dur: 480, midi: 60 }, { start: 0, dur: 480, midi: 64 }, { start: 0, dur: 480, midi: 67 }];
  const played = [{ midi: 60, atSec: 0 }, { midi: 67, atSec: 0.01 }]; // 64 never played
  const result = judgeAttempt(expected, played, { bpm: 120, policy: 'exact' });
  assert.equal(result.hitCount, 2);
  assert.equal(result.hitRate, 2 / 3);
  const missed = result.matches.find((m) => m.note.midi === 64);
  assert.equal(missed.ok, false);
  const hit60 = result.matches.find((m) => m.note.midi === 60);
  const hit67 = result.matches.find((m) => m.note.midi === 67);
  assert.equal(hit60.ok, true);
  assert.equal(hit67.ok, true);
});

test('an extra wrong note struck alongside a chord is reported as an extra, not a miss', () => {
  const expected = [{ start: 0, dur: 480, midi: 60 }, { start: 0, dur: 480, midi: 64 }];
  const played = [{ midi: 60, atSec: 0 }, { midi: 61, atSec: 0.02 }, { midi: 64, atSec: 0.04 }];
  const result = judgeAttempt(expected, played, { bpm: 120, policy: 'exact' });
  assert.equal(result.hitCount, 2);
  assert.equal(result.hitRate, 1);
  assert.equal(result.extras.count, 1);
  assert.equal(result.extras.list.length, 1);
  assert.equal(result.extras.list[0].midi, 61);
});

test('per-note timing error inside a chord is measured against each note actually played, not the anchor', () => {
  const expected = [{ start: 0, dur: 480, midi: 60 }, { start: 0, dur: 480, midi: 64 }];
  // 120bpm -> start=0 expected at 0s. Note 60 played dead on time, note 64
  // played 50ms late (still inside the spread window).
  const played = [{ midi: 60, atSec: 0 }, { midi: 64, atSec: 0.05 }];
  const result = judgeAttempt(expected, played, { bpm: 120, policy: 'exact' });
  const m60 = result.matches.find((m) => m.note.midi === 60);
  const m64 = result.matches.find((m) => m.note.midi === 64);
  assert.equal(m60.errorMs, 0);
  assert.equal(m64.errorMs, 50);
});

test('a chord followed by a single note still judges the single note correctly (no regression to forward-only cursor)', () => {
  const expected = [
    { start: 0, dur: 480, midi: 60 },
    { start: 0, dur: 480, midi: 64 },
    { start: 480, dur: 480, midi: 67 },
  ];
  const played = [{ midi: 64, atSec: 0 }, { midi: 60, atSec: 0.01 }, { midi: 67, atSec: 0.5 }];
  const result = judgeAttempt(expected, played, { bpm: 120, policy: 'exact' });
  assert.equal(result.hitCount, 3);
  assert.equal(result.hitRate, 1);
});
