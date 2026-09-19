import test from 'node:test';
import assert from 'node:assert/strict';
import { positionsFor, STANDARD_GUITAR, DROP_D, DADGAD, OPEN_G, OPEN_D, HALF_STEP_DOWN, tuningFor } from '../../src/instruments/how/fretboard.js';

test('standard guitar: open low E string is fret 0 on string 0', () => {
  const positions = positionsFor(40, STANDARD_GUITAR);
  assert.ok(positions.some(p => p.stringIndex === 0 && p.fret === 0));
});

test('standard guitar: A4 (69) is fret 5 on the high E string, ranked lowest-fret first', () => {
  const positions = positionsFor(69, STANDARD_GUITAR);
  assert.equal(positions[0].fret, 5);
  assert.equal(positions[0].stringIndex, 5);
});

test('capo 2: open low string now sounds a whole tone up, fret counted from the capo', () => {
  const positions = positionsFor(42, STANDARD_GUITAR, { capo: 2 });
  assert.ok(positions.some(p => p.stringIndex === 0 && p.fret === 0));
});

test('capo makes the note behind it unreachable (fret would be negative)', () => {
  const positions = positionsFor(40, STANDARD_GUITAR, { capo: 2 });
  assert.equal(positions.some(p => p.stringIndex === 0), false);
});

test('left-handed flag mirrors displayIndex but keeps the same pitch and fret', () => {
  const normal = positionsFor(40, STANDARD_GUITAR)[0];
  const mirrored = positionsFor(40, STANDARD_GUITAR, { leftHanded: true })[0];
  assert.equal(normal.stringIndex, mirrored.stringIndex);
  assert.equal(normal.fret, mirrored.fret);
  assert.equal(mirrored.displayIndex, STANDARD_GUITAR.length - 1 - normal.stringIndex);
});

test('drop D: only the lowest string changes, down a whole tone', () => {
  assert.equal(DROP_D[0], 38);
  assert.deepEqual(DROP_D.slice(1), STANDARD_GUITAR.slice(1));
});

test('DADGAD: strings 3, 4, 5 (D G A, 0-indexed 2,3,4) match standard', () => {
  assert.equal(DADGAD[2], STANDARD_GUITAR[2]);
  assert.equal(DADGAD[3], STANDARD_GUITAR[3]);
  assert.equal(DADGAD[4], 57); // B3 (59) dropped a whole tone to A3
});

test('open G: middle three strings (D G B) are unchanged from standard', () => {
  assert.equal(OPEN_G[2], STANDARD_GUITAR[2]);
  assert.equal(OPEN_G[3], STANDARD_GUITAR[3]);
  assert.equal(OPEN_G[4], STANDARD_GUITAR[4]);
});

test('open D is the named D A D F# A D tuning', () => {
  assert.deepEqual(OPEN_D, [38, 45, 50, 54, 57, 62]);
});

test('half-step down drops every string exactly one semitone', () => {
  HALF_STEP_DOWN.forEach((p, i) => assert.equal(p, STANDARD_GUITAR[i] - 1));
});

test('tuningFor resolves a named tuning and rejects an unknown one', () => {
  assert.deepEqual(tuningFor('drop-d'), DROP_D);
  assert.throws(() => tuningFor('nonsense'));
});

test('5-string bass and low-G ukulele tunings find fret 0 on their own open strings', () => {
  const bass = positionsFor(23, tuningFor('bass-5-string'));
  assert.ok(bass.some(p => p.fret === 0));
  const uke = positionsFor(55, tuningFor('ukulele-low-g'));
  assert.ok(uke.some(p => p.fret === 0));
});
