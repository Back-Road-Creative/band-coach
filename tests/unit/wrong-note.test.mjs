import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrongNoteHint } from '../../src/core/wrong-note.js';

// gap = target - heard. Rows: [policy, fretted, heard, target, expected, why]. Every
// word is the one app.js already used for a wrong note before this module existed.
const TARGET = 60;
const row = (policy, fretted, gap, expected, why) => [policy, fretted, TARGET - gap, TARGET, expected, why];
const TABLE = [
  // rule 1: the octave sentence, any exact item, either direction
  row('exact', true, 12, 'Right note, wrong octave: go one octave up.', 'octave, heard one below (fretted)'),
  row('exact', true, -12, 'Right note, wrong octave: go one octave down.', 'octave, heard one above (fretted)'),
  row('exact', false, 12, 'Right note, wrong octave: go one octave up.', 'octave, heard one below (keys)'),
  row('exact', false, -12, 'Right note, wrong octave: go one octave down.', 'octave, heard one above (keys)'),
  // rule 2: a fretted instrument counts frets, the real semitone distance, direction by sign
  row('exact', true, 1, 'Go 1 fret higher.', 'singular fret, up'),
  row('exact', true, -1, 'Go 1 fret lower.', 'singular fret, down'),
  row('exact', true, 2, 'Go 2 frets higher.', 'two frets up'),
  row('exact', true, -2, 'Go 2 frets lower.', 'two frets down'),
  row('exact', true, 7, 'Go 7 frets higher.', 'seven up'),
  row('exact', true, -7, 'Go 7 frets lower.', 'seven down (a pitch-class fold would say 5 higher)'),
  row('exact', true, 11, 'Go 11 frets higher.', 'eleven up'),
  row('exact', true, -11, 'Go 11 frets lower.', 'eleven down'),
  // rule 3: no frets on keys or mallets, so keys, left or right
  row('exact', false, 1, 'Go 1 key to the right.', 'singular key, target above'),
  row('exact', false, -1, 'Go 1 key to the left.', 'singular key, target below'),
  row('exact', false, 2, 'Go 2 keys to the right.', 'keys, target above'),
  row('exact', false, -2, 'Go 2 keys to the left.', 'keys, target below'),
  row('exact', false, 13, 'Go 13 keys to the right.', 'keys, big gap'),
  row('exact', false, -24, 'Go 24 keys to the left.', 'keys, two octaves'),
  // rule 4: fretted and far: no fret count, direction by the sign of the gap
  row('exact', true, 13, 'Go higher.', 'far up'),
  row('exact', true, -13, 'Go lower.', 'far down'),
  row('exact', true, 24, 'Go higher.', 'two octaves up'),
  row('exact', true, -24, 'Go lower.', 'two octaves down'),
  // rule 5: pitch-class policies keep the old "Go <direction>." with the nearest same-name note
  row('fold', false, 1, 'Go higher.', 'fold, +1'),
  row('fold', true, -1, 'Go lower.', 'fold, -1'),
  row('fold', false, 6, 'Go higher.', 'fold, +6: dirWord keeps 6 as up'),
  row('fold', false, -6, 'Go higher.', 'fold, -6 is 6 mod 12, also up'),
  row('fold', false, 7, 'Go lower.', 'fold, +7 is 5 down the short way round'),
  row('fold', false, 11, 'Go lower.', 'fold, +11 is one down'),
  row('fold', false, -11, 'Go higher.', 'fold, -11 is one up'),
  row('fold', false, 13, 'Go higher.', 'fold, +13 is one up'),
  row('nearest-octave', false, 2, 'Go higher.', 'voice, +2'),
  row('nearest-octave', false, -2, 'Go lower.', 'voice, -2'),
  row('nearest-octave', false, 11, 'Go lower.', 'voice, +11'),
  row('nearest-octave', false, -11, 'Go higher.', 'voice, -11'),
];

for (const [policy, fretted, heardMidi, targetMidi, expected, why] of TABLE) {
  test(`${policy}${fretted ? ' fretted' : ''}: heard ${heardMidi}, target ${targetMidi} -> ${expected} (${why})`, () => {
    assert.equal(wrongNoteHint({ heardMidi, targetMidi, policy, fretted }), expected);
  });
}

test('an exact fretted hint says nothing about keys, left or right (a guitar has none)', () => {
  for (let gap = -30; gap <= 30; gap++) {
    if (gap === 0) continue;
    const text = wrongNoteHint({ heardMidi: 60 - gap, targetMidi: 60, policy: 'exact', fretted: true });
    assert.doesNotMatch(text, /key|left|right/, `gap ${gap}: ${text}`);
  }
});

test('an exact fretted hint always points the way the target is, by the sign of the gap', () => {
  for (let gap = -30; gap <= 30; gap++) {
    if (gap === 0 || Math.abs(gap) === 12) continue;
    const text = wrongNoteHint({ heardMidi: 60 - gap, targetMidi: 60, policy: 'exact', fretted: true });
    assert.match(text, gap > 0 ? /higher\.$/ : /lower\.$/, `gap ${gap}: ${text}`);
  }
});
