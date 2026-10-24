// The seeds and clock schedule the release retention test hands the app. Each is
// pinned against the app's own pure logic, so a seed that stopped meaning what
// the release test says it means fails here in milliseconds, not there in a minute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { HOUR, SEED_T0, seedEvent, seedS1, seedS2, seedS3, seedS4, profileOf, profileScheduleInit } from '../helpers/profile-seed.mjs';
import { validateEvent, isIndependentOk, summarizeEvents } from '../../src/core/learning-events.js';
import { pathwayState } from '../../src/core/pathway.js';

// Row ids come from a counter, so two builds of one seed differ only there.
const noIds = (profile) => ({ ...profile, events: profile.events.map(({ id, ...row }) => row) });
const at = (h) => SEED_T0 + h * HOUR;
const step = (events, h, midiProof = false) => pathwayState({ events, sessions: [], midiProof, level: 3, now: at(h) });

test('every seed row is a valid event at a real epoch time', () => {
  for (const seed of [seedS1(), seedS2(), seedS3(), seedS4()]) {
    for (const row of seed) { assert.equal(validateEvent(row).ok, true); assert.ok(row.at >= 1e12); }
  }
});

test('S1 to S3 rows are independent-ok; S4 is the row with no input field', () => {
  for (const row of [...seedS3()]) assert.equal(isIndependentOk(row), true);
  assert.equal('input' in seedS4()[0], false);
  assert.equal(isIndependentOk(seedS4()[0]), true);
});

test('the pathway reads each seed at its visit as the release test expects', () => {
  assert.deepEqual([step(seedS1(), 19).step, step(seedS1(), 19).action.kind], ['return', 'wait']);
  assert.deepEqual([step(seedS1(), 21).step, step(seedS1(), 21).action.kind], ['return', 'wait']);
  assert.deepEqual([step(seedS1(), 25).step, step(seedS1(), 25).action.kind], ['return', 'recheck']);
  assert.deepEqual([step(seedS2(), 25).step, step(seedS2(), 25).action.kind], ['return', 'transfer']);
  assert.equal(step(seedS3(), 25).step, 'complete');
  assert.deepEqual([step(seedS4(), 25).step, step(seedS4(), 25).action.kind], ['setup', 'connect-midi']);
});

test('S1 holds no retained skill yet: the progress summary says 0', () => {
  assert.equal(summarizeEvents(seedS1(), { instrument: 'kbd' }).retained, 0);
});

test('a row below 1e12 or an invalid row throws', () => {
  assert.throws(() => seedEvent({ deltaMs: -SEED_T0, skill: 'whole:null' }), /1e12/);
  assert.throws(() => seedEvent({ deltaMs: 0, skill: '' }), /not a valid event/);
});

// Runs the init script as a page would see it: a global with window, location, a Storage whose methods live on the
// prototype (as in Chrome, where the init script patches them), localStorage behind a getter that counts how often it is
// reached, and its own Date. `reads` is what the page's first storage read would see; `touches` counts reaches into
// window.localStorage, which the script must not make while the document is still being created.
function runInit(src, { protocol = 'file:', top = true, name = '' } = {}) {
  const writes = {};
  let touches = 0;
  function Storage() {}
  Storage.prototype.setItem = function (k, v) { writes[k] = v; };
  Storage.prototype.getItem = function (k) { return k in writes ? writes[k] : null; };
  const ls = new Storage();
  const sandbox = { location: { protocol }, Storage, name };
  Object.defineProperty(sandbox, 'localStorage', { get() { touches++; return ls; } });
  sandbox.window = sandbox;
  sandbox.top = top ? sandbox : {};
  const ctx = vm.createContext(sandbox);
  const realNow = vm.runInContext('Date.now', ctx);
  vm.runInContext(src, ctx);
  const atCreation = { writes: { ...writes }, touches };
  return { ctx, writes, atCreation, read: (k) => ls.getItem(k), patched: vm.runInContext('Date.now', ctx) !== realNow, now: () => vm.runInContext('Date.now()', ctx), name: () => sandbox.name };
}

