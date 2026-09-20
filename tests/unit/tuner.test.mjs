import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smoothMidi, selectTarget, stepTuner } from '../../src/core/tuner.js';

// Ukulele open strings (see TUNINGS.uke in src/app.js): G4 C4 E4 A4 as midi.
const UKE = [67, 60, 64, 69];

// ---------- smoothMidi ----------

test('smoothMidi: median of the last n readings ignores a single octave outlier', () => {
  const history = [40, 40, 40, 40, 52]; // one bad reading, an octave (12 semitones) high
  assert.equal(smoothMidi(history, 5), 40);
});

test('smoothMidi: empty history returns null, never NaN', () => {
  assert.equal(smoothMidi([], 5), null);
  assert.equal(smoothMidi(undefined, 5), null);
});

test('smoothMidi: only looks at the last n entries', () => {
  const history = [100, 100, 100, 40, 40, 40, 40, 40];
  assert.equal(smoothMidi(history, 5), 40);
});

// ---------- selectTarget ----------

test('selectTarget: first confident reading with no prior selection picks nearest', () => {
  const r = selectTarget({}, 69.02, UKE, {});
  assert.equal(r.selIdx, 3); // A4 string
});

test('selectTarget: a challenger must be nearer by the margin AND persist to take over', () => {
  let state = { selIdx: 1 }; // C4 (60)
  // A reading right at the midpoint between C4(60) and E4(64): 62. Nearer to
  // neither by the 20-cent margin in absolute midi terms once margin applied.
  // Use a reading clearly nearer to E4 but only for two ticks (< default 3).
  const midi = 63.9; // close to E4 (64), far from C4 (60)
  let r = selectTarget(state, midi, UKE, {});
  assert.equal(r.selIdx, 1, 'still on the old string after tick 1');
  state = { ...state, candidateIdx: r.candidateIdx, candidateN: r.candidateN };
  r = selectTarget(state, midi, UKE, {});
  assert.equal(r.selIdx, 1, 'still on the old string after tick 2 (needs 3)');
  state = { ...state, candidateIdx: r.candidateIdx, candidateN: r.candidateN };
  r = selectTarget(state, midi, UKE, {});
  assert.equal(r.selIdx, 2, 'switches on the 3rd consecutive confirming tick');
});

test('selectTarget: thrash between two adjacent strings never flips selection without persistence', () => {
  let state = { selIdx: 1 }; // C4
  const wobble = [63.9, 60.1, 63.9, 60.1, 63.9]; // alternates every tick, never 3 in a row
  wobble.forEach((midi) => {
    const r = selectTarget(state, midi, UKE, {});
    state = { selIdx: r.selIdx, candidateIdx: r.candidateIdx, candidateN: r.candidateN };
  });
  assert.equal(state.selIdx, 1, 'selection never thrashed off the original string');
});

test('selectTarget: lockedIdx bypasses selection entirely, even far from that string', () => {
  const r = selectTarget({ selIdx: 1 }, 67.0, UKE, { lockedIdx: 3 });
  assert.equal(r.selIdx, 3);
});

test('selectTarget: empty targets (chromatic) returns null selection', () => {
  const r = selectTarget({}, 60, [], {});
  assert.equal(r.selIdx, null);
});

// ---------- stepTuner ----------

function frame(midi) { return { freq: 440, midi }; }

test('stepTuner: a dropout sequence (confident, null, null, confident) keeps the reading and only decays the hold', () => {
  let s = stepTuner(undefined, frame(69.0), 50, { targets: UKE, confirmMs: 600 });
  assert.equal(Math.round(s.midi), 69);
  // Drive the hold up close to confirm without crossing it.
  for (let i = 0; i < 10; i++) s = stepTuner(s, frame(69.0), 50, { targets: UKE, confirmMs: 600 });
  assert.ok(s.holdMs > 0, 'in-tune hold accumulated');
  const holdBeforeDrop = s.holdMs;
  const midiBeforeDrop = s.midi;
  s = stepTuner(s, null, 50, { targets: UKE, confirmMs: 600, holdWindowMs: 1500 });
  assert.equal(s.midi, midiBeforeDrop, 'the last reading stays visible through a dropped frame');
  assert.ok(s.holdMs < holdBeforeDrop && s.holdMs > 0, 'hold decays, is not zeroed, by one dropped frame');
  s = stepTuner(s, null, 50, { targets: UKE, confirmMs: 600, holdWindowMs: 1500 });
  assert.equal(s.midi, midiBeforeDrop, 'still visible after a second dropped frame');
  assert.ok(s.ageMs > 0, 'ageMs grows while silent');
  s = stepTuner(s, frame(69.0), 50, { targets: UKE, confirmMs: 600 });
  assert.equal(s.ageMs, 0, 'ageMs resets once a reading returns');
});

test('stepTuner: idle after a full holdWindowMs of continuous silence', () => {
  let s = stepTuner(undefined, frame(69.0), 50, { targets: UKE });
  assert.notEqual(s.phase, 'idle');
  for (let t = 0; t < 2000; t += 50) s = stepTuner(s, null, 50, { targets: UKE, holdWindowMs: 1500 });
  assert.equal(s.phase, 'idle');
  assert.equal(s.midi, null);
});

test('stepTuner: reaches "holding" once a steady in-tune tone persists past confirmMs', () => {
  let s;
  for (let t = 0; t < 800; t += 50) s = stepTuner(s, frame(69.0), 50, { targets: UKE, confirmMs: 600, toleranceCents: 5 });
  assert.equal(s.phase, 'holding');
});

test('stepTuner: elapsed time drives confirm, not tick count -- a bigger dt reaches confirm in fewer ticks', () => {
  let s;
  s = stepTuner(s, frame(69.0), 700, { targets: UKE, confirmMs: 600, toleranceCents: 5 });
  assert.equal(s.phase, 'holding', 'one big enough tick alone can cross confirmMs');
});

test('stepTuner: with a row locked, a pitch nearer another string does not change the selection', () => {
  let s = stepTuner(undefined, frame(60.0), 50, { targets: UKE, lockedIdx: 3 });
  assert.equal(s.selIdx, 3);
  s = stepTuner(s, frame(60.0), 50, { targets: UKE, lockedIdx: 3 });
  assert.equal(s.selIdx, 3, 'stays locked to string 3 even though 60 is nearest to string 1');
});

test('stepTuner: chromatic mode (empty targets) confirms against the nearest semitone', () => {
  let s;
  for (let t = 0; t < 800; t += 50) s = stepTuner(s, frame(61.02), 50, { targets: [], confirmMs: 600, toleranceCents: 5 });
  assert.equal(s.targetMidi, 61);
  assert.equal(s.phase, 'holding');
});
