// Pure progression state for the graded lesson track: level, a deterministic
// seed counter and a correct-answer streak. No DOM, no Math.random, no
// wall-clock -- theory.js is the only caller, reading/writing this shape
// through api.store('theory') ({ level, seed, streak }).

const STREAK_TO_LEVEL_UP = 3;

export function initLessonState() {
  return { level: 1, seed: 0, streak: 0 };
}

// Coerces whatever came back from api.store('theory').get() (which may be
// null, stale, or hand-edited) into a valid state -- never trusts saved data.
export function sanitizeLessonState(raw, levelCount) {
  const isPosInt = (x) => Number.isInteger(x) && x >= 0;
  const level = Number.isInteger(raw && raw.level) && raw.level >= 1 && raw.level <= levelCount ? raw.level : 1;
  const seed = isPosInt(raw && raw.seed) ? raw.seed : 0;
  const streak = isPosInt(raw && raw.streak) ? raw.streak : 0;
  return { level, seed, streak };
}

// The seed always advances (so the next question is a fresh one even after a
// wrong answer). A correct answer grows the streak; once it reaches
// STREAK_TO_LEVEL_UP the learner moves up a level and the streak resets. A
// wrong answer resets the streak but never moves the learner back down.
export function recordAnswer(state, correct, levelCount) {
  const seed = state.seed + 1;
  if (!correct) return { next: { level: state.level, seed, streak: 0 }, leveledUp: false };
  const streak = state.streak + 1;
  if (streak >= STREAK_TO_LEVEL_UP && state.level < levelCount) {
    return { next: { level: state.level + 1, seed, streak: 0 }, leveledUp: true };
  }
  return { next: { level: state.level, seed, streak }, leveledUp: false };
}
