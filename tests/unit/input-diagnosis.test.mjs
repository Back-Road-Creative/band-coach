// Field report: "web cam mic is not catching the strumming." Root cause
// (measured, see src/audio/yin.js and src/app.js onPitch) is that a strum
// never clears clarity > 0.8 and the app goes silent with no explanation.
// diagnoseInput() classifies WHY a rolling window of {rms, clarity} frames
// is producing nothing, so the learner can be told which of three things is
// actually happening.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseInput, stepDiagnosis, DIAGNOSIS_GRACE_SEC, INPUT_DIAGNOSIS_MESSAGES } from '../../src/audio/input-diagnosis.js';

const GATES = { pitch: 0.008 }; // a fixed test gate (DEFAULT_GATES.pitch is now 0.004; these cases pin the verdict order at 0.008)

// Builds a run of frames at 50ms spacing (the app's listen()/worklet cadence)
// covering `seconds` of history, all with the same rms/clarity.
function steadyFrames(seconds, rms, clarity, { stepMs = 50, startT = 0 } = {}) {
  const frames = [];
  const n = Math.round((seconds * 1000) / stepMs) + 1;
  for (let i = 0; i < n; i++) frames.push({ t: startT + (i * stepMs) / 1000, rms, clarity });
  return frames;
}

// ---------- insufficient data ----------

test('an empty frame window is insufficient', () => {
  const r = diagnoseInput([], { gates: GATES });
  assert.equal(r.state, 'insufficient');
  assert.equal(r.message, null);
});

test('a window shorter than windowSec is insufficient even if loud and clear', () => {
  const frames = steadyFrames(0.5, 0.05, 0.95); // only 0.5s of history, default windowSec is 1.5
  const r = diagnoseInput(frames, { gates: GATES });
  assert.equal(r.state, 'insufficient');
});

test('a window exactly spanning windowSec is decided, not insufficient', () => {
  const frames = steadyFrames(1.5, 0.05, 0.95);
  const r = diagnoseInput(frames, { gates: GATES });
  assert.equal(r.state, 'ok');
});

// ---------- silent: RMS never leaves the noise floor ----------

test('RMS pinned at zero for a sustained span reads silent', () => {
  const frames = steadyFrames(2, 0, 0);
  const r = diagnoseInput(frames, { gates: GATES });
  assert.equal(r.state, 'silent');
  assert.equal(r.message, INPUT_DIAGNOSIS_MESSAGES.silent);
});

test('RMS at the silence boundary (not above it) still reads silent', () => {
  const frames = steadyFrames(2, 0.0015, 0); // SILENCE_RMS itself, not strictly above
  const r = diagnoseInput(frames, { gates: GATES });
  assert.equal(r.state, 'silent');
});

// ---------- too-quiet: real signal, under the pitch gate ----------

test('RMS just above the silence floor but under the pitch gate reads too-quiet', () => {
  const frames = steadyFrames(2, 0.002, 0.9); // above SILENCE_RMS, below GATES.pitch (0.008)
  const r = diagnoseInput(frames, { gates: GATES });
  assert.equal(r.state, 'too-quiet');
  assert.equal(r.message, INPUT_DIAGNOSIS_MESSAGES['too-quiet']);
});

test('RMS just under the pitch gate boundary reads too-quiet, not ok', () => {
  const frames = steadyFrames(2, 0.0079, 1.0);
  const r = diagnoseInput(frames, { gates: GATES });
  assert.equal(r.state, 'too-quiet');
});

test('RMS exactly at the pitch gate is treated as clearing it (>=)', () => {
  const frames = steadyFrames(2, 0.008, 0.95);
  const r = diagnoseInput(frames, { gates: GATES });
  assert.equal(r.state, 'ok');
});

// ---------- unclear: loud enough, never a single clean pitch (the strum) ----------

test('RMS above the gate with clarity stuck at a strummed-chord level reads unclear', () => {
  const frames = steadyFrames(2, 0.05, 0.77); // measured strum clarity from the field investigation
  const r = diagnoseInput(frames, { gates: GATES });
  assert.equal(r.state, 'unclear');
  assert.equal(r.message, INPUT_DIAGNOSIS_MESSAGES.unclear);
});

