import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_VERSION, RETAIN_GAP_MS, makeEvent, validateEvent, summarizeEvents } from '../../src/core/learning-events.js';

// ---------- makeEvent ----------

test('makeEvent: fills v/id/at, keeps caller fields', () => {
  const ev = makeEvent({ instrument: 'kbd', skill: 'n4' }, { now: 1000, id: 'x1' });
  assert.equal(ev.v, EVENT_VERSION);
  assert.equal(ev.id, 'x1');
  assert.equal(ev.at, 1000);
  assert.equal(ev.instrument, 'kbd');
  assert.equal(ev.skill, 'n4');
});

test('makeEvent: without an id, falls back to at + a per-call counter, never colliding', () => {
  const a = makeEvent({}, { now: 5 });
  const b = makeEvent({}, { now: 5 });
  assert.notEqual(a.id, b.id);
  assert.ok(a.id.startsWith('5:'));
});

test('makeEvent: without now, uses the current wall clock', () => {
  const before = Date.now();
  const ev = makeEvent({});
  assert.ok(ev.at >= before);
});

// ---------- validateEvent ----------

function validDrillEvent(overrides) {
  return Object.assign({
    v: EVENT_VERSION, id: 'a', at: 1, instrument: 'kbd', skill: 'n4', source: 'drill',
    assistance: 'none', dims: { pitch: 'ok' }, unassessed: [], activeMs: 400,
  }, overrides);
}

test('validateEvent: a well-formed drill event is ok', () => {
  const r = validateEvent(validDrillEvent());
  assert.deepEqual(r, { ok: true, errors: [] });
});

test('validateEvent: rejects a bad source', () => {
  const r = validateEvent(validDrillEvent({ source: 'bogus' }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('source')));
});

test('validateEvent: rejects a bad assistance value', () => {
  const r = validateEvent(validDrillEvent({ assistance: 'sort-of' }));
  assert.equal(r.ok, false);
});

test('validateEvent: rejects a dims value outside ok/miss/unassessed', () => {
  const r = validateEvent(validDrillEvent({ dims: { pitch: 'sorta' } }));
  assert.equal(r.ok, false);
});

test('validateEvent: rejects a negative activeMs', () => {
  const r = validateEvent(validDrillEvent({ activeMs: -1 }));
  assert.equal(r.ok, false);
});

test('validateEvent: never throws on a malformed row, returns ok:false', () => {
  assert.doesNotThrow(() => validateEvent(null));
  assert.equal(validateEvent(null).ok, false);
  assert.equal(validateEvent(undefined).ok, false);
  assert.equal(validateEvent('nope').ok, false);
});

test('validateEvent: optional song fields accepted when strings, rejected when not', () => {
  assert.equal(validateEvent(validDrillEvent({ source: 'song', songId: 'sg1', partId: 'melody' })).ok, true);
  assert.equal(validateEvent(validDrillEvent({ songId: 5 })).ok, false);
});

test('validateEvent: bpmTarget/bpmActual accept number or null', () => {
  assert.equal(validateEvent(validDrillEvent({ bpmTarget: 90, bpmActual: null })).ok, true);
  assert.equal(validateEvent(validDrillEvent({ bpmTarget: 'fast' })).ok, false);
});

// ---------- summarizeEvents ----------

test('summarizeEvents: assistance !== none counts as withHelp', () => {
  const s = summarizeEvents([validDrillEvent({ assistance: 'shown' })]);
  assert.deepEqual(s, { introduced: 0, withHelp: 1, independent: 0, retained: 0, applied: 0 });
});

test('summarizeEvents: no assistance, every assessed dim ok, counts as independent', () => {
  const s = summarizeEvents([validDrillEvent({ dims: { pitch: 'ok', onset: 'unassessed' } })]);
  assert.deepEqual(s, { introduced: 0, withHelp: 0, independent: 1, retained: 0, applied: 0 });
});

test('summarizeEvents: no assistance, a missed dim counts as introduced', () => {
  const s = summarizeEvents([validDrillEvent({ dims: { pitch: 'miss' } })]);
  assert.deepEqual(s, { introduced: 1, withHelp: 0, independent: 0, retained: 0, applied: 0 });
});

test('summarizeEvents: filters by instrument and skill', () => {
  const events = [
    validDrillEvent({ instrument: 'kbd', skill: 'n4' }),
    validDrillEvent({ instrument: 'guitar', skill: 'n4', dims: { pitch: 'miss' } }),
  ];
  assert.deepEqual(summarizeEvents(events, { instrument: 'kbd' }), { introduced: 0, withHelp: 0, independent: 1, retained: 0, applied: 0 });
  assert.deepEqual(summarizeEvents(events, { skill: 'n4', instrument: 'guitar' }), { introduced: 1, withHelp: 0, independent: 0, retained: 0, applied: 0 });
});

