// F11: the app used three hard-coded loudness gates (0.008 / 0.01 / 0.012
// RMS) with AGC off. A quiet mic or audio interface never crosses them; a
// hot one false-triggers on room noise. This module measures a learner's
// actual noise floor and derives the same three gates from it, so both
// ends of the hardware spectrum work — and falls back to EXACTLY today's
// constants when no measurement exists, so every existing test (written
// against those literals) stays green untouched.

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Today's constants, kept as the no-calibration default and as the ratio
// the scaled gates preserve.
export const DEFAULT_GATES = Object.freeze({ pitch: 0.008, note: 0.01, chord: 0.012 });

// A measured floor is trusted only inside this band. Below MIN_FLOOR the
// interface is treated as silent-enough that the default gates already
// work; above MAX_FLOOR the room is noisy enough that we cap how far the
// gates are allowed to rise, so real playing can still cross them.
const MIN_FLOOR = 0.0015;
const MAX_FLOOR = 0.03;
// The gate sits this many times above the measured floor: enough margin
// that ordinary noise-floor jitter doesn't cross it, small enough that a
// quiet interface still triggers on quiet playing.
const MARGIN = 3;

// Robust central estimate of a learner's room/interface noise floor from a
// series of RMS samples taken while they were asked to stay quiet. A cough
// or a single stray loud moment must not inflate the result, so the top
// 20% of samples (highest RMS) are trimmed before taking the median of
// what's left.
export function noiseFloor(rmsSamples) {
  const xs = (Array.isArray(rmsSamples) ? rmsSamples : [])
    .filter((x) => Number.isFinite(x) && x >= 0)
    .sort((a, b) => a - b);
  if (!xs.length) return 0;
  const keep = Math.max(1, Math.ceil(xs.length * 0.8));
  const trimmed = xs.slice(0, keep);
  const mid = Math.floor(trimmed.length / 2);
  return trimmed.length % 2 ? trimmed[mid] : (trimmed[mid - 1] + trimmed[mid]) / 2;
}

// The three gate values the app uses today, scaled from a measured noise
// floor. `floorRms` is `DB.prefs.noiseFloor`: null (no calibration ever
// run), NaN/non-finite (corrupt storage), or a finite RMS value.
export function gatesFor(floorRms) {
  if (!Number.isFinite(floorRms) || floorRms <= 0) return { ...DEFAULT_GATES };
  const clamped = clamp(floorRms, MIN_FLOOR, MAX_FLOOR);
  const pitch = clamped * MARGIN;
  // Preserve today's ratios (0.008 : 0.01 : 0.012 === 1 : 1.25 : 1.5) so the
  // three thresholds keep the same relative spacing when scaled.
  return { pitch, note: pitch * 1.25, chord: pitch * 1.5 };
}

// VERIFIED DEFECT 2 (mic-gate-and-capture): src/app.js's onPitch used a raw
// hard-coded RMS release floor (0.006) to decide when a still-ringing pluck
// has died down enough to accept a same-note re-pluck, ignoring the
// calibrated gates entirely -- a quiet mic calibrated down to a lower
// gates.pitch would never cross 0.006 at all, and a hot mic/noisy room
// calibrated up past it would treat ordinary room noise as "released."
// 0.006 / DEFAULT_GATES.pitch (0.008) === 0.75, so releaseFloor() derives
// the same ratio off whatever gates are active: at the uncalibrated
// defaults this returns EXACTLY 0.006, keeping today's behaviour untouched.
export const RELEASE_GATE_RATIO = 0.75;

export function releaseFloor(gatesArg) {
  const pitchGate = gatesArg && Number.isFinite(gatesArg.pitch) ? gatesArg.pitch : DEFAULT_GATES.pitch;
  return pitchGate * RELEASE_GATE_RATIO;
}

// Maps an RMS value onto a 0..1 dB-scaled range for a level meter. Human
// loudness perception (and mic clipping headroom) is logarithmic, so a
// linear RMS-to-width mapping would make everything below "shouting" look
// empty.
const METER_MIN_DB = -60; // near silence for a typical mic preamp
const METER_MAX_DB = -6; // comfortably below clipping

export function meterLevel(rms) {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return clamp((db - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB), 0, 1);
}
