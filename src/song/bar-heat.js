// Per-bar heat map of a judged take: groups a judgeAttempt() result's
// `matches` (src/ui/songs/practice.js) by the bar each expected note falls
// in, so a Songs lesson can show the learner which bars are solid and which
// need another pass. Pure: no DOM, no AudioContext — the caller (later UI
// unit) supplies the song and the already-judged matches.

import { barsOf } from './model.js';

// ---- grading thresholds --------------------------------------------------
// A bar with no judged notes at all (nothing was expected, or the caller
// only judged part of the song) is 'none' — there is nothing to practise.
// A bar at or below MISS_MAX_HIT_RATE is 'miss' (the learner played little
// to none of it). A bar at or above GOOD_MIN_HIT_RATE whose average timing
// and pitch error is within the GOOD_* bounds is 'good'. Everything else —
// including a bar where every note was technically hit but late/sharp/flat
// enough to fail the GOOD_* bounds — is 'shaky'.
export const MISS_MAX_HIT_RATE = 0.25;
export const GOOD_MIN_HIT_RATE = 0.85;
export const GOOD_MAX_ABS_ERROR_MS = 40;
export const GOOD_MAX_ABS_CENTS = 25;

// Rank used by worstBars: lower is worse (more in need of practice). 'none'
// ranks last — a bar with nothing judged in it is not a practice target.
const GRADE_RANK = { miss: 0, shaky: 1, good: 2, none: 3 };

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

// { bar, judged, hits, hitRate, meanAbsErrorMs, meanAbsCents, grade } per
// bar of `song`, in bar order. `matches` is a judgeAttempt() result's
// `matches` array (or any array shaped like it) — every entry's note.start
// (ticks) decides which bar it belongs to.
export function barHeat(song, matches, opts = {}) {
  // barsOf follows metreChanges, so heat bars match every other bar view.
  const boundaries = barsOf(song);
  const heat = [];
  for (let bar = 0; bar < boundaries.length - 1; bar++) {
    const barStart = boundaries[bar];
    const barEnd = boundaries[bar + 1];
    const barMatches = matches.filter((m) => m.note.start >= barStart && m.note.start < barEnd);
    const judged = barMatches.length;
    const hits = barMatches.filter((m) => m.ok).length;
    const hitRate = judged ? hits / judged : 0;
    const absErrors = barMatches.map((m) => m.errorMs).filter((e) => e !== null && e !== undefined).map(Math.abs);
    const absCents = barMatches.map((m) => m.cents).filter((c) => c !== null && c !== undefined).map(Math.abs);
    const meanAbsErrorMs = mean(absErrors);
    const meanAbsCents = mean(absCents);
    let grade;
    if (judged === 0) {
      grade = 'none';
    } else if (hitRate <= MISS_MAX_HIT_RATE) {
      grade = 'miss';
    } else if (
      hitRate >= GOOD_MIN_HIT_RATE &&
      (meanAbsErrorMs === null || meanAbsErrorMs <= GOOD_MAX_ABS_ERROR_MS) &&
      (meanAbsCents === null || meanAbsCents <= GOOD_MAX_ABS_CENTS)
    ) {
      grade = 'good';
    } else {
      grade = 'shaky';
    }
    heat.push({ bar, judged, hits, hitRate, meanAbsErrorMs, meanAbsCents, grade });
  }
  return heat;
}

// The n bars most in need of practice: sorted worst-grade-first (miss,
// then shaky, then good, then none), ties broken by bar order. Does not
// mutate `heat`.
export function worstBars(heat, n) {
  return [...heat]
    .sort((a, b) => (GRADE_RANK[a.grade] - GRADE_RANK[b.grade]) || (a.bar - b.bar))
    .slice(0, n);
}
