// K1, the attended kit reading: what a real kit sends for one hit, and which fix that points to.
// Pure parts only. The listening itself needs Windows Chrome and a person at the kit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attended, parseArgs, registry, selectScenarios, stageFiles, WSL_CHILD_MS } from '../acceptance/win/run.mjs';
import { FLAM_MS, HIT_QUIET_MS, doneListening, k1Verdict, readKit, savedPadText } from '../acceptance/win/k1-kit-reading.win.mjs';

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

test('verdict: different notes point at a pad bleeding into another first, because the real kit did that', () => {
  const v = k1Verdict(obs([on(46, 0, 127), on(38, 4, 39)]));
  assert.match(v.text, /bleed/);
  assert.match(v.text, /hatBleedsOnSnare/);
  assert.doesNotMatch(v.text, /A guard does not help/);
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

test('verdict: a silent port says what state Chrome reported for it, so a port that never opened is not read as no hits', () => {
  const closed = k1Verdict(obs([], { ports: [{ name: 'USB MIDI', state: 'disconnected', connection: 'closed' }] }));
  assert.equal(closed.status, 'BLOCKED');
  assert.match(closed.text, /USB MIDI \(disconnected, closed\)/);
  const open = k1Verdict(obs([], { ports: [{ name: 'USB MIDI', state: 'connected', connection: 'open' }] }));
  assert.match(open.text, /USB MIDI \(connected, open\)/);
  assert.match(k1Verdict(obs([])).text, /USB MIDI/);
});

test('verdict: a reading also names the port state', () => {
  const v = k1Verdict(obs([on(38, 0), on(36, 1000)], { ports: [{ name: 'USB MIDI', state: 'connected', connection: 'open' }] }));
  assert.equal(v.status, 'OBSERVED');
  assert.match(v.text, /USB MIDI \(connected, open\)/);
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

// A kick played alone: hit i starts at i*1000 ms; extra notes follow 5 ms later.
const kick = (n, extra = {}) => Array.from({ length: n }, (_, i) => [on(36, i * 1000, 100), ...(extra[i] || []).map(([note, vel]) => on(note, i * 1000 + 5, vel))]).flat();

test('--pad and --hits are read, --hits must be a whole number, and the staged files carry the piece table', () => {
  const a = parseArgs(['--win-root', '/x', '--only', 'K1', '--pad', 'kick', '--hits', '20']);
  assert.equal(a.pad, 'kick');
  assert.equal(a.hits, 20);
  assert.equal(parseArgs(['--win-root', '/x']).pad, undefined);
  assert.throws(() => parseArgs(['--hits', 'many']), /--hits/);
  assert.throws(() => parseArgs(['--hits', '0']), /--hits/);
  assert.throws(() => parseArgs(['--pad']), /--pad/);
  assert.ok(stageFiles([]).includes('src/instruments/drum-kit.js'));
});

test('pad reading: a hit with only the pad\'s own notes is own, any other note is crosstalk with its velocity', () => {
  const r = readKit(kick(3, { 1: [[38, 20]], 2: [[38, 31], [48, 18]] }), 'kick');
  assert.deepEqual(r.hits.map((h) => h.padClass), ['own', 'crosstalk', 'crosstalk']);
  assert.equal(r.pad.total, 3);
  assert.equal(r.pad.own, 1);
  assert.equal(r.pad.crosstalk, 2);
  assert.deepEqual(r.pad.strays, [
    { note: 38, piece: 'snare', hits: 2, velMin: 20, velMax: 31 },
    { note: 48, piece: 'tom-high', hits: 1, velMin: 18, velMax: 18 },
  ]);
  assert.equal(readKit(kick(2)).pad, undefined);
});

test('pad reading: the pad\'s alternate note (35 for kick) is still own', () => {
  assert.equal(readKit([on(35, 0), on(36, 1000)], 'kick').pad.crosstalk, 0);
});

test('pad verdict: a clean pad says the cause is elsewhere and stays OBSERVED', () => {
  const v = k1Verdict(obs(kick(4), { pad: 'kick', target: 4 }));
  assert.equal(v.status, 'OBSERVED');
  assert.match(v.text, /kick: 4 hits, 4 clean\./);
  assert.match(v.text, /No crosstalk from this pad: the cause is elsewhere/);
  assert.doesNotMatch(v.text, /also sent/);
});

test('pad verdict: crosstalk lists each other note with its piece and velocity range, and asks for a rule', () => {
  const v = k1Verdict(obs(kick(20, { 3: [[38, 20]], 7: [[38, 31]], 9: [[38, 25]], 11: [[48, 18]] }), { pad: 'kick' }));
  assert.equal(v.status, 'OBSERVED');
  assert.match(v.text, /kick: 20 hits, 16 clean, 3 also sent 38 \(snare, vel 20-31\), 1 also sent 48 \(tom-high, vel 18\)/);
  assert.match(v.text, /Crosstalk: a rule for this pad, written from these velocities/);
});

test('pad verdict: a note no piece owns is reported as not a kit note', () => {
  const v = k1Verdict(obs(kick(2, { 0: [[99, 7]] }), { pad: 'kick' }));
  assert.match(v.text, /1 also sent 99 \(not a kit note, vel 7\)/);
});

test('pad verdict: an unknown piece id is BLOCKED and lists the ids', () => {
  const v = k1Verdict(obs(kick(2), { pad: 'bongo' }));
  assert.equal(v.status, 'BLOCKED');
  assert.match(v.text, /bongo/);
  assert.match(v.text, /kick/);
});

test('saved pad list: none when absent or empty, per device with note->piece when present', () => {
  assert.equal(savedPadText(null), 'Saved pad list: none');
  assert.equal(savedPadText({}), 'Saved pad list: none');
  assert.equal(savedPadText({ 'USB MIDI': {} }), 'Saved pad list: none');
  assert.equal(savedPadText({ 'USB MIDI': { 48: 'ride', 38: 'tom-high' } }), 'Saved pad list for USB MIDI: 38->tom-high, 48->ride');
});

test('verdict: the saved pad list ends the text and is kept in the reading for the report', () => {
  const maps = { 'USB MIDI': { 38: 'tom-high', 48: 'ride' } };
  const v = k1Verdict(obs(kick(2), { pad: 'kick', savedPadList: maps }));
  assert.ok(v.text.endsWith('Saved pad list for USB MIDI: 38->tom-high, 48->ride'));
  assert.deepEqual(v.savedPadList, maps);
  assert.ok(k1Verdict(obs([on(38, 0)])).text.endsWith('Saved pad list: none'));
  assert.ok(k1Verdict(obs(kick(2), { pad: 'kick', savedPadList: null })).text.endsWith('Saved pad list: none'));
});

test('a smaller --hits target ends listening sooner', () => {
  const base = { hits: 5, sinceLastMs: 3000, elapsedMs: 0 };
  assert.equal(doneListening(base), false);
  assert.equal(doneListening({ ...base, target: 5 }), true);
  assert.equal(doneListening({ hits: 3, sinceLastMs: 60000, elapsedMs: 0, target: 3 }), true);
});
