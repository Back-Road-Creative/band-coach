// Wave: extras hold-clean. holdTuneFeedback() used to say "Hold each note a
// little longer" for EVERY failed durationScore, even when the learner
// actually over-held the notes (durRatio above practice.js's own
// durationTolerance.max, 1.5) -- the opposite of what they need to hear.
// Now it looks at the judged hits' durRatio values that fall outside the
// band and picks a direction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdTuneFeedback } from '../../src/ui/songs/practice.js';

function hit(durRatio) {
  return { ok: true, durRatio, errorMs: null, cents: null, velocityError: null };
}

test('holdTuneFeedback says "sooner" when every hit ran long (durRatio above the 1.5 max)', () => {
  const result = {
    hitRate: 1, meanErrorMs: null, meanAbsCents: 5, meanCents: 5, durationScore: 0, judgedCount: 3,
    matches: [hit(2.0), hit(2.2), hit(1.9)],
  };
  const passRule = { hitRate: 0.8, maxMeanErrorMs: null, minDurationScore: 0.6, maxMeanAbsCents: 40 };
  assert.equal(
    holdTuneFeedback(result, passRule),
    "Let each note go a little sooner — it's running into the next one."
  );
});

test('holdTuneFeedback still says "longer" when every hit ran short (durRatio below the 0.6 min)', () => {
  const result = {
    hitRate: 1, meanErrorMs: null, meanAbsCents: 5, meanCents: 5, durationScore: 0, judgedCount: 3,
    matches: [hit(0.2), hit(0.3), hit(0.1)],
  };
  const passRule = { hitRate: 0.8, maxMeanErrorMs: null, minDurationScore: 0.6, maxMeanAbsCents: 40 };
  assert.equal(holdTuneFeedback(result, passRule), 'Hold each note a little longer.');
});

test('holdTuneFeedback names both directions when hits ran both short and long', () => {
  const result = {
    hitRate: 1, meanErrorMs: null, meanAbsCents: 5, meanCents: 5, durationScore: 0, judgedCount: 2,
    matches: [hit(0.2), hit(2.0)],
  };
  const passRule = { hitRate: 0.8, maxMeanErrorMs: null, minDurationScore: 0.6, maxMeanAbsCents: 40 };
  assert.equal(
    holdTuneFeedback(result, passRule),
    "Match each note's length — some ran short, some ran long."
  );
});

test('holdTuneFeedback falls back to "longer" when the hold failed but no per-hit duration data is available', () => {
  const result = { hitRate: 1, meanErrorMs: null, meanAbsCents: 5, meanCents: 5, durationScore: 0.0, judgedCount: 1 };
  const passRule = { hitRate: 0.8, maxMeanErrorMs: null, minDurationScore: 0.6, maxMeanAbsCents: 40 };
  assert.equal(holdTuneFeedback(result, passRule), 'Hold each note a little longer.');
});
