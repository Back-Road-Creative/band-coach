// A mic-mode learner who strums a chord on a single-note item, or whose mic
// is too quiet, or whose input never arrives at all, gets nothing: onPitch's
// pluck/sustain branches (src/app.js) simply return on any frame that fails
// their gate, with no distinction between "silence", "too quiet" and "not a
// single clean pitch". The field report ("strumming does nothing") is the
// last of those three read as if it were the first.
//
// This module is a PURE classifier over a rolling window of recent
// {rms, clarity} frames — no DOM, no AudioContext, unit-testable without a
// browser. It answers one question: of the last `windowSec` seconds, which
// situation is the learner actually in? A single dropout frame (a breath, a
// pick scrape) must not flip the verdict, so every state below requires the
// CONDITION to hold for the full window, not just the newest frame.
//
// States, worst (least signal) first:
//   'silent'    - RMS stays essentially at noise-floor: nothing is reaching
//                 the analyser (wrong device, muted, permission granted to
//                 the wrong input).
//   'too-quiet' - RMS is above silence but never clears the pitch gate: a
//                 real signal is arriving, just too soft to judge.
//   'unclear'   - RMS clears the gate but clarity never clears the
//                 monophonic threshold: loud enough, but not a single clean
//                 pitch — the strummed-chord case from the field report.
//   'ok'        - at least one frame in the window already reads as a clear
//                 single pitch; nothing to say.
// A window with no frames at all, or fewer than needed to span windowSec,
// reports 'insufficient' so a caller never acts on a half-filled buffer.

const SILENCE_RMS = 0.0015; // below this, treat the channel as carrying no signal at all (matches levels.js MIN_FLOOR)

export const INPUT_DIAGNOSIS_MESSAGES = Object.freeze({
  silent: "I'm not hearing anything at all. Check that the right microphone is selected and that it isn't muted.",
  'too-quiet': "I can hear something, but it's too quiet to judge. Try moving closer to the mic, raising its input gain, or run the noise-floor calibration.",
  unclear: 'That sounds like a chord or more than one note at once. Play one note at a time.',
});

// frames: array of { rms, clarity, t } ordered oldest-first, t in seconds
// (any monotonically increasing clock the caller uses — the worklet/listen()
// loop's own now()). gates: { pitch } — the same rms gate onPitch judges
// against, from gatesFor(). clarityGate: the same 0.8 threshold onPitch
// checks (kept as a parameter so a change to that constant elsewhere cannot
// silently desync this module). windowSec: how much trailing history must
// be covered before a verdict other than 'insufficient' is returned.
export function diagnoseInput(frames, { gates, clarityGate = 0.8, windowSec = 1.5 } = {}) {
  const list = Array.isArray(frames) ? frames : [];
  const pitchGate = gates && Number.isFinite(gates.pitch) ? gates.pitch : SILENCE_RMS;
  if (!list.length) return { state: 'insufficient', message: null };

  const latestT = list[list.length - 1].t;
  const earliestT = list[0].t;
  if (!Number.isFinite(latestT) || !Number.isFinite(earliestT) || latestT - earliestT < windowSec) {
    return { state: 'insufficient', message: null };
  }

  const windowStart = latestT - windowSec;
  const inWindow = list.filter((f) => Number.isFinite(f.t) && f.t >= windowStart);
  if (!inWindow.length) return { state: 'insufficient', message: null };

  // 'ok' wins the instant one frame in the window already reads as a clean
  // single pitch: a learner mid-strum who then plays cleanly must not keep
  // hearing yesterday's chord warning.
  const anyClear = inWindow.some((f) => Number.isFinite(f.rms) && f.rms >= pitchGate && Number.isFinite(f.clarity) && f.clarity > clarityGate);
  if (anyClear) return { state: 'ok', message: null };

  const anyAboveSilence = inWindow.some((f) => Number.isFinite(f.rms) && f.rms > SILENCE_RMS);
  if (!anyAboveSilence) return { state: 'silent', message: INPUT_DIAGNOSIS_MESSAGES.silent };

  const anyAboveGate = inWindow.some((f) => Number.isFinite(f.rms) && f.rms >= pitchGate);
  if (!anyAboveGate) return { state: 'too-quiet', message: INPUT_DIAGNOSIS_MESSAGES['too-quiet'] };

  return { state: 'unclear', message: INPUT_DIAGNOSIS_MESSAGES.unclear };
}
