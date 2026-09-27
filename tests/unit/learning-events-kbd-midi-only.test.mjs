// C11c: a learning-event row with instrument === 'kbd' whose `input` is
// present and is not 'midi' (a computer-key or mixed-source attempt) is
// never independent-ok, so it never counts in independent/retained/applied
// and is never kept as a boundEvents anchor. Rows with no `input` field
// keep today's meaning (legacy rows, drill rows before input-tagging, and
// screen-click song steps, whose onNote call has no source -- see bc-route
// src/app.js and src/ui/songs.js). Non-kbd instruments are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeEvents, isIndependentOk, boundEvents } from '../../src/core/learning-events.js';

function baseEvent(overrides) {
  return Object.assign({
    v: 1, id: 'a', at: 0, instrument: 'kbd', skill: 'n60', source: 'song', songId: 'sg1',
    assistance: 'none', dims: { pitch: 'ok' }, unassessed: [], activeMs: 400,
  }, overrides);
}

// ---------- isIndependentOk ----------

test('isIndependentOk: a kbd row tagged computer-key is not independent-ok', () => {
  assert.equal(isIndependentOk(baseEvent({ input: 'computer-key' })), false);
});

test('isIndependentOk: a kbd row tagged mixed is not independent-ok', () => {
  assert.equal(isIndependentOk(baseEvent({ input: 'mixed' })), false);
});

test('isIndependentOk: a kbd row tagged midi is still independent-ok', () => {
  assert.equal(isIndependentOk(baseEvent({ input: 'midi' })), true);
});

test('isIndependentOk: a kbd row with no input field keeps today\'s meaning', () => {
  assert.equal(isIndependentOk(baseEvent({})), true);
});

test('isIndependentOk: a non-kbd instrument tagged mic is unaffected (negative control)', () => {
  assert.equal(isIndependentOk(baseEvent({ instrument: 'gtr', input: 'mic' })), true);
});

// ---------- summarizeEvents ----------

test('summarizeEvents: kbd rows tagged computer-key do not count as independent', () => {
  const events = [
    baseEvent({ id: 'a', at: 0, input: 'computer-key' }),
    baseEvent({ id: 'b', at: 1000, input: 'midi' }),
    baseEvent({ id: 'c', at: 2000 }),
  ];
  const s = summarizeEvents(events);
  assert.deepEqual(s, { introduced: 1, withHelp: 0, independent: 2, retained: 0, applied: 0 });
});

// ---------- boundEvents anchors ----------

test('boundEvents: an untagged kbd song-ok row still anchors past the window', () => {
  const oldest = baseEvent({ id: 'anchor', at: 0, skill: 'n60' });
  const rest = [];
  for (let i = 0; i < 600; i++) rest.push(baseEvent({ id: 'r' + i, at: 1000 + i, skill: 'n62', dims: { pitch: 'miss' } }));
  const events = [oldest].concat(rest);
  const result = boundEvents(events);
  assert.ok(result.some((ev) => ev.id === 'anchor'));
});

test('boundEvents: a kbd song-ok row tagged computer-key is not kept as an anchor', () => {
  const oldest = baseEvent({ id: 'anchor', at: 0, skill: 'n60', input: 'computer-key' });
  const rest = [];
  for (let i = 0; i < 600; i++) rest.push(baseEvent({ id: 'r' + i, at: 1000 + i, skill: 'n62', dims: { pitch: 'miss' } }));
  const events = [oldest].concat(rest);
  const result = boundEvents(events);
  assert.equal(result.length, 500);
  assert.ok(!result.some((ev) => ev.id === 'anchor'));
});

// ---------- applied ----------

test('summarizeEvents: a kbd song-ok row tagged computer-key does not count as applied', () => {
  const drillOk = baseEvent({ id: 'drill', at: 0, source: 'drill', songId: undefined });
  const songComputerKey = baseEvent({ id: 'song', at: 1000, input: 'computer-key' });
  const s = summarizeEvents([drillOk, songComputerKey]);
  assert.equal(s.applied, 0);
});

test('summarizeEvents: the same song row tagged midi counts as applied', () => {
  const drillOk = baseEvent({ id: 'drill', at: 0, source: 'drill', songId: undefined });
  const songMidi = baseEvent({ id: 'song', at: 1000, input: 'midi' });
  const s = summarizeEvents([drillOk, songMidi]);
  assert.equal(s.applied, 1);
});
