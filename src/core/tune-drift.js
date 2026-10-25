// F6: has the instrument drifted out of tune during a session? One sour note
// is the player; the median of the last few clean drill notes sitting well
// off in the same direction is the strings. Pure, so the rule can be tested
// without a microphone.
export const DRIFT_NOTES = 8;
export const DRIFT_LIMIT_CENTS = 20;

// cents: how far each clean note sat from its nearest semitone, oldest first.
// Returns null until there are DRIFT_NOTES of them, or while the median is
// within DRIFT_LIMIT_CENTS; otherwise { cents, flat } with cents rounded to the
// nearest 5, because "about 25 cents" is what a learner can act on.
export function tuneDrift(cents, { n = DRIFT_NOTES, limit = DRIFT_LIMIT_CENTS } = {}) {
  const last = cents.filter(Number.isFinite).slice(-n);
  if (last.length < n) return null;
  const s = last.slice().sort((a, b) => a - b);
  const med = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  if (Math.abs(med) <= limit) return null;
  return { cents: Math.round(Math.abs(med) / 5) * 5, flat: med < 0 };
}
