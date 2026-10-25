import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUMENTS } from '../../src/instruments/index.js';
import { tunerTunings } from '../../src/instruments/how-kind.js';

const T = tunerTunings(INSTRUMENTS);
const stringy = INSTRUMENTS.filter(r => Array.isArray(r.tuning) && r.tuning.length > 0);

test('every record with a tuning is in the tuner list with its own name and tuning', () => {
  assert.ok(stringy.length >= 12);
  for (const r of stringy) { assert.ok(T[r.id], r.id); assert.equal(T[r.id][0], r.name); assert.deepEqual(T[r.id][1], r.tuning); }
});
test('cello, banjo, mandolin, double bass and 5-string bass reach the tuner', () => {
  for (const id of ['cello', 'banjo-5-string', 'mandolin', 'double-bass', 'bass-5-string', 'violin', 'gtr', 'bass', 'uke']) assert.ok(T[id], id);
});
test('records without strings do not appear; chromatic is last', () => {
  for (const r of INSTRUMENTS) if (!stringy.includes(r)) assert.equal(T[r.id], undefined, r.id);
  const keys = Object.keys(T);
  assert.equal(keys[keys.length - 1], 'chrom');
  assert.equal(keys.length, stringy.length + 1);
});
test('the list copies the tuning, so editing it cannot change the record', () => {
  const t = tunerTunings(INSTRUMENTS); t.gtr[1].push(99);
  assert.notEqual(INSTRUMENTS.find(r => r.id === 'gtr').tuning.length, t.gtr[1].length);
});
