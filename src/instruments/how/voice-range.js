// Voice "how to produce this note" — a range test as pure logic. Zero
// dependencies; pure functions; no DOM, no microphone access here: the
// caller runs an ascending/descending guided slide through the real pitch
// detector and hands the resulting samples in.
//
// Wiring pass: feed a stream of `{ midi, ms }` samples (one detected pitch
// and how many milliseconds it was held, from a slide that starts
// comfortable and moves outward) to `estimateRange(samples)` to get a
// `{ low, high }` comfortable range. `classify(range)` turns that into a
// plain-language nearest-voice-type HINT (never a diagnosis). Wired in:
// src/app.js's "Find my range" flow (voice options) drives a real
// low-then-high sing-and-hold through the mic, calls `estimateRange`, and
// saves the result as `prefs.voiceRange`. That saved range becomes a fourth
// 'mine' choice alongside the three fixed VOICE_KINDS entries, its tonic
// picked by `tonicFromRange(exerciseRangeFor(range))` -- `exerciseRangeFor`
// pulls a safety margin in from both ends so warm-up exercises never ask for
// the singer's absolute extremes.

const MIN_SUSTAIN_MS = 400;

// Drop samples too brief to be a deliberately held note, then trim
// statistical outliers (spurious single-frame pitch-detector glitches) with
// the standard interquartile rule, so one bad reading can't blow the range
// out by an octave.
//
// Samples tagged `stage: 'low'` / `stage: 'high'` (the "Find my range"
// sing-low-then-high flow) are trimmed per stage: the low comes only from the
// low stage and the high only from the high stage. Pooled, a learner who took
// a few breaths on the low note outnumbered the high samples and the rule
// threw the high note away as an outlier. Untagged samples (one slide) are
// trimmed together, as before.
export function estimateRange(samples) {
  const sustained = samples.filter(s => s.ms >= MIN_SUSTAIN_MS);
  if (sustained.length === 0) return null;

  const lowStage = trimOutliers(sustained.filter(s => s.stage === 'low').map(s => s.midi));
  const highStage = trimOutliers(sustained.filter(s => s.stage === 'high').map(s => s.midi));
  if (lowStage.length > 0 && highStage.length > 0) {
    return { low: Math.min(...lowStage), high: Math.max(...highStage) };
  }

  const kept = trimOutliers(sustained.map(s => s.midi));
  return { low: Math.min(...kept), high: Math.max(...kept) };
}

function trimOutliers(midis) {
  if (midis.length === 0) return midis;
  const sorted = [...midis].sort((a, b) => a - b);
  const quartile = p => {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  const q1 = quartile(0.25);
  const q3 = quartile(0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const trimmed = sorted.filter(m => m >= lowerFence && m <= upperFence);
  return trimmed.length > 0 ? trimmed : sorted;
}

// Approximate comfortable ranges for the standard voice types, used only to
// find the nearest match — never a strict boundary. Ordered low to high.
const VOICE_TYPES = [
  { name: 'bass', low: 40, high: 64 }, // E2-E4
  { name: 'baritone', low: 45, high: 69 }, // A2-A4
  { name: 'tenor', low: 48, high: 72 }, // C3-C5
  { name: 'alto', low: 53, high: 77 }, // F3-F5
  { name: 'mezzo-soprano', low: 57, high: 81 }, // A3-A5
  { name: 'soprano', low: 60, high: 84 } // C4-C6
];

// Nearest voice type by comparing range midpoints — a HINT, never a verdict:
// callers should present it as "sounds closest to X", not "you are an X".
export function classify(range) {
  const mid = (range.low + range.high) / 2;
  let best = VOICE_TYPES[0];
  let bestDist = Infinity;
  for (const type of VOICE_TYPES) {
    const typeMid = (type.low + type.high) / 2;
    const dist = Math.abs(mid - typeMid);
    if (dist < bestDist) {
      bestDist = dist;
      best = type;
    }
  }
  return { hint: best.name, wording: 'Sounds closest to ' + best.name + ' — sing wherever is comfortable, this is only a hint.' };
}

// The span exercises should actually ask for: a margin pulled in from both
// ends of the comfortable range so warm-ups never sit right at a singer's
// break or their absolute limit. Falls back to the full range (or a single
// point) if the range is too narrow for the default margin.
export function exerciseRangeFor(range, margin = 3) {
  const low = range.low + margin;
  const high = range.high - margin;
  if (low < high) return { low, high };
  const mid = Math.round((range.low + range.high) / 2);
  return { low: mid, high: mid };
}

// Where to put the movable tonic (Do) once a "find my range" test has
// produced an exercise range: its low end, so the 0-12 scale degrees the
// voice exercises already use (src/app.js's 'v' item kind) climb through the
// whole comfortable span the singer actually has. A margin-trimmed range
// under an octave (12 semitones) cannot fit that span no matter where the
// tonic sits -- `stretch` flags that case so the caller can say plainly that
// the exercises will ask for a little more than was sung, rather than
// silently clamping degree 12 down to something the singer never produced.
export function tonicFromRange(exerciseRange) {
  return { tonic: Math.round(exerciseRange.low), stretch: (exerciseRange.high - exerciseRange.low) < 12 };
}
