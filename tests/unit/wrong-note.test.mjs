import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrongNoteHint } from '../../src/core/wrong-note.js';
import { pcKeyFor, PCKEYS } from '../../src/core/pckeys.js';
import { setLocale, en, es } from '../../src/core/i18n.js';

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
  // rule 3: no frets on keys or mallets; count WHITE keys on the drawn piano, never semitones.
  // Target 60 (C4) is white throughout this table.
  row('exact', false, 1, 'Go one white key to the right.', 'heard B, next white key up'),
  row('exact', false, -1, 'Go one white key to the left.', 'heard C#(black), C is the next white key down'),
  row('exact', false, 2, 'Go two white keys to the right.', 'heard A#(black): B then C'),
  row('exact', false, -2, 'Go one white key to the left.', 'heard D, C is ONE white key away (not 2 keys)'),
  row('exact', false, 13, 'Go eight white keys to the right.', 'eight white keys'),
  row('exact', false, -24, 'Go 14 white keys to the left.', 'two octaves, digits past ten'),
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

const ENG = { heardMidi: 62, targetMidi: 60, policy: 'exact', fretted: false };

test('a keys hint counts white keys: target 60 heard 62 is one white key to the left', () => {
  assert.match(wrongNoteHint(ENG), /one white key to the left/);
});

test('a white-to-white gap of two white keys says "two white keys"', () => {
  assert.match(wrongNoteHint({ ...ENG, heardMidi: 64 }), /two white keys to the left/);
});

test('a black target is named plainly as a black key, with its note name', () => {
  assert.equal(wrongNoteHint({ ...ENG, heardMidi: 62, targetMidi: 61 }), 'Go to the black key C♯, to the left.');
  assert.equal(wrongNoteHint({ ...ENG, heardMidi: 62, targetMidi: 61, name: () => 'D♭' }), 'Go to the black key D♭, to the left.');
});

test('a hint never counts semitones as keys', () => {
  for (let gap = -30; gap <= 30; gap++) {
    if (gap === 0) continue;
    for (const input of [undefined, 'computer-key', 'midi']) {
      const text = wrongNoteHint({ heardMidi: 60 - gap, targetMidi: 60, policy: 'exact', fretted: false, input });
      assert.doesNotMatch(text, /\d+ keys?/, `gap ${gap}: ${text}`);
    }
  }
});

test('computer-keyboard input names the key to press, looked up from the map', () => {
  assert.equal(pcKeyFor(60), 'a');
  const text = wrongNoteHint({ ...ENG, input: 'computer-key' });
  assert.match(text, new RegExp('Press ' + pcKeyFor(60).toUpperCase() + '\\.'));
  assert.match(text, /one white key to the left/);
  assert.doesNotMatch(wrongNoteHint({ ...ENG, input: 'midi' }), /Press/);
});

test('pcKeyFor is the reverse of PCKEYS and undefined off the map', () => {
  for (const k of Object.keys(PCKEYS)) assert.equal(PCKEYS[pcKeyFor(PCKEYS[k])], PCKEYS[k]);
  assert.equal(pcKeyFor(30), undefined);
  // a target with no computer key gets no "Press"
  assert.doesNotMatch(wrongNoteHint({ heardMidi: 82, targetMidi: 80, policy: 'exact', fretted: false, input: 'computer-key' }), /Press/);
});

test('es locale returns Spanish for the new hints', () => {
  setLocale('es');
  try {
    assert.match(wrongNoteHint(ENG), /una tecla blanca a la izquierda/);
    assert.match(wrongNoteHint({ ...ENG, heardMidi: 64 }), /dos teclas blancas/);
    assert.match(wrongNoteHint({ ...ENG, input: 'computer-key' }), /Pulsa A\./);
    assert.doesNotMatch(wrongNoteHint(ENG), /white|left/);
  } finally { setLocale('en'); }
});

test('every wrongNote string exists in en and es', () => {
  const ids = Object.keys(en).filter(k => k.startsWith('wrongNote.'));
  assert.ok(ids.length >= 14);
  for (const id of ids) assert.equal(typeof es[id], 'string', id);
});
