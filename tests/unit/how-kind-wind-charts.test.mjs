// windChartIdsFor: which instrument records a Wind and brass transposition
// group (the "My instrument" choice) can show a How-to-play chart for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windChartIdsFor, howKindFor } from '../../src/instruments/how-kind.js';
import { byId } from '../../src/instruments/index.js';

test('each transposition group lists its chart records, in order', () => {
  assert.deepEqual(windChartIdsFor('c'), ['flute', 'oboe']);
  assert.deepEqual(windChartIdsFor('bb'), ['trumpet-bb', 'clarinet-bb']);
  assert.deepEqual(windChartIdsFor('bbt'), ['sax-tenor-bb']);
  assert.deepEqual(windChartIdsFor('eb'), ['sax-alto-eb']);
  assert.deepEqual(windChartIdsFor('f'), ['horn-f']);
  assert.deepEqual(windChartIdsFor('bc'), ['trombone']);
});

test('baritone sax has no record, so its group is empty', () => {
  assert.deepEqual(windChartIdsFor('ebb'), []);
});

test('an unknown or missing group behaves like bb, as app.js does', () => {
  assert.deepEqual(windChartIdsFor('nope'), windChartIdsFor('bb'));
  assert.deepEqual(windChartIdsFor(undefined), windChartIdsFor('bb'));
  assert.deepEqual(windChartIdsFor('toString'), windChartIdsFor('bb'));
});

test('every listed id is a real record with a chart, and a fresh array each call', () => {
  ['c', 'bb', 'bbt', 'eb', 'ebb', 'f', 'bc'].forEach(g => windChartIdsFor(g).forEach(id => assert.ok(byId[id] && howKindFor(byId[id]), id)));
  assert.notEqual(windChartIdsFor('c'), windChartIdsFor('c'));
});
