import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUMENTS, byId } from '../../src/instruments/index.js';
import { capabilityFor, capabilityChipKeys } from '../../src/instruments/capability.js';
import { en, es } from '../../src/core/i18n.js';

const keysFor = id => capabilityChipKeys(capabilityFor(byId[id]));

test('the picker chip says how an instrument is checked, and flags a missing or unchecked chart', () => {
  assert.deepEqual(keysFor('kbd'), ['picker.cap.exact']);
  assert.deepEqual(keysFor('gtr'), ['picker.cap.oneNote']);
  assert.deepEqual(keysFor('voice'), ['picker.cap.oneNote', 'picker.cap.noChart']);
  assert.deepEqual(keysFor('clarinet-bb'), ['picker.cap.oneNote', 'picker.cap.chartUnchecked']);
  assert.deepEqual(keysFor('drum-kit'), ['picker.cap.exact', 'picker.cap.chartUnchecked']);
});

test('rhythm-only and not-yet-checkable capabilities get their own chip', () => {
  assert.deepEqual(capabilityChipKeys({ assess: 'tap', chart: 'none' }), ['picker.cap.rhythm']);
  assert.deepEqual(capabilityChipKeys({ assess: 'none', chart: 'none' }), ['picker.cap.notChecked']);
  assert.deepEqual(capabilityChipKeys({ assess: 'mic-single-note', chart: 'typed-reviewed' }), ['picker.cap.oneNote']);
});

test('every chip key has English and Spanish text, and none names a tier', () => {
  const keys = new Set(INSTRUMENTS.flatMap(r => capabilityChipKeys(capabilityFor(r))).concat(['picker.cap.rhythm', 'picker.cap.notChecked']));
  for (const k of keys) {
    for (const [name, table] of [['en', en], ['es', es]]) {
      assert.equal(typeof table[k], 'string', name + ' has ' + k);
      assert.doesNotMatch(table[k], /candidate|unvalidated|untested|planned|tier/i, name + ' ' + k);
    }
  }
});
