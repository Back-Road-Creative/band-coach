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

// ---------- holding survives a wobble, but not a wrong note ----------
//
// A player holding a note is not a signal generator. Before this group
// existed, `holdMs` was zeroed by the FIRST reading outside tolerance, so
// confirmMs had to be cleared with no excursion whatsoever and a real player
// never saw "tuned". Measured against the old code with a deterministic
// wobble over 120 ticks: +/-8 cents held on 38 ticks, +/-12 cents on 5,
// +/-20 cents on none. The same measurement after the fix: 102, 96 and 46,
// with a +/-35 cent wobble still never holding -- somebody that far off is
// not in tune and must not be told they are.

// A deterministic wobble, so a failure here is reproducible rather than a
// coin flip. Returns midi values centred on `centre`, within +/-cents.
function wobbler(centre, cents, seed = 1) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return centre + ((x / 2147483648 - 0.5) * 2 * cents) / 100;
  };
}

test('stepTuner: a player wobbling inside a few cents reads as tuned, not just once', () => {
  // "Did it EVER reach holding" is far too weak an assertion: the old
  // zero-on-excursion code still stumbled into 12 consecutive in-tune ticks
  // now and then, so a bare `everHeld` check passed against the very bug this
  // pins. What a player actually experiences is the PROPORTION of the time
  // the readout says tuned. Old code at this wobble: 5 ticks in 120. New: 96.
  const next = wobbler(69, 12);
  let s;
  let held = 0;
  const TICKS = 120;
  for (let i = 0; i < TICKS; i++) {
    s = stepTuner(s, frame(next()), 50, { targets: UKE, confirmMs: 600, toleranceCents: 5 });
    if (s.phase === 'holding') held++;
  }
  assert.ok(
    held / TICKS > 0.6,
    `a +/-12 cent wobble centred on the target read as tuned on only ${held}/${TICKS} ticks; ` +
      'a player holding a note this well should see "tuned" most of the time',
  );
});

test('stepTuner: a mild excursion decays the hold instead of wiping it', () => {
  const OPTS = { targets: UKE, confirmMs: 600, toleranceCents: 5 };
  let s;
  for (let i = 0; i < 8; i++) s = stepTuner(s, frame(69.0), 50, OPTS);
  assert.ok(s.holdMs > 0, 'hold accumulated while in tune');

  // A SINGLE bad reading is not an excursion at all: the median of five
  // ignores it, which is the whole point of smoothing. Prove that first, so
  // this test cannot pass for the wrong reason.
  const beforeBlip = s.holdMs;
  s = stepTuner(s, frame(69.1), 50, OPTS);
  assert.equal(s.cents, 0, 'one stray reading is absorbed by the median, not treated as out of tune');
  assert.ok(s.holdMs > beforeBlip, 'an absorbed blip still counts as in tune');

  // Three of the last five readings 10 cents sharp DOES move the median:
  // outside the 5 cent tolerance, well inside the gross bound.
  for (let i = 0; i < 2; i++) s = stepTuner(s, frame(69.1), 50, OPTS);
  assert.ok(Math.abs(s.cents) > 5, 'a sustained wobble does move the smoothed reading out of tolerance');
  const before = s.holdMs;
  assert.ok(before > 0, 'the hold survived the excursion starting');
  s = stepTuner(s, frame(69.1), 50, OPTS);
  assert.ok(s.holdMs > 0, 'a mild excursion must not wipe the hold');
  assert.ok(s.holdMs < before, 'a mild excursion must still cost something');
});

test('stepTuner: a gross excursion wipes the hold and leaves "holding" at once', () => {
  let s;
  for (let t = 0; t < 900; t += 50) s = stepTuner(s, frame(69.0), 50, { targets: UKE, confirmMs: 600, toleranceCents: 5 });
  assert.equal(s.phase, 'holding', 'steady in-tune input reaches holding');
  // Half a semitone off the A string: a different note, not a wobble. The
  // median needs a few readings to follow it over.
  for (let i = 0; i < 5; i++) s = stepTuner(s, frame(69.5), 50, { targets: UKE, confirmMs: 600, toleranceCents: 5, grossCents: 20 });
  assert.equal(s.holdMs, 0, 'a gross excursion zeroes the hold');
  assert.equal(s.phase, 'tracking', 'the readout must not claim "tuned" while half a semitone off');
});

test('stepTuner: the hold is capped at confirmMs, so a long note banks no credit', () => {
  let s;
  for (let t = 0; t < 8000; t += 50) s = stepTuner(s, frame(69.0), 50, { targets: UKE, confirmMs: 600, toleranceCents: 5 });
  assert.equal(s.phase, 'holding');
  assert.ok(
    s.holdMs <= 600,
    `hold banked ${s.holdMs}ms against a 600ms confirm; going out of tune later would take that long to register`,
  );
});

test('stepTuner: a sustained mild excursion does eventually leave "holding"', () => {
  let s;
  for (let t = 0; t < 900; t += 50) s = stepTuner(s, frame(69.0), 50, { targets: UKE, confirmMs: 600, toleranceCents: 5 });
  assert.equal(s.phase, 'holding');
  // 10 cents flat, held there. Hysteresis grants a grace period; it must end.
  let left = false;
  for (let t = 0; t < 3000; t += 50) {
    s = stepTuner(s, frame(68.9), 50, { targets: UKE, confirmMs: 600, toleranceCents: 5 });
    if (s.phase !== 'holding') { left = true; break; }
  }
  assert.ok(left, 'the grace period must be bounded, not indefinite');
});
