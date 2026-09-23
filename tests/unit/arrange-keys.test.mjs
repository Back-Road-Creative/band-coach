// Unit D2 (band-coach plan §11.7 Wave D): split a keyboard melody between
// the two hands and pick fingers 1-5. See src/song/arrange/keys.js for the
// algorithm; this file is the proof that it fits every starter song on the
// keyboard without ever dropping a note, and that the hand split and
// fingering match beginner-method convention on hand-checked material.
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitHands, fingerHand, arrangeKeys } from '../../src/song/arrange/keys.js';
import { INSTRUMENTS } from '../../src/instruments/index.js';
import { fitToInstrument } from '../../src/song/lesson.js';
import { starterSongs } from '../../src/song/starter/index.js';
import { HANDS_TOGETHER_EXERCISES } from '../../src/core/hands-together.js';

const kbd = INSTRUMENTS.find(r => r.id === 'kbd');

test('splitHands: a note at or above middle C goes to the right hand, below goes to the left', () => {
  const notes = [
    { start: 0, dur: 480, midi: 60 },
    { start: 480, dur: 480, midi: 59 },
    { start: 960, dur: 480, midi: 67 },
    { start: 1440, dur: 480, midi: 48 },
  ];
  const { rh, lh } = splitHands(notes, { hysteresis: 0 });
  assert.deepEqual(rh.map(n => n.midi), [60, 67]);
  assert.deepEqual(lh.map(n => n.midi), [59, 48]);
});

test('splitHands: hysteresis stops a line hovering around middle C from ping-ponging', () => {
  // Alternates 59/60/59/60 around the split point -- without hysteresis a
  // plain >= threshold rule would ping-pong every note between hands.
  const notes = [
    { start: 0, dur: 240, midi: 60 },
    { start: 240, dur: 240, midi: 59 },
    { start: 480, dur: 240, midi: 60 },
    { start: 720, dur: 240, midi: 59 },
    { start: 960, dur: 240, midi: 60 },
  ];
  const { rh, lh } = splitHands(notes, { splitMidi: 60, hysteresis: 3 });
  // once a hand is chosen, small wobbles around the split stay on that
  // hand instead of jumping back and forth note to note
  assert.equal(rh.length + lh.length, notes.length, 'no note dropped');
  assert.ok(rh.length >= 4, 'the hovering line mostly stays on one hand');
});

test('splitHands: a chord is split by pitch, not kept together on one hand', () => {
  const notes = [
    { start: 0, dur: 480, midi: 48 }, // low note of the chord
    { start: 0, dur: 480, midi: 67 }, // high note of the chord
  ];
  const { rh, lh } = splitHands(notes);
  assert.deepEqual(lh.map(n => n.midi), [48]);
  assert.deepEqual(rh.map(n => n.midi), [67]);
});

test("splitHands: HANDS_TOGETHER_EXERCISES' merged RH+LH notes split back exactly", () => {
  const notes = [];
  HANDS_TOGETHER_EXERCISES.forEach((ex, i) => {
    notes.push({ start: i * 480, dur: 480, midi: ex.rh.midi });
    notes.push({ start: i * 480, dur: 480, midi: ex.lh.midi });
  });
  const { rh, lh } = splitHands(notes);
  assert.deepEqual(rh.map(n => n.midi), HANDS_TOGETHER_EXERCISES.map(e => e.rh.midi));
  assert.deepEqual(lh.map(n => n.midi), HANDS_TOGETHER_EXERCISES.map(e => e.lh.midi));
});

test('fingerHand: a C-major five-finger melody gets fingers 1-2-3-4-5', () => {
  const notes = [
    { start: 0, dur: 480, midi: 60 }, // C
    { start: 480, dur: 480, midi: 62 }, // D
    { start: 960, dur: 480, midi: 64 }, // E
    { start: 1440, dur: 480, midi: 65 }, // F
    { start: 1920, dur: 480, midi: 67 }, // G
  ];
  const fingered = fingerHand(notes, 'rh');
  assert.equal(fingered.length, notes.length, 'no note dropped');
  assert.deepEqual(fingered.map(n => n.finger), [1, 2, 3, 4, 5]);
});

test('fingerHand: an ascending C-major octave scale uses one thumb-under', () => {
  const notes = [60, 62, 64, 65, 67, 69, 71, 72].map((midi, i) => ({ start: i * 480, dur: 480, midi }));
  const fingered = fingerHand(notes, 'rh');
  assert.equal(fingered.length, notes.length, 'no note dropped');
  const fingers = fingered.map(n => n.finger);
  assert.ok(fingers.every(f => f >= 1 && f <= 5), 'every finger is 1-5');
  // a thumb-under: the thumb (finger 1) takes over after a higher finger,
  // while the pitch keeps climbing -- exactly one such crossing in a
  // one-octave ascending scale
  let crossings = 0;
  for (let i = 1; i < fingers.length; i++) {
    if (fingers[i] === 1 && fingers[i - 1] > 1 && notes[i].midi > notes[i - 1].midi) crossings++;
  }
  assert.equal(crossings, 1, `expected exactly one thumb-under, fingering was ${fingers.join('-')}`);
});

test('arrangeKeys: a note out of the keyboard range is reported unplayable, never dropped', () => {
  const notes = [
    { start: 0, dur: 480, midi: 60 },
    { start: 480, dur: 480, midi: 20 }, // far below kbd.range.low (48)
  ];
  const result = arrangeKeys(notes, kbd);
  assert.equal(result.rh.length + result.lh.length + result.unplayable.length, notes.length);
  assert.equal(result.unplayable.length, 1);
  assert.equal(result.unplayable[0].midi, 20);
  assert.equal(result.unplayable[0].reason, 'out-of-range');
});

test('family proof: every starter song arranges on the keyboard with no dropped note and every placed note in range', () => {
  assert.equal(kbd.family, 'keys');
  for (const song of starterSongs) {
    const fit = fitToInstrument(song, 'melody', kbd);
    const notes = fit.notes;
    if (notes.length === 0) continue;
    const result = arrangeKeys(notes, kbd);

    assert.equal(
      result.rh.length + result.lh.length + result.unplayable.length,
      notes.length,
      `${song.id}: every note must be placed (in one hand) or explained`
    );

    for (const n of [...result.rh, ...result.lh]) {
      assert.ok(n.midi >= kbd.range.low && n.midi <= kbd.range.high, `${song.id}: midi ${n.midi} out of kbd range`);
      assert.ok(n.finger >= 1 && n.finger <= 5, `${song.id}: finger ${n.finger} out of 1-5`);
    }
  }
});

test('fingerHand: the left hand mirrors the right -- C3 up to G3 is 5-4-3-2-1', () => {
  const notes = [48, 50, 52, 53, 55].map((midi, i) => ({ start: i * 480, dur: 480, midi }));
  assert.deepEqual(fingerHand(notes, 'lh').map(n => n.finger), [5, 4, 3, 2, 1]);
});
