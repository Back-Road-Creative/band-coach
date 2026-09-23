import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangeBowed, semitoneOffset } from '../../src/song/arrange/bowed.js';
import violin from '../../src/instruments/violin.js';
import { INSTRUMENTS } from '../../src/instruments/index.js';
import { fitToInstrument } from '../../src/song/lesson.js';
import { starterSongs } from '../../src/song/starter/index.js';

function note(midi, start = 0, dur = 480) {
  return { start, dur, midi };
}

// --- hand-checked: one-octave D major scale on violin, first position ---
// D string open (62), A string open (69); the standard beginner fingering
// pattern is finger 0(open),1,2,3 on the D string then 0,1,2,3 on the A
// string (Suzuki-style first-position D major scale).
test('D major scale on violin: hand-checked string/finger in first position', () => {
  const scaleMidis = [62, 64, 66, 67, 69, 71, 73, 74]; // D E F# G A B C# D
  const notes = scaleMidis.map((m, i) => note(m, i * 480));
  const { placed, unplayable } = arrangeBowed(notes, violin, { maxPosition: 3 });
  assert.equal(unplayable.length, 0);
  assert.equal(placed.length, 8);
  const expected = [
    { string: 1, finger: 0 }, // D open
    { string: 1, finger: 1 }, // E
    { string: 1, finger: 2 }, // F#
    { string: 1, finger: 3 }, // G
    { string: 2, finger: 0 }, // A open
    { string: 2, finger: 1 }, // B
    { string: 2, finger: 2 }, // C#
    { string: 2, finger: 3 }, // D
  ];
  placed.forEach((p, i) => {
    assert.equal(p.string, expected[i].string, `note ${i} string`);
    assert.equal(p.finger, expected[i].finger, `note ${i} finger`);
    assert.equal(p.position, 1, `note ${i} stays in first position`);
  });
});

// --- shift case: staying in position beats an extra string crossing ---
test('prefers a position shift on the same string over an avoidable string crossing', () => {
  // G string open (55). Two notes a major 6th (9 semitones) apart on the G
  // string: reachable only by shifting to position 2 (base 2, finger4 high
  // variant = 2+8=10 -- too far) -- pick a note that IS reachable via a
  // position shift and confirm the arranger stays on the string rather than
  // crossing to the D string's low first-position finger.
  const notes = [note(55, 0), note(64, 480)]; // G open, then +9 semitones
  const { placed, unplayable } = arrangeBowed(notes, violin, { maxPosition: 3 });
  assert.equal(unplayable.length, 0);
  assert.equal(placed[0].string, 0);
  assert.equal(placed[1].string, 0, 'stays on the G string via a position shift');
  assert.ok(placed[1].position > 1, 'second note requires a position shift');
});

test('semitoneOffset: open string is position 1 finger 0', () => {
  assert.equal(semitoneOffset(1, 0), 0);
});

test('semitoneOffset: rejects finger 0 outside first position', () => {
  assert.throws(() => semitoneOffset(2, 0));
});

// --- unplaceable notes are reported, never dropped ---
test('a note outside the instrument range is reported unplayable, not dropped', () => {
  const notes = [note(200, 0)];
  const { placed, unplayable } = arrangeBowed(notes, violin);
  assert.equal(placed.length, 0);
  assert.equal(unplayable.length, 1);
  assert.equal(unplayable[0].reason, 'out-of-range');
  assert.equal(unplayable[0].midi, 200);
});

// --- family proof: every starter song, every ready bowed instrument ---
const bowedInstruments = INSTRUMENTS.filter(i => i.family === 'bowed' && i.status === 'ready');

test('bowed family covers all four ready instruments', () => {
  assert.deepEqual(bowedInstruments.map(i => i.id).sort(), ['cello', 'double-bass', 'viola', 'violin']);
});

bowedInstruments.forEach(instrument => {
  starterSongs.forEach(song => {
    test(`arrangeBowed places every note of "${song.title}" on ${instrument.name} (or reports why not)`, () => {
      const part = song.parts[0];
      const fit = fitToInstrument(song, part.id, instrument);
      const { placed, unplayable } = arrangeBowed(fit.notes, instrument);
      assert.equal(
        placed.length + unplayable.length,
        fit.notes.length,
        'every fitted note is either placed or reported unplayable -- none dropped'
      );
      placed.forEach(p => {
        const openMidi = instrument.tuning[p.string];
        const offset = semitoneOffset(p.position, p.finger);
        assert.equal(openMidi + offset, p.midi, `placed note ${p.midi} must equal open string + offset`);
      });
    });
  });
});
