import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_KEYS, MAJOR_KEYS, MINOR_KEYS,
  findKey, signatureFor, keyFromSignature, relativeKey, parallelKey, neighbours,
} from '../../src/core/theory/keys.js';

test('there are exactly 15 major and 15 minor keys', () => {
  assert.equal(MAJOR_KEYS.length, 15);
  assert.equal(MINOR_KEYS.length, 15);
  assert.equal(ALL_KEYS.length, 30);
  assert.equal(new Set(MAJOR_KEYS.map(k => k.name)).size, 15);
  assert.equal(new Set(MINOR_KEYS.map(k => k.name)).size, 15);
});

test('major key names match the standard circle of fifths', () => {
  assert.deepEqual(MAJOR_KEYS.map(k => k.name), [
    'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#',
    'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb',
  ]);
});

test('minor key names match the standard circle of fifths', () => {
  assert.deepEqual(MINOR_KEYS.map(k => k.name), [
    'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m',
    'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm', 'Abm',
  ]);
});

test('signatureFor: hand-checked signature counts', () => {
  assert.deepEqual(signatureFor('C'), { count: 0, type: 'none' });
  assert.deepEqual(signatureFor('G'), { count: 1, type: 'sharp' });
  assert.deepEqual(signatureFor('F#'), { count: 6, type: 'sharp' });
  assert.deepEqual(signatureFor('C#'), { count: 7, type: 'sharp' });
  assert.deepEqual(signatureFor('F'), { count: 1, type: 'flat' });
  assert.deepEqual(signatureFor('Cb'), { count: 7, type: 'flat' });
  assert.deepEqual(signatureFor('Am'), { count: 0, type: 'none' });
  assert.deepEqual(signatureFor('G#m'), { count: 5, type: 'sharp' });
  assert.deepEqual(signatureFor('Abm'), { count: 7, type: 'flat' });
  // The shared Song-shape key form { tonic, mode } resolves the same way.
  assert.deepEqual(signatureFor({ tonic: 6, mode: 'major' }), { count: 6, type: 'sharp' });
});

test('keyFromSignature inverts signatureFor for every key', () => {
  for (const key of ALL_KEYS) {
    const sig = signatureFor(key);
    assert.equal(keyFromSignature(sig, key.mode).name, key.name);
  }
});

test('relativeKey swaps mode, keeps the signature', () => {
  assert.equal(relativeKey('C').name, 'Am');
  assert.equal(relativeKey('Am').name, 'C');
  assert.equal(relativeKey('F#').name, 'D#m');
  assert.equal(relativeKey('Cb').name, 'Abm');
});

test('parallelKey keeps the tonic, swaps mode', () => {
  assert.equal(parallelKey('C').name, 'Cm');
  // G# major would need 8 sharps -- outside the 15-key system, so the parallel
  // major of G# minor is its enharmonic equivalent, Ab (4 flats).
  assert.equal(parallelKey('G#m').name, 'Ab');
});

test('neighbours moves one step around the circle of fifths', () => {
  const n = neighbours('C');
  assert.equal(n.up.name, 'G');
  assert.equal(n.down.name, 'F');
  const atEdge = neighbours('C#');
  assert.equal(atEdge.up, null); // would need an 8th sharp
  assert.equal(atEdge.down.name, 'F#');
});

test('findKey rejects anything outside the 15+15', () => {
  assert.throws(() => findKey('H'));
  assert.throws(() => findKey('G##'));
});
