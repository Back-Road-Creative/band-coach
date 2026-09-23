import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitHarmonicaKey, bestHarmonicaKey, arrangeHarmonica } from '../../src/song/arrange/harmonica.js';
import { layoutFor } from '../../src/instruments/how/harmonica.js';
import { starterSongs } from '../../src/song/starter/index.js';

function melodyNotesOf(song) {
  const part = song.parts.find(p => p.id === 'melody') || song.parts[0];
  return part.notes;
}

test('every starter song gets a harmonica key with zero unplayable notes', () => {
  const winners = [];
  for (const song of starterSongs) {
    const notes = melodyNotesOf(song);
    const best = bestHarmonicaKey(notes);
    assert.equal(best.unplayable.length, 0, `${song.id}: expected a fitting key, got unplayable ${JSON.stringify(best.unplayable)}`);
    assert.equal(best.playable, true);
    winners.push(`${song.id} -> key ${best.key} (shift ${best.shift})`);
  }
  // Report which keys won, for a human reading the test output.
  console.log('Harmonica key winners:\n' + winners.join('\n'));
});

test('a G-major scale melody picks the G harp with no bends', () => {
  // G major scale, one octave, in the middle of a harp's range.
  const scaleMidis = [67, 69, 71, 72, 74, 76, 78, 79]; // G4 A4 B4 C5 D5 E5 F#5 G5
  const notes = scaleMidis.map((midi, i) => ({ start: i, dur: 1, midi }));
  const best = bestHarmonicaKey(notes);
  assert.equal(best.key, 7, 'expected key 7 (G)');
  assert.equal(best.playable, true);
  assert.equal(best.bendsNeeded, 0);
});

test('a note reachable only by the 3-draw bend is unplayable without allowBends, playable with it', () => {
  // A4 = 69 on a C harp (key 0): not an open blow/draw note anywhere, but
  // reachable by bending the hole-3 draw note down two semitones.
  const notes = [{ start: 0, dur: 1, midi: 69 }];

  const withoutBends = fitHarmonicaKey(notes, { keys: [0], shifts: [0], allowBends: false });
  assert.equal(withoutBends.length, 1);
  assert.equal(withoutBends[0].playable, false);
  assert.deepEqual(withoutBends[0].unplayable, [69]);

  const withBends = fitHarmonicaKey(notes, { keys: [0], shifts: [0], allowBends: true });
  assert.equal(withBends.length, 1);
  assert.equal(withBends[0].playable, true);
  assert.equal(withBends[0].unplayable.length, 0);
  assert.equal(withBends[0].bendsNeeded, 1);
});

test('arrangeHarmonica maps every note back to its midi via layoutFor', () => {
  for (const song of starterSongs) {
    const notes = melodyNotesOf(song);
    const best = bestHarmonicaKey(notes);
    assert.equal(best.playable, true);
    const shifted = notes.map(n => ({ ...n, midi: n.midi + best.shift }));
    const arranged = arrangeHarmonica(shifted, best.key);
    assert.equal(arranged.length, shifted.length, 'no note may be dropped');
    const layout = layoutFor(best.key);
    for (let i = 0; i < arranged.length; i++) {
      const note = arranged[i];
      const hole = layout.find(h => h.hole === note.hole);
      assert.ok(hole, `${song.id}: hole ${note.hole} not found in layout`);
      if (note.action === 'blow' && note.bendSteps === 0) {
        assert.equal(hole.blow, note.midi);
      } else if (note.action === 'draw' && note.bendSteps === 0) {
        assert.equal(hole.draw, note.midi);
      } else if (note.action === 'bend') {
        const bend = hole.bends.find(b => b.pitch === note.midi && b.semitonesBent === note.bendSteps);
        assert.ok(bend, `${song.id}: no bend matches midi ${note.midi} with ${note.bendSteps} semitones on hole ${note.hole}`);
      } else {
        assert.fail(`unexpected action/bendSteps combo: ${note.action}/${note.bendSteps}`);
      }
    }
  }
});

test('fitHarmonicaKey ranks all requested keys, one entry each', () => {
  const notes = [{ start: 0, dur: 1, midi: 60 }];
  const ranked = fitHarmonicaKey(notes, { keys: [0, 7] });
  assert.equal(ranked.length, 2);
  assert.deepEqual(ranked.map(r => r.key).sort(), [0, 7]);
});
