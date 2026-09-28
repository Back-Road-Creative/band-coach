// A one-note step's own match path used to have no chord window and no
// extras (src/ui/songs/practice.js's single-note branch of judgeAttempt) --
// a wrong note struck before the right one was silently absorbed by the
// forward-only search and never surfaced, so a maxExtras: 0 passRule (every
// song step sets this, src/song/lesson.js) let a try that heard a wrong note
// pass anyway. Now the single-note path counts a skipped, non-matching
// played event as an extra, same { count, list } shape the chord path uses
// (songs-extras-rule.test.mjs), while a same-pitch repeat of the expected
// note (a key bounce) stays absorbed, not an extra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeAttempt, passesRule } from '../../src/ui/songs/practice.js';

test('a wrong note struck before the right one on a one-note step counts as an extra (timed)', () => {
  const expected = [{ start: 0, dur: 480, midi: 60 }];
  const played = [{ midi: 62, atSec: 0 }, { midi: 60, atSec: 0.1 }];
  const result = judgeAttempt(expected, played, { bpm: 120, policy: 'exact' });
  assert.equal(result.hitCount, 1, 'the right note was still matched');
  assert.equal(result.extras.count, 1);
  assert.equal(result.extras.list[0].midi, 62);
  const passRule = { hitRate: 0.8, maxMeanErrorMs: null, maxExtras: 0 };
  assert.equal(passesRule(result, passRule), false, 'the wrong note before the right one fails a maxExtras 0 step');
});

test('a same-pitch repeat of the expected note (a key bounce) stays absorbed, not an extra (timed)', () => {
  const expected = [{ start: 0, dur: 480, midi: 60 }];
  const played = [{ midi: 60, atSec: 0 }, { midi: 60, atSec: 0.05 }];
  const result = judgeAttempt(expected, played, { bpm: 120, policy: 'exact' });
  assert.equal(result.hitCount, 1);
  assert.equal(result.extras.count, 0);
  const passRule = { hitRate: 0.8, maxMeanErrorMs: null, maxExtras: 0 };
  assert.equal(passesRule(result, passRule), true);
});

test('a single played note that matches has no extras (timed)', () => {
  const expected = [{ start: 0, dur: 480, midi: 60 }];
  const played = [{ midi: 60, atSec: 0 }];
  const result = judgeAttempt(expected, played, { bpm: 120, policy: 'exact' });
  assert.equal(result.hitCount, 1);
  assert.equal(result.extras.count, 0);
});

test('a wrong note before the right one on a "pitches" (timed: false) one-note step still counts as an extra', () => {
  const expected = [{ start: 0, dur: 480, midi: 60 }];
  const played = [{ midi: 62, atSec: 0 }, { midi: 60, atSec: 0.1 }];
  const result = judgeAttempt(expected, played, { bpm: 120, policy: 'exact', timed: false });
  assert.equal(result.hitCount, 1);
  assert.equal(result.extras.count, 1);
  assert.equal(result.extras.list[0].midi, 62);
  const passRule = { hitRate: 0.8, maxExtras: 0 };
  assert.equal(passesRule(result, passRule), false);
});

test('a same-pitch repeat stays absorbed on a "pitches" (timed: false) one-note step', () => {
  const expected = [{ start: 0, dur: 480, midi: 60 }];
  const played = [{ midi: 60, atSec: 0 }, { midi: 60, atSec: 0.05 }];
  const result = judgeAttempt(expected, played, { bpm: 120, policy: 'exact', timed: false });
  assert.equal(result.hitCount, 1);
  assert.equal(result.extras.count, 0);
  const passRule = { hitRate: 0.8, maxExtras: 0 };
  assert.equal(passesRule(result, passRule), true);
});
