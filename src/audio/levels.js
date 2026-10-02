// F11: the app used three hard-coded loudness gates (originally 0.008 / 0.01
// / 0.012 RMS, now 0.004 / 0.005 / 0.006) with AGC off. A quiet mic or audio interface never crosses them; a
// hot one false-triggers on room noise. This module measures a learner's
// actual noise floor and derives the same three gates from it, so both
// ends of the hardware spectrum work — and falls back to the
// DEFAULT_GATES constants when no measurement exists. Connect measures the
// room once (src/app.js openMic), so the defaults only serve until then.

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// The no-calibration default, and the 1 : 1.25 : 1.5 ratio the scaled gates
// preserve. Set at a quiet laptop-mic room's level (~ -48 dBFS) so a soft
// guitar pluck is judged even before the first measurement.
export const DEFAULT_GATES = Object.freeze({ pitch: 0.004, note: 0.005, chord: 0.006 });

// A measured floor is trusted only inside this band. Below MIN_FLOOR the
// interface is treated as silent-enough that the default gates already
// work; above MAX_FLOOR the room is noisy enough that we cap how far the
// gates are allowed to rise, so real playing can still cross them.
export const MIN_FLOOR = 0.0015;
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
  // Preserve the default ratios (0.004 : 0.005 : 0.006 === 1 : 1.25 : 1.5) so the
  // three thresholds keep the same relative spacing when scaled.
  return { pitch, note: pitch * 1.25, chord: pitch * 1.5 };
}

// VERIFIED DEFECT 2 (mic-gate-and-capture): src/app.js's onPitch used a raw
// hard-coded RMS release floor (0.006) to decide when a still-ringing pluck
// has died down enough to accept a same-note re-pluck, ignoring the
// calibrated gates entirely -- a quiet mic calibrated down to a lower
// gates.pitch would never cross 0.006 at all, and a hot mic/noisy room
// calibrated up past it would treat ordinary room noise as "released."
// 0.006 / the old DEFAULT_GATES.pitch (0.008) === 0.75, so releaseFloor()
// derives the same ratio off whatever gates are active: at the uncalibrated
// defaults (pitch 0.004) this returns 0.003.
const RELEASE_GATE_RATIO = 0.75;

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

// Room check (Connect's automatic check and the "Check my microphone" button).
// A floor is only worth storing if the window really was the room: a floor
// learned from someone already playing sits below the gates it then sets, so
// real playing never crosses them. Stored floors carry this version so one
// learned before the check could abstain is dropped on load (src/app.js sanitizeDB).
export const ROOM_CHECK_VERSION = 2;

// A frame below MIN_FLOOR is quiet whatever its pitch (a faint pitched hiss on
// a very quiet interface is still the room). Of the louder frames, this share
// being pitched means someone is playing, singing or humming.
const PITCHED_SHARE = 0.25;
// Peak this many times the median frame means plucks, strums or drum hits, not
// a steady room. The median is of ALL frames, so a window of silence with one
// hit is bursty too.
const BURST_RATIO = 3;

const median = (xs) => { const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// `frames` is one measurement window: [{ rms, pitched }] per analysis frame.
// Returns { floor } to store, or { abstain: 'sound' | 'unusable' }.
//
// The two checks ask different things on purpose. The automatic check runs
// when the learner pressed Connect and may already be playing, so it refuses
// anything that looks like playing: pitched content OR bursts. The manual
// check runs after they pressed "Check my microphone" and were told to stay
// quiet, so only bursts (plucks, strums, drum hits) prove they are playing
// anyway; a steady pitched sound such as mains hum IS their room and is
// learned there, though the automatic check refuses it.
export function classifyRoomCheck(frames, { manual = false } = {}) {
  const fs = (Array.isArray(frames) ? frames : []).filter((f) => f && Number.isFinite(f.rms) && f.rms >= 0);
  if (!fs.length) return { abstain: 'unusable' };
  const rms = fs.map((f) => f.rms), peak = Math.max(...rms);
  if (peak >= MIN_FLOOR && peak > BURST_RATIO * median(rms)) return { abstain: 'sound' };
  if (!manual) {
    const loud = fs.filter((f) => f.rms >= MIN_FLOOR);
    if (loud.length && loud.filter((f) => f.pitched).length / loud.length >= PITCHED_SHARE) return { abstain: 'sound' };
  }
  // A real microphone always reads a little above exactly 0 (its own electronic hiss), so a window whose floor comes out 0 is one where no audio reached the analyser (the stream had not started, or it died): there is nothing to store, and "your room is quiet" would be false.
  const floor = noiseFloor(rms);
  return floor > 0 && Number.isFinite(floor) ? { floor: clamp(floor, 0, 1) } : { abstain: 'unusable' };
}
