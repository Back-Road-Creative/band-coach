// Per-item spaced-repetition memory model.
//
// Today's model (see `forget`/`credit` in src/app.js) is one FIXED 10-day
// half-life applied to every item for every learner, floored at 0.4. This
// module replaces that with a per-item model loosely in the spirit of
// SM-2 / FSRS ("stability" = days until retrievability halves, updated by
// each review outcome) — it does NOT claim to implement either algorithm,
// just borrows their central idea: easy/long-gap successes should grow the
// interval more than scraping by, and a lapse should shrink it.
//
// Pure, deterministic, no DOM. Callers always pass `now` (ms epoch);
// nothing here reads the clock itself.
//
// Item shape: { stability (days, float > 0), difficulty (0..1), lastSeen
// (ms epoch), reps (int >= 0), lapses (int >= 0) }.
//
// Wiring notes for whoever connects this to the app: `it(id)` in app.js
// currently returns `{ m, n, last, seen }`. Feed each of those through
// `migrateItem` ONCE (at load time, before first use) to get the new
// shape, and swap `forget()`/`credit()`'s mastery math for `review()` +
// `retrievability()`. `due()` gives the ordering for "what to ask next".

const DAY_MS = 86400000;
export const DEFAULT_STABILITY_DAYS = 10; // matches the old flat half-life, so a freshly-migrated item behaves the same until its next review
export const MIN_STABILITY_DAYS = 0.5;
export const MAX_STABILITY_DAYS = 3650;
const MIN_R = 1e-6; // floor to keep log2() finite for a fully-forgotten item

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const num = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);

export const GRADE = { LAPSE: 0, HARD: 1, GOOD: 2, EASY: 3 };

// Growth multiplier applied to stability on a successful review, before the
// difficulty/gap/hard-bonus adjustments below. Bigger for an "easy" answer,
// smallest (but still growth, never shrink) for "hard but right".
const GRADE_GROWTH = { [GRADE.HARD]: 1.2, [GRADE.GOOD]: 1.6, [GRADE.EASY]: 2.2 };
const DIFFICULTY_STEP = 0.06;

/**
 * Replicates today's app.js forgetting formula exactly (see `forget()`),
 * used only to compute the value `migrateItem` must reproduce.
 */
function legacyRetrievability(m, last, now) {
  const mass = clamp(num(m, 0.4), 0, 1);
  if (!last) return mass;
  const days = (now - last) / DAY_MS;
  if (days <= 0.5) return mass;
  return clamp(0.4 + (mass - 0.4) * Math.pow(0.5, days / 10), 0, 1);
}

/** Exponential forgetting curve on the item's OWN stability. */
export function retrievability(item, now) {
  const it = item || {};
  const stability = Math.max(MIN_STABILITY_DAYS, num(it.stability, DEFAULT_STABILITY_DAYS));
  const lastSeen = num(it.lastSeen, now);
  const days = (now - lastSeen) / DAY_MS;
  if (days <= 0) return 1;
  return clamp(Math.pow(0.5, days / stability), 0, 1);
}

/**
 * Updates an item after a review. `grade` is 0 (lapse/wrong), 1 (hard but
 * right), 2 (good), or 3 (easy). Stability grows on success — more when the
 * gap since last seen was long relative to the current stability (recalling
 * something you were about to forget is stronger evidence than recalling
 * something you just saw) and a little more again for a "hard" grade,
 * since scraping through a hard-but-correct answer after a long gap is the
 * strongest signal the memory has really taken hold. A lapse halves
 * stability and nudges difficulty up.
 */
export function review(item, { grade, now }) {
  const it = item || {};
  const stability = Math.max(MIN_STABILITY_DAYS, num(it.stability, DEFAULT_STABILITY_DAYS));
  const difficulty = clamp(num(it.difficulty, 0.3), 0, 1);
  const lastSeen = num(it.lastSeen, now);
  const reps = Math.max(0, Math.floor(num(it.reps, 0)));
  const lapses = Math.max(0, Math.floor(num(it.lapses, 0)));
  const elapsedDays = Math.max(0, (now - lastSeen) / DAY_MS);

  if (!grade || grade <= GRADE.LAPSE) {
    return {
      stability: clamp(stability * 0.5, MIN_STABILITY_DAYS, MAX_STABILITY_DAYS),
      difficulty: clamp(difficulty + DIFFICULTY_STEP * 2, 0, 1),
      lastSeen: now,
      reps,
      lapses: lapses + 1,
    };
  }

  const growth = GRADE_GROWTH[grade] || GRADE_GROWTH[GRADE.GOOD];
  const difficultyBonus = 1 + (1 - difficulty) * 0.5; // an easy item that lands still grows, just less
  const gapBonus = 1 + clamp((elapsedDays - stability) / stability, 0, 1) * 0.6; // reviewed near/after it was due
  const hardBonus = grade === GRADE.HARD ? 1.15 : 1; // hard-but-right after a long gap: extra credit
  const newStability = clamp(stability * growth * difficultyBonus * gapBonus * hardBonus, MIN_STABILITY_DAYS, MAX_STABILITY_DAYS);
  const newDifficulty = clamp(difficulty - DIFFICULTY_STEP * (grade - 2), 0, 1);
  return { stability: newStability, difficulty: newDifficulty, lastSeen: now, reps: reps + 1, lapses };
}

/**
 * Orders `items` (an array of item-shaped objects, each may carry an `id`
 * or any other passenger fields — they are copied through unchanged) by
 * retrievability ascending: most-forgotten first. Adds `r` (retrievability
 * at `now`) and `overdue` (r below `target`, default 0.85) to each entry.
 * Ties break by `id` for a stable, deterministic order.
 */
export function due(items, now, { target = 0.85 } = {}) {
  return (Array.isArray(items) ? items : [])
    .map((entry) => ({ ...entry, r: retrievability(entry, now) }))
    .sort((a, b) => a.r - b.r || String(a.id).localeCompare(String(b.id)))
    .map((entry) => ({ ...entry, overdue: entry.r < target }));
}

/**
 * Converts one of today's `{ m, n, last, seen }` item records into an
 * equivalent starting state under the new model, so a learner's progress
 * is preserved: `retrievability(migrateItem(old, now), now)` equals what
 * the OLD flat-half-life formula (`legacyRetrievability`) gives for the
 * same item at the same instant. It does this by giving the new item the
 * default stability and backdating `lastSeen` by exactly the number of
 * days needed to reproduce that retrievability value under exponential
 * decay — the migration is invisible the moment it happens; only future
 * reviews behave differently.
 */
export function migrateItem(oldItem, now) {
  const o = oldItem || {};
  const m = clamp(num(o.m, 0.4), 0, 1);
  const last = num(o.last, 0);
  const targetR = clamp(legacyRetrievability(m, last, now), 0, 1);
  const stability = DEFAULT_STABILITY_DAYS;
  const safeR = Math.max(targetR, MIN_R);
  const elapsedDays = safeR >= 1 ? 0 : -stability * Math.log2(safeR);
  return {
    stability,
    difficulty: clamp(1 - m, 0, 1),
    lastSeen: now - elapsedDays * DAY_MS,
    reps: Math.max(0, Math.floor(num(o.n, 0))),
    lapses: 0,
  };
}