test('the init script does nothing outside a top-level file page', () => {
  const src = profileScheduleInit([{ offsetMs: 19 * HOUR, events: seedS1() }]);
  for (const where of [{ protocol: 'http:' }, { protocol: 'https:' }, { top: false }]) {
    const r = runInit(src, where);
    assert.deepEqual(r.writes, {}, `no write for ${JSON.stringify(where)}`);
    assert.equal(r.patched, false, `Date.now untouched for ${JSON.stringify(where)}`);
    assert.equal(r.name(), '', `window.name untouched for ${JSON.stringify(where)}`);
  }
});

test('visit n reads its own offset, writes its own seed and bumps the visit counter', () => {
  const visits = [{ offsetMs: 19 * HOUR, events: seedS1() }, { offsetMs: 25 * HOUR }, { offsetMs: 21 * HOUR, events: seedS2() }];
  const src = profileScheduleInit(visits);
  const first = runInit(src);
  assert.equal(first.name(), 'q4b2.visit=1');
  assert.ok(first.patched);
  assert.ok(Math.abs(first.now() - (SEED_T0 + 19 * HOUR)) < 5000, 'visit 1 reads SEED_T0 + 19 h');
  first.read('bandcoach.v1');
  assert.deepEqual(noIds(JSON.parse(first.writes['bandcoach.v1'])), noIds(profileOf(seedS1())));
  const second = runInit(src, { name: 'q4b2.visit=1' });
  assert.equal(second.name(), 'q4b2.visit=2');
  assert.ok(Math.abs(second.now() - (SEED_T0 + 25 * HOUR)) < 5000, 'visit 2 reads SEED_T0 + 25 h');
  second.read('bandcoach.v1');
  assert.deepEqual(second.writes, {}, 'a visit with no events leaves the app\'s own saved profile alone');
  const third = runInit(src, { name: 'q4b2.visit=2' });
  assert.ok(Math.abs(third.now() - (SEED_T0 + 21 * HOUR)) < 5000);
  third.read('bandcoach.v1');
  assert.deepEqual(noIds(JSON.parse(third.writes['bandcoach.v1'])), noIds(profileOf(seedS2())));
  const past = runInit(src, { name: 'q4b2.visit=9' });
  assert.ok(Math.abs(past.now() - (SEED_T0 + 21 * HOUR)) < 5000, 'a visit past the schedule repeats the last one');
  assert.equal(past.name(), 'q4b2.visit=10');
});

// Why the seed waits for the page: under load, Chrome loses the saved profile of the PREVIOUS document when a script reads
// or writes localStorage while the next document is still being created. The reload that follows the first write then
// hands the app an older profile or an empty one (A08's "Remembered on a later try: 0"). 40 reloads on a box with 16 busy
// processes lost 18 to 25 of them with a document-start read or write and none when the page's own first access did it.
test('the seed is written at the page\'s first storage access, never while the document is being created', () => {
  const src = profileScheduleInit([{ offsetMs: 19 * HOUR, events: seedS1() }]);
  const r = runInit(src);
  assert.equal(r.atCreation.touches, 0, 'window.localStorage is not reached while the document is created');
  assert.deepEqual(r.atCreation.writes, {}, 'nothing is written while the document is created');
  const seen = r.read('bandcoach.v1');
  assert.deepEqual(noIds(JSON.parse(seen)), noIds(profileOf(seedS1())), 'the first read already sees the seeded profile');
  const w = runInit(src);
  w.ctx.Storage.prototype.setItem.call(w.ctx.localStorage, 'other', '1');
  assert.deepEqual(noIds(JSON.parse(w.writes['bandcoach.v1'])), noIds(profileOf(seedS1())), 'a first write seeds the profile too');
  assert.equal(w.writes.other, '1');
});
