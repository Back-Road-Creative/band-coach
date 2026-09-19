// tests/unit/computed-instruments-tin-whistle.test.mjs
// The new tin-whistle instrument record (src/instruments/tin-whistle.js):
// proves it resolves to the existing whistle fingering table
// (src/instruments/how/recorder-whistle.js), passes schema.js validation,
// and that its range is DERIVED from that table, not typed by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import tinWhistle from '../../src/instruments/tin-whistle.js';
import { validateInstrument } from '../../src/instruments/schema.js';
import { WHISTLE_NOTES, fingeringFor } from '../../src/instruments/how/recorder-whistle.js';
import { INSTRUMENTS, byId } from '../../src/instruments/index.js';

test('tin whistle record passes validateInstrument', () => {
  const { ok, errors } = validateInstrument(tinWhistle);
  assert.equal(ok, true, errors.join('; '));
});

test('tin whistle is registered in the instrument index', () => {
  assert.equal(byId['tin-whistle'], tinWhistle);
  assert.ok(INSTRUMENTS.includes(tinWhistle));
});

test('tin whistle range matches the computed whistle table bounds exactly', () => {
  assert.equal(tinWhistle.range.low, WHISTLE_NOTES[0].midi);
  assert.equal(tinWhistle.range.high, WHISTLE_NOTES[WHISTLE_NOTES.length - 1].midi);
});

test('the low note is D5 (74) and its own fingering table resolves it', () => {
  assert.equal(tinWhistle.range.low, 74);
  const entry = fingeringFor(tinWhistle.range.low, 'whistle');
  assert.equal(entry.name, 'D5');
});

test('D6 (86) is vented: top hole open, the rest covered', () => {
  const entry = fingeringFor(86, 'whistle');
  assert.equal(entry.name, 'D6');
  assert.equal(entry.holes, 'oxxxxx');
});

test('every note in the whistle table falls within the record range', () => {
  WHISTLE_NOTES.forEach(n => {
    assert.ok(n.midi >= tinWhistle.range.low && n.midi <= tinWhistle.range.high, n.name);
  });
});
