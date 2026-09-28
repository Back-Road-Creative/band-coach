import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_KEYS, MAJOR_KEYS, MINOR_KEYS,
  findKey, signatureFor, keyFromSignature,
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

test('findKey rejects anything outside the 15+15', () => {
  assert.throws(() => findKey('H'));
  assert.throws(() => findKey('G##'));
});