test('clarity exactly at the 0.8 threshold does not count as clear (matches onPitch\'s strict >)', () => {
  const frames = steadyFrames(2, 0.05, 0.8);
  const r = diagnoseInput(frames, { gates: GATES });
  assert.equal(r.state, 'unclear');
});

test('clarity just above 0.8 reads ok', () => {
  const frames = steadyFrames(2, 0.05, 0.801);
  const r = diagnoseInput(frames, { gates: GATES });
  assert.equal(r.state, 'ok');
});

// ---------- ok: at least one clean frame in the window ----------

test('a single clean-pitch frame anywhere in the window is enough to read ok', () => {
  const noisy = steadyFrames(1, 0.05, 0.5, { startT: 0 });
  const clean = [{ t: 1.05, rms: 0.05, clarity: 0.95 }];
  const rest = steadyFrames(0.5, 0.05, 0.5, { startT: 1.1 });
  const r = diagnoseInput([...noisy, clean[0], ...rest], { gates: GATES });
  assert.equal(r.state, 'ok');
  assert.equal(r.message, null);
});

// ---------- sustained span: a brief dropout must not flip the verdict ----------

test('one silent frame amid an otherwise clean, sustained window still reads ok', () => {
  const before = steadyFrames(0.8, 0.05, 0.95, { startT: 0 });
  const dropout = [{ t: 0.85, rms: 0, clarity: 0 }];
  const after = steadyFrames(0.8, 0.05, 0.95, { startT: 0.9 });
  const r = diagnoseInput([...before, ...dropout, ...after], { gates: GATES });
  assert.equal(r.state, 'ok', 'a single dropout frame must not flip a clean sustained window to silent');
});

test('one loud clear frame amid an otherwise silent window does not yet read silent for that instant', () => {
  const before = steadyFrames(0.8, 0, 0, { startT: 0 });
  const blip = [{ t: 0.85, rms: 0.05, clarity: 0.95 }];
  const after = steadyFrames(0.8, 0, 0, { startT: 0.9 });
  const r = diagnoseInput([...before, ...blip, ...after], { gates: GATES });
  // the window still contains the one clean frame, so it reads ok rather
  // than flapping back to silent on a single stray transient
  assert.equal(r.state, 'ok');
});

test('a state only becomes silent again once the clean frame ages out of the window', () => {
  const blip = [{ t: 0, rms: 0.05, clarity: 0.95 }];
  const after = steadyFrames(2, 0, 0, { startT: 0.05 }); // 2s of silence after the blip, windowSec default 1.5
  const r = diagnoseInput([...blip, ...after], { gates: GATES });
  assert.equal(r.state, 'silent', 'once the one clean frame is outside the trailing window, silence should show again');
});

// ---------- gates parameter is honoured, not hard-coded ----------

test('a caller-supplied pitch gate (post-calibration) is used instead of the default', () => {
  const highGate = { pitch: 0.05 };
  const frames = steadyFrames(2, 0.02, 0.95); // clears DEFAULT_GATES.pitch but not this calibrated gate
  const r = diagnoseInput(frames, { gates: highGate });
  assert.equal(r.state, 'too-quiet');
});

test('missing/invalid gates falls back to a sane silence-scale default rather than throwing', () => {
  const frames = steadyFrames(2, 0, 0);
  assert.doesNotThrow(() => diagnoseInput(frames, {}));
  assert.doesNotThrow(() => diagnoseInput(frames));
});

// ---------- quiet single pluck: one attack frame must not read as a chord ----------

test('a quiet single pluck (one attack frame over the gate, clarity 0.5, rest below) reads too-quiet, not unclear', () => {
  const frames = steadyFrames(2, 0.004, 0.9);
  frames[20] = { ...frames[20], rms: 0.009, clarity: 0.5 };
  const r = diagnoseInput(frames, { gates: { pitch: 0.005 } }); // the attack peak crosses this gate, the ringing pluck does not
  assert.equal(r.state, 'too-quiet');
});

test('a sustained share (>= 0.3) of frames over the gate that is never clear still reads unclear', () => {
  const frames = steadyFrames(2, 0.004, 0.5);
  const n = Math.ceil(frames.length * 0.4);
  for (let i = frames.length - n; i < frames.length; i++) frames[i] = { ...frames[i], rms: 0.02, clarity: 0.5 };
  assert.equal(diagnoseInput(frames, { gates: GATES }).state, 'unclear');
});

