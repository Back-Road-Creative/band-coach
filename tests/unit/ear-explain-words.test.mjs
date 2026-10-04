// "Show me the answer" text must be in words a beginner can read: note names
// (with octave) and beats, never raw MIDI numbers or ticks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make as melodic } from '../../src/core/ear/melodic-dictation.js';
import { make as song } from '../../src/core/ear/song-dictation.js';
import { make as sing } from '../../src/core/ear/sing-back.js';
import { make as inversions } from '../../src/core/ear/inversions.js';
import { make as rhythm, beatsText } from '../../src/core/ear/rhythm-dictation.js';
import { make as songRhythm } from '../../src/core/ear/song-rhythm.js';
import { name } from '../../src/core/note-names.js';

test('pitched explanations list note names with octave, not MIDI numbers', () => {
  for (const [make, level] of [[melodic, 2], [song, 1], [sing, 2]]) {
    const q = make(level, 3);
    const want = q.answer.map((m) => name(m, true)).join(', ');
    assert.ok(q.explain.includes(`Notes: ${want}.`), `${q.id}: ${q.explain}`);
  }
  const inv = inversions(2, 4);
  assert.match(inv.explain, /sounding [A-G][^,\d]*\d(, [A-G][^,\d]*\d)+\.$/, inv.explain);
});

test('rhythm explanations count beats, not ticks', () => {
  assert.equal(beatsText([0, 480, 1440, 1680]), '1, 2, 4, 4.5');
  for (const q of [rhythm(2, 1), songRhythm(1, 1)]) {
    assert.ok(!/tick/i.test(q.explain), q.explain);
    assert.ok(q.explain.includes(`beats: ${beatsText(q.answer)}`), q.explain);
  }
});