// ---------- summarizeEvents: retained / applied ----------

test('summarizeEvents: two independent-ok events on the same skill 24h apart count as retained', () => {
  const events = [
    validDrillEvent({ id: 'a', at: 0, instrument: 'kbd', skill: 'n60' }),
    validDrillEvent({ id: 'b', at: 24 * 3600 * 1000, instrument: 'kbd', skill: 'n60' }),
  ];
  const s = summarizeEvents(events);
  assert.equal(s.independent, 2);
  assert.equal(s.retained, 1);
});

test('summarizeEvents: the same two events 2h apart are below the default gap, but clear a smaller override', () => {
  const events = [
    validDrillEvent({ id: 'a', at: 0, instrument: 'kbd', skill: 'n60' }),
    validDrillEvent({ id: 'b', at: 2 * 3600 * 1000, instrument: 'kbd', skill: 'n60' }),
  ];
  assert.equal(summarizeEvents(events).retained, 0);
  assert.equal(summarizeEvents(events, { retainGapMs: 3600 * 1000 }).retained, 1);
  assert.equal(RETAIN_GAP_MS, 20 * 3600 * 1000);
});

test('summarizeEvents: an ok non-song attempt followed by an ok song attempt on the same skill counts as applied', () => {
  const events = [
    validDrillEvent({ id: 'a', at: 0, instrument: 'kbd', skill: 'n60', source: 'drill' }),
    validDrillEvent({ id: 'b', at: 1000, instrument: 'kbd', skill: 'n60', source: 'song', songId: 'sg1' }),
  ];
  assert.equal(summarizeEvents(events).applied, 1);
});

test('summarizeEvents: a song attempt with no earlier non-song ok attempt is not applied', () => {
  const events = [validDrillEvent({ id: 'a', at: 0, instrument: 'kbd', skill: 'n60', source: 'song', songId: 'sg1' })];
  assert.equal(summarizeEvents(events).applied, 0);
});

test('summarizeEvents: events out of `at` order produce the same counts, and the input array is not reordered', () => {
  const events = [
    validDrillEvent({ id: 'b', at: 24 * 3600 * 1000, instrument: 'kbd', skill: 'n60', source: 'song', songId: 'sg1' }),
    validDrillEvent({ id: 'a', at: 0, instrument: 'kbd', skill: 'n60', source: 'drill' }),
  ];
  const before = events.map((ev) => ev.id);
  const s = summarizeEvents(events);
  assert.equal(s.independent, 2);
  assert.equal(s.retained, 1);
  assert.equal(s.applied, 1);
  assert.deepEqual(events.map((ev) => ev.id), before);
});

test('summarizeEvents: a withHelp or missed attempt never counts as retained or applied, even when the gap/source conditions hold', () => {
  const events = [
    validDrillEvent({ id: 'a', at: 0, instrument: 'kbd', skill: 'n60', source: 'drill' }),
    validDrillEvent({ id: 'b', at: 24 * 3600 * 1000, instrument: 'kbd', skill: 'n60', source: 'song', songId: 'sg1', assistance: 'shown' }),
    validDrillEvent({ id: 'c', at: 48 * 3600 * 1000, instrument: 'kbd', skill: 'n60', source: 'song', songId: 'sg1', dims: { pitch: 'miss' } }),
  ];
  const s = summarizeEvents(events);
  assert.equal(s.retained, 0);
  assert.equal(s.applied, 0);
});

test('summarizeEvents: filtering by instrument and skill still applies to retained and applied counts', () => {
  const events = [
    validDrillEvent({ id: 'a', at: 0, instrument: 'kbd', skill: 'n60', source: 'drill' }),
    validDrillEvent({ id: 'b', at: 24 * 3600 * 1000, instrument: 'kbd', skill: 'n60', source: 'song', songId: 'sg1' }),
    validDrillEvent({ id: 'c', at: 0, instrument: 'guitar', skill: 'n60', source: 'drill' }),
    validDrillEvent({ id: 'd', at: 24 * 3600 * 1000, instrument: 'guitar', skill: 'n60', source: 'song', songId: 'sg1' }),
  ];
  const s = summarizeEvents(events, { instrument: 'kbd' });
  assert.equal(s.independent, 2);
  assert.equal(s.retained, 1);
  assert.equal(s.applied, 1);
});