// ---------- stepDiagnosis: what the coach line should do with a verdict ----------

test('stepDiagnosis: a silent or too-quiet verdict inside the grace period says nothing and is not remembered', () => {
  for (const state of ['silent', 'too-quiet']) {
    const r = stepDiagnosis({ state, message: INPUT_DIAGNOSIS_MESSAGES[state] }, null, { sinceSec: 1.6 });
    assert.deepEqual(r, { last: null, say: null, clear: false });
  }
});

test('stepDiagnosis: a silent verdict after the grace period is said once', () => {
  const diag = { state: 'silent', message: INPUT_DIAGNOSIS_MESSAGES.silent };
  const first = stepDiagnosis(diag, null, { sinceSec: DIAGNOSIS_GRACE_SEC });
  assert.deepEqual(first, { last: 'silent', say: INPUT_DIAGNOSIS_MESSAGES.silent, clear: false });
  assert.deepEqual(stepDiagnosis(diag, 'silent', { sinceSec: 9 }), { last: 'silent', say: null, clear: false });
});

test('stepDiagnosis: a chord warning is not held back by the grace period', () => {
  const r = stepDiagnosis({ state: 'unclear', message: INPUT_DIAGNOSIS_MESSAGES.unclear }, null, { sinceSec: 1.6 });
  assert.equal(r.say, INPUT_DIAGNOSIS_MESSAGES.unclear);
});

test('stepDiagnosis: ok after a warning clears it; ok with no warning showing does nothing', () => {
  for (const last of ['silent', 'too-quiet', 'unclear']) {
    assert.deepEqual(stepDiagnosis({ state: 'ok', message: null }, last, { sinceSec: 9 }), { last: 'ok', say: null, clear: true });
  }
  assert.deepEqual(stepDiagnosis({ state: 'ok', message: null }, null, { sinceSec: 9 }), { last: 'ok', say: null, clear: false });
  assert.deepEqual(stepDiagnosis({ state: 'ok', message: null }, 'ok', { sinceSec: 9 }), { last: 'ok', say: null, clear: false });
});

test('stepDiagnosis: insufficient changes nothing', () => {
  assert.deepEqual(stepDiagnosis({ state: 'insufficient', message: null }, 'unclear', { sinceSec: 9 }), { last: 'unclear', say: null, clear: false });
});

test('stepDiagnosis: a warning that comes back after ok is said again', () => {
  const r = stepDiagnosis({ state: 'unclear', message: INPUT_DIAGNOSIS_MESSAGES.unclear }, 'ok', { sinceSec: 9 });
  assert.equal(r.say, INPUT_DIAGNOSIS_MESSAGES.unclear);
});

// ---------- quietRoom: a calibrated quiet room is not a dead microphone ----------

test('quietRoom: a window that never reaches the gate is "waiting", not silent or too-quiet', () => {
  for (const rms of [0, 0.0005, 0.002]) {
    const r = diagnoseInput(steadyFrames(2, rms, 0), { gates: GATES, quietRoom: true });
    assert.deepEqual(r, { state: 'waiting', message: null });
  }
});

test('quietRoom: sound over the gate that is never clear is still too-quiet or a chord', () => {
  const frames = steadyFrames(2, 0.002, 0.9);
  frames[frames.length - 1] = { ...frames[frames.length - 1], rms: 0.02, clarity: 0.5 };
  assert.equal(diagnoseInput(frames, { gates: GATES, quietRoom: true }).state, 'too-quiet');
  assert.equal(diagnoseInput(steadyFrames(2, 0.02, 0.5), { gates: GATES, quietRoom: true }).state, 'unclear');
});

test('without quietRoom a window under the gate is still reported as before', () => {
  assert.equal(diagnoseInput(steadyFrames(2, 0.0005, 0), { gates: GATES }).state, 'silent');
});

test('stepDiagnosis: a "waiting" verdict changes nothing', () => {
  assert.deepEqual(stepDiagnosis({ state: 'waiting', message: null }, 'unclear', { sinceSec: 9 }), { last: 'unclear', say: null, clear: false });
  assert.deepEqual(stepDiagnosis({ state: 'waiting', message: null }, null, { sinceSec: 9 }), { last: null, say: null, clear: false });
});
