// Pure state and timing/pitch helpers for the Ear-training panel
// (src/ui/ear.js). No DOM, no Math.random, no Date.now: everything here is a
// plain function of its arguments so it can be unit-tested with node:test
// and so the panel's persisted store (api.store('ear')) stays a plain object
// built entirely from these functions' return values.

// A run of LEVEL_UP_RUN correct answers in a row moves the exercise up one
// level; a run of LEVEL_DOWN_RUN wrong answers in a row moves it down one.
// Either transition resets the streak so the next run starts clean.
export const LEVEL_UP_RUN = 3;
export const LEVEL_DOWN_RUN = 2;

export function defaultExerciseState() {
  return { level: 1, streak: 0, correct: 0, total: 0 };
}

// state: { level, streak, correct, total }. `streak` is signed: positive is
// a run of correct answers, negative a run of wrong ones.
export function recordAnswer(state, correct, maxLevel, opts = {}) {
  const upRun = opts.upRun ?? LEVEL_UP_RUN;
  const downRun = opts.downRun ?? LEVEL_DOWN_RUN;
  const total = (state.total || 0) + 1;
  const correctCount = (state.correct || 0) + (correct ? 1 : 0);
  const prevStreak = state.streak || 0;
  let streak = correct ? (prevStreak > 0 ? prevStreak + 1 : 1) : (prevStreak < 0 ? prevStreak - 1 : -1);
  let level = state.level || 1;
  if (streak >= upRun && level < maxLevel) {
    level += 1;
    streak = 0;
  } else if (streak <= -downRun && level > 1) {
    level -= 1;
    streak = 0;
  }
  return { level, streak, correct: correctCount, total };
}

export function accuracy(state) {
  if (!state || !state.total) return null;
  return state.correct / state.total;
}

// ---- rhythm timing: ticks (480/quarter, the shared Song shape) <-> seconds
// at a fixed playback tempo -----------------------------------------------

export const TICKS_PER_QUARTER = 480;

export function secondsPerQuarter(bpm) {
  return 60 / bpm;
}

export function ticksToSeconds(ticks, bpm) {
  return (ticks / TICKS_PER_QUARTER) * secondsPerQuarter(bpm);
}

export function secondsToTicks(seconds, bpm) {
  return Math.round((seconds / secondsPerQuarter(bpm)) * TICKS_PER_QUARTER);
}

// Converts a learner's raw tap timestamps (seconds, any shared clock) into
// onset ticks anchored on the first tap, matching rhythm-dictation's answer
// shape (an onsets array that always starts at 0).
export function tapsToOnsets(tapTimes, bpm) {
  if (!tapTimes.length) return [];
  const t0 = tapTimes[0];
  return tapTimes.map((t) => secondsToTicks(t - t0, bpm));
}

// ---- intonation: cents offset applied to a fractional MIDI note ---------

export function centsToMidi(midi, cents = 0) {
  return midi + (cents || 0) / 100;
}

// ---- sing-back: turn a noisy stream of per-frame MIDI readings (or null
// for "no clear pitch this frame") into the stable, deduplicated sequence of
// distinct notes a learner actually sang. A reading only counts once it has
// held within `minSemitoneDelta` of itself for `minStable` consecutive
// frames, and the same note never appears twice in a row (a sustained note
// re-samples as one entry, not one per frame).
export function segmentPitches(samples, { minStable = 2, minSemitoneDelta = 0.6 } = {}) {
  const notes = [];
  let runMidi = null;
  let runLen = 0;
  for (const raw of samples) {
    if (raw == null) {
      runMidi = null;
      runLen = 0;
      continue;
    }
    if (runMidi != null && Math.abs(raw - runMidi) <= minSemitoneDelta) {
      runLen += 1;
    } else {
      runMidi = raw;
      runLen = 1;
    }
    if (runLen === minStable) {
      const rounded = Math.round(runMidi);
      if (notes[notes.length - 1] !== rounded) notes.push(rounded);
    }
  }
  return notes;
}
