// K1, the attended kit reading: what a real kit sends for one hit, and which fix that points to.
// Pure parts only. The listening itself needs Windows Chrome and a person at the kit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attended, registry, selectScenarios, WSL_CHILD_MS } from '../acceptance/win/run.mjs';
import { FLAM_MS, HIT_QUIET_MS, doneListening, k1Verdict, readKit } from '../acceptance/win/k1-kit-reading.win.mjs';

const on = (note, t, vel = 100, port = 'USB MIDI', ch = 9) => ({ port, t, data: [0x90 | ch, note, vel] });
const off = (note, t, port = 'USB MIDI', ch = 9) => ({ port, t, data: [0x80 | ch, note, 0] });
const obs = (log, over = {}) => ({ inputs: ['USB MIDI'], openErrors: [], log, ...over });

test('a hit is every note-on until a quiet gap, and one note per hit reads as one note', () => {
  const r = readKit([on(38, 0), off(38, 50), on(36, HIT_QUIET_MS + 10), off(36, HIT_QUIET_MS + 60)]);
  assert.equal(r.hits.length, 2);
  assert.deepEqual(r.counts, { one: 2, same: 0, different: 0 });
  assert.deepEqual(r.rows, ['one-note']);
});

test('the same note twice with a gap far below a flam reads as a short window', () => {
  const r = readKit([on(38, 0, 110), on(38, 8, 40), off(38, 60), on(38, 1000), off(38, 1050)]);
  assert.deepEqual(r.counts, { one: 1, same: 1, different: 0 });
  assert.deepEqual(r.repeatGaps, [8]);
  assert.deepEqual(r.hits[0].velocities, [110, 40]);
  assert.deepEqual(r.rows, ['short-window']);
});

test('the same note twice with a gap in flam range reads as a loudness rule', () => {
  const r = readKit([on(38, 0), on(38, FLAM_MS - 5, 60)]);
  assert.deepEqual(r.rows, ['loudness-rule']);
});

test('two different notes for one hit read as a piece owning several notes', () => {
  const r = readKit([on(38, 0), on(40, 5)]);
  assert.deepEqual(r.counts, { one: 0, same: 0, different: 1 });
  assert.deepEqual(r.rows, ['several-notes']);
});

test('the same note on two ports counts as different, because a guard keyed by port would not catch it', () => {
  const r = readKit([on(38, 0), on(38, 5, 100, 'Other port')]);
  assert.deepEqual(r.rows, ['several-notes']);
});

test('a kit that does both reports both', () => {
  const r = readKit([on(38, 0), on(38, 5), on(40, 1000), on(41, 1004)]);
  assert.deepEqual(r.rows.sort(), ['several-notes', 'short-window']);
});

test('note-offs, velocity 0 note-ons, pedal CC and clock are not hits', () => {
  const r = readKit([on(38, 0), { port: 'USB MIDI', t: 5, data: [0x99, 38, 0] }, off(38, 6), { port: 'USB MIDI', t: 7, data: [0xb9, 4, 90] }, { port: 'USB MIDI', t: 8, data: [0xf8] }]);
  assert.equal(r.hits.length, 1);
  assert.deepEqual(r.counts, { one: 1, same: 0, different: 0 });
  assert.equal(r.ccCount, 1);
});

test('messages are read in time order even when two ports log out of order', () => {
  const r = readKit([on(36, 1000), on(38, 0)]);
  assert.deepEqual(r.hits.map((h) => h.notes), [[38], [36]]);
});

test('verdict: a reading is OBSERVED, never PASS, and names the fix', () => {
  const v = k1Verdict(obs([on(38, 0), on(38, 8), on(38, 1000)]));
  assert.equal(v.status, 'OBSERVED');
  assert.match(v.text, /2 hit/);
  assert.match(v.text, /8 ms/);
  assert.match(v.text, /short fixed window/);
  assert.match(k1Verdict(obs([on(38, 0), on(36, 1000)])).text, /No guard/);
  assert.match(k1Verdict(obs([on(38, 0), on(40, 5)])).text, /several notes/);
});

test('verdict: no kit port, or a port that stayed silent, is BLOCKED and says what it listened to', () => {
  const none = k1Verdict(obs([], { inputs: [] }));
  assert.equal(none.status, 'BLOCKED');
  assert.match(none.text, /no MIDI input/);
  const silent = k1Verdict(obs([], { openErrors: ['USB MIDI: port busy'] }));
  assert.equal(silent.status, 'BLOCKED');
  assert.match(silent.text, /USB MIDI/);
  assert.match(silent.text, /port busy/);
  assert.equal(k1Verdict(obs([], { stuck: 'no midi' })).status, 'BLOCKED');
});

test('listening ends on enough hits then a short quiet, on a long quiet after a few hits, or at the limit', () => {
  const base = { hits: 0, sinceLastMs: 0, elapsedMs: 0 };
  assert.equal(doneListening(base), false);
  assert.equal(doneListening({ ...base, hits: 20, sinceLastMs: 100 }), false);
  assert.equal(doneListening({ ...base, hits: 20, sinceLastMs: 3000 }), true);
  assert.equal(doneListening({ ...base, hits: 2, sinceLastMs: 60000 }), false);
  assert.equal(doneListening({ ...base, hits: 6, sinceLastMs: 60000 }), true);
  assert.equal(doneListening({ ...base, hits: 0, sinceLastMs: 1e9, elapsedMs: 1e9 }), true);
});

test('a full lane run never waits on a person: K1 runs only when asked for by name', () => {
  assert.ok(attended.some((r) => r.id === 'K1'));
  assert.ok(!registry.some((r) => r.id === 'K1'));
  assert.deepEqual(selectScenarios(undefined), registry);
  assert.deepEqual(selectScenarios('K1').map((r) => r.id), ['K1']);
  assert.deepEqual(selectScenarios('W1').map((r) => r.id), ['W1']);
  assert.deepEqual(selectScenarios('nope'), []);
});

test('K1 gets its own time limit, and the WSL side outwaits it', () => {
  const k1 = attended.find((r) => r.id === 'K1');
  assert.ok(k1.maxMs > 120000);
  assert.ok(k1.maxMs + 60000 <= WSL_CHILD_MS);
});
