import test from 'node:test';
import assert from 'node:assert/strict';
import { readFingeringSetup, instrumentSetup } from '../../src/ui/fingerings/setup.js';
import gtr from '../../src/instruments/gtr.js';
import uke from '../../src/instruments/uke.js';
import { tuningFor, DROP_D } from '../../src/instruments/how/fretboard.js';

test('an empty store gives no capo, standard tuning', () => {
  const setup = readFingeringSetup({ byInstrument: {} }, gtr);
  assert.deepEqual(setup, { capo: 0, tuning: null, leftHanded: false });
});

test('a saved capo 2 and drop-D on guitar are read back', () => {
  const store = { byInstrument: { gtr: { capo: 2, tuning: 'drop-d', leftHanded: true } } };
  const setup = readFingeringSetup(store, gtr);
  assert.deepEqual(setup, { capo: 2, tuning: 'drop-d', leftHanded: true });
});

test('an out-of-range capo or an unknown tuning falls back', () => {
  const store = { byInstrument: { gtr: { capo: 12, tuning: 'banjo-g', leftHanded: false } } };
  const setup = readFingeringSetup(store, gtr);
  assert.equal(setup.capo, 0);
  assert.equal(setup.tuning, null);
});

test('a tuning saved for guitar is ignored for ukulele', () => {
  const store = { byInstrument: { uke: { capo: 0, tuning: 'drop-d', leftHanded: false } } };
  const setup = readFingeringSetup(store, uke);
  assert.equal(setup.tuning, null);
});

test('harmonica key and voice range come from prefs, validated', () => {
  const setup = instrumentSetup(gtr, { fingeringsStore: { get: () => null }, prefs: { harpKey: 5, voiceRange: { low: 48, high: 60 } } });
  assert.equal(setup.harpKey, 5);
  assert.deepEqual(setup.voiceRange, { low: 48, high: 60 });
  const bad = instrumentSetup(gtr, { fingeringsStore: { get: () => null }, prefs: { harpKey: 99, voiceRange: { low: 60, high: 48 } } });
  assert.equal(bad.harpKey, 0);
  assert.equal(bad.voiceRange, null);
  const missing = instrumentSetup(gtr, { fingeringsStore: { get: () => null } });
  assert.equal(missing.harpKey, 0);
  assert.equal(missing.voiceRange, null);
});

test('a corrupt store never throws', () => {
  assert.doesNotThrow(() => readFingeringSetup('not an object', gtr));
  assert.doesNotThrow(() => readFingeringSetup({ byInstrument: 'nope' }, gtr));
  assert.doesNotThrow(() => readFingeringSetup(null, gtr));
  assert.doesNotThrow(() => readFingeringSetup({ byInstrument: { gtr: 'nope' } }, gtr));
  assert.deepEqual(readFingeringSetup('not an object', gtr), { capo: 0, tuning: null, leftHanded: false });
  assert.doesNotThrow(() => instrumentSetup(gtr, { fingeringsStore: { get: () => { throw new Error('boom'); } } }));
});

test('instrumentSetup adds tuningMidi from an alternate tuning, or the instrument default', () => {
  const withAlt = instrumentSetup(gtr, { fingeringsStore: { get: () => ({ byInstrument: { gtr: { capo: 0, tuning: 'drop-d', leftHanded: false } } }) } });
  assert.deepEqual(withAlt.tuningMidi, tuningFor('drop-d'));
  assert.deepEqual(withAlt.tuningMidi, DROP_D);
  const withoutAlt = instrumentSetup(gtr, { fingeringsStore: { get: () => null } });
  assert.deepEqual(withoutAlt.tuningMidi, gtr.tuning);
});
