// Wave: extras hold-clean. Every judged practice step (everything but
// 'listen', which has no passRule at all) should refuse to pass an attempt
// that played wrong extra notes alongside a chord -- see
// tests/unit/songs-extras-rule.test.mjs for passesRule()'s side of this.
// buildLessonPlan is the only place that writes passRule, so this is where
// maxExtras: 0 has to be added for every step kind.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildLessonPlan } from '../../src/song/lesson.js';
import gtr from '../../src/instruments/gtr.js';
import cello from '../../src/instruments/cello.js';

function oneNoteSong() {
  return {
    schema: 'song/1', id: 'extras-song', title: 'Extras Song', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
    parts: [{ id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 1920, midi: 60 }] }],
    chords: []
  };
}

// A rest before the second note forces two phrases, so both chain and whole
// steps exist alongside every per-phrase step kind.
function twoPhraseSong() {
  return {
    schema: 'song/1', id: 'extras-song-2', title: 'Extras Song 2', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
    parts: [{
      id: 'melody', name: 'Melody', notes: [
        { start: 0, dur: 480, midi: 60 }, { start: 480, dur: 480, midi: 62 },
        { start: 3840, dur: 480, midi: 64 }, { start: 4320, dur: 480, midi: 65 }
      ]
    }],
    chords: []
  };
}

test('every judged step kind carries maxExtras 0 on a non-sustaining instrument', () => {
  const plan = buildLessonPlan(twoPhraseSong(), 'melody', gtr);
  const byKind = {};
  for (const step of plan.steps) (byKind[step.kind] = byKind[step.kind] || []).push(step);
  assert.equal(byKind.listen[0].passRule, null, 'listen has nothing to judge');
  for (const kind of ['rhythm', 'pitches', 'phrase-slow', 'tempo-ladder', 'chain', 'whole']) {
    for (const step of byKind[kind]) {
      assert.equal(step.passRule.maxExtras, 0, kind + ' step should refuse extra notes');
    }
  }
});

test('every judged step kind carries maxExtras 0 on a sustaining instrument too (sustainRules does not drop it)', () => {
  const plan = buildLessonPlan(oneNoteSong(), 'melody', cello);
  for (const step of plan.steps) {
    if (step.kind === 'listen') continue;
    assert.equal(step.passRule.maxExtras, 0, step.kind + ' step should refuse extra notes');
  }
});
