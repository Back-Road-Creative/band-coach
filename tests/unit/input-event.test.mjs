import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provableDims } from '../../src/core/input-event.js';

test('provableDims: none proves nothing, tap proves rhythm only', () => {
  assert.deepEqual(provableDims('none'), []);
  assert.deepEqual(provableDims('tap'), ['onset']);
});

test('provableDims: mic-single-note cannot prove chord or drum', () => {
  const d = provableDims('mic-single-note');
  assert.deepEqual(d, ['pitch', 'onset', 'hold', 'tune']);
});

test('provableDims: midi proves pitch, chord, onset, hold and drum, never tune', () => {
  assert.deepEqual(provableDims('midi'), ['pitch', 'chord', 'onset', 'hold', 'drum']);
});

test('provableDims: an unrecognized capability proves nothing, and the result is a copy', () => {
  assert.deepEqual(provableDims('bogus'), []);
  provableDims('midi').push('x');
  assert.equal(provableDims('midi').length, 5);
});
