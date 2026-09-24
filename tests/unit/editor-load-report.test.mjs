// loadReport (src/ui/editor.js): the pure decision behind loadSong() --
// when "Fix it up" (src/ui/learn.js) hands over a song that still has
// unresolved check items, the editor must show that SAME check list rather
// than silently clearing it (loadSong() used to always reset
// needsCheck: [] and acknowledged: true, hiding the list the learner was
// just shown). No warnings handed over keeps today's behaviour: nothing to
// check, editing unlocks immediately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadReport } from '../../src/ui/editor.js';

function songWithNotes(n) {
  return { parts: [{ id: 'p1', notes: new Array(n).fill({ start: 0, dur: 480, midi: 60 }) }] };
}

test('loadReport: no needsCheck handed over keeps today\'s behaviour (acknowledged, empty list)', () => {
  assert.deepEqual(loadReport(songWithNotes(3), undefined), { notesCaptured: 3, needsCheck: [], acknowledged: true });
  assert.deepEqual(loadReport(songWithNotes(3), []), { notesCaptured: 3, needsCheck: [], acknowledged: true });
});

test('loadReport: a handed-over needsCheck list is kept, unacknowledged', () => {
  const result = loadReport(songWithNotes(3), ['Bar 2 beat 3 note unclear']);
  assert.deepEqual(result, { notesCaptured: 3, needsCheck: ['Bar 2 beat 3 note unclear'], acknowledged: false });
});

test('loadReport: a song with no parts counts zero notes captured', () => {
  assert.deepEqual(loadReport({ parts: [] }, undefined), { notesCaptured: 0, needsCheck: [], acknowledged: true });
});
