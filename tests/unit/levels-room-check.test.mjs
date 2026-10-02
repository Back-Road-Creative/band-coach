// classifyRoomCheck: decides whether one measurement window was the ROOM (store
// a floor) or somebody playing (abstain, keep the default gates). Each rule has
// a case on both sides of its threshold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRoomCheck, ROOM_CHECK_VERSION, noiseFloor } from '../../src/audio/levels.js';

const fr = (rms, pitched = false) => ({ rms, pitched });
const rep = (n, f) => Array.from({ length: n }, () => ({ ...f }));
// 20 frames at `rms`, `pitchedCount` of them pitched.
const mix = (rms, n, pitchedCount) => Array.from({ length: n }, (_, i) => fr(rms, i < pitchedCount));

test('the room-check version is 2 (floors stored before the check could abstain carry no marker)', () => {
  assert.equal(ROOM_CHECK_VERSION, 2);
});

test('no frames, or no usable frame, is unusable', () => {
  for (const bad of [[], undefined, null, 'x', [fr(NaN), fr(-1), fr(Infinity), null]]) {
    for (const manual of [false, true]) assert.deepEqual(classifyRoomCheck(bad, { manual }), { abstain: 'unusable' });
  }
});

test('steady unpitched noise is the room: the floor is stored on both checks', () => {
  const frames = rep(30, fr(0.004));
  for (const manual of [false, true]) {
    const v = classifyRoomCheck(frames, { manual });
    assert.ok(Math.abs(v.floor - noiseFloor(frames.map((f) => f.rms))) < 1e-12, JSON.stringify(v));
    assert.equal(v.abstain, undefined);
  }
});

test('frames below the minimum floor are quiet whatever their pitch', () => {
  const frames = rep(30, fr(0.001, true));
  for (const manual of [false, true]) assert.ok(Number.isFinite(classifyRoomCheck(frames, { manual }).floor));
});

test('digital silence (every frame exactly 0) is no reading: unusable, never a floor of 0', () => {
  for (const manual of [false, true]) assert.deepEqual(classifyRoomCheck(rep(30, fr(0)), { manual }), { abstain: 'unusable' });
  assert.deepEqual(classifyRoomCheck(rep(1, fr(0)), { manual: false }), { abstain: 'unusable' });
});

test('a window that is mostly digital silence (audio only just arrived) is unusable too: its floor would be 0', () => {
  // 20 of 30 frames exactly 0, the last 10 a faint steady hiss under the minimum floor: the trimmed median is 0.
  const frames = [...rep(20, fr(0)), ...rep(10, fr(0.0003))];
  for (const manual of [false, true]) assert.deepEqual(classifyRoomCheck(frames, { manual }), { abstain: 'unusable' });
});

test('the other side of the zero rule: a tiny but steady non-zero reading is a real quiet interface, so its floor is stored', () => {
  for (const manual of [false, true]) {
    const v = classifyRoomCheck(rep(30, fr(0.000001)), { manual });
    assert.ok(Math.abs(v.floor - 0.000001) < 1e-12, JSON.stringify(v));
  }
  // and a window that is only slightly more than half real hiss keeps the hiss's floor
  const v = classifyRoomCheck([...rep(10, fr(0)), ...rep(20, fr(0.0003))], { manual: true });
  assert.ok(Math.abs(v.floor - 0.0003) < 1e-12, JSON.stringify(v));
});

test('automatic: a quarter of the loud frames pitched abstains; just under a quarter stores', () => {
  assert.deepEqual(classifyRoomCheck(mix(0.004, 20, 5), { manual: false }), { abstain: 'sound' });
  assert.deepEqual(classifyRoomCheck(mix(0.004, 20, 20), { manual: false }), { abstain: 'sound' });
  assert.ok(Number.isFinite(classifyRoomCheck(mix(0.004, 20, 4), { manual: false }).floor));
  assert.ok(Number.isFinite(classifyRoomCheck(mix(0.004, 20, 0), { manual: false }).floor));
});

test('automatic: pitched frames under the minimum floor do not count toward the pitched share', () => {
  // 10 loud unpitched frames just over the minimum, 30 quiet pitched ones just under it.
  const frames = [...rep(10, fr(0.0016, false)), ...rep(30, fr(0.0012, true))];
  assert.ok(Number.isFinite(classifyRoomCheck(frames, { manual: false }).floor));
  // The same pitched frames, now just over the minimum, are playing.
  const loudPitched = [...rep(10, fr(0.0016, false)), ...rep(30, fr(0.0016, true))];
  assert.deepEqual(classifyRoomCheck(loudPitched, { manual: false }), { abstain: 'sound' });
});

test('burst rule: peak three times the median or less stores, clearly more abstains (both checks)', () => {
  const base = rep(29, fr(0.004));
  for (const manual of [false, true]) {
    assert.ok(Number.isFinite(classifyRoomCheck([...base, fr(0.010)], { manual }).floor), 'peak 2.5x median is still a steady room');
    assert.deepEqual(classifyRoomCheck([...base, fr(0.014)], { manual }), { abstain: 'sound' }, 'peak 3.5x median is a hit');
  }
});

test('burst rule: the reference is the floor the window would store, not the median (a quiet pluck train decays to a low floor)', () => {
  // 12 frames in the decay tails, 17 at mid level, one pluck: peak is 2.9x the median (so the median rule stores it) but 3.9x the floor
  // that would be stored (0.0012), so the gates built from it would sit under the pluck. That is playing, not the room.
  const decaying = (peak) => [...rep(12, fr(0.0008)), ...rep(17, fr(0.0016)), fr(peak)];
  for (const manual of [false, true]) {
    assert.deepEqual(classifyRoomCheck(decaying(0.0047), { manual }), { abstain: 'sound' }, 'peak 3.9x the would-be floor is playing');
    assert.ok(Math.abs(classifyRoomCheck(decaying(0.0034), { manual }).floor - 0.0012) < 1e-12, 'peak 2.8x the would-be floor is still a room');
  }
});

test('burst rule: a peak under the minimum floor is never a burst, one at or over it is', () => {
  const silent = rep(29, fr(0.0001));
  for (const manual of [false, true]) {
    assert.ok(Number.isFinite(classifyRoomCheck([...silent, fr(0.0014)], { manual }).floor), 'a faint blip in a silent room is still quiet');
    assert.deepEqual(classifyRoomCheck([...silent, fr(0.0016)], { manual }), { abstain: 'sound' }, 'one audible hit in silence is playing');
  }
});

test('drum-like unpitched bursts abstain on both checks', () => {
  const hits = Array.from({ length: 30 }, (_, i) => fr(i % 8 < 2 ? 0.01 : 0.0004));
  for (const manual of [false, true]) assert.deepEqual(classifyRoomCheck(hits, { manual }), { abstain: 'sound' });
});

test('manual: steady PITCHED sound (mains hum) is learned; the automatic check refuses the same window', () => {
  const hum = rep(60, fr(0.004, true));
  assert.ok(Math.abs(classifyRoomCheck(hum, { manual: true }).floor - 0.004) < 1e-12);
  assert.deepEqual(classifyRoomCheck(hum, { manual: false }), { abstain: 'sound' });
});

test('the stored floor is clamped to 0..1 and a cough in the window does not inflate it', () => {
  assert.equal(classifyRoomCheck(rep(30, fr(5)), { manual: true }).floor, 1);
  const v = classifyRoomCheck([...rep(29, fr(0.002)), fr(0.0055)], { manual: true });
  assert.ok(Math.abs(v.floor - 0.002) < 1e-12, JSON.stringify(v));
});
