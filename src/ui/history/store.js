// Validates the small amount of extra state the "My progress" panel keeps
// in DB.panels.history (via panelApi.store('history')) beyond what
// src/core/history.js can already read straight out of DB.sessions: the
// name the learner wants shown on a teacher report, and their daily
// minutes goal for the practice calendar (ledger() in src/core/history.js
// takes goalMin as a plain argument — it stays pure and unaware of where
// the number is stored). Pure, no DOM.
export const MAX_LEARNER_NAME = 60;
export const GOAL_MIN_DEFAULT = 15;
export const GOAL_MIN_MIN = 5;
export const GOAL_MIN_MAX = 120;

export function sanitizeHistoryStore(v) {
  const learnerName = v && typeof v.learnerName === 'string' ? v.learnerName.trim().slice(0, MAX_LEARNER_NAME) : '';
  const rawGoal = v && v.goalMin;
  const goalMin = typeof rawGoal === 'number' && isFinite(rawGoal)
    ? Math.min(GOAL_MIN_MAX, Math.max(GOAL_MIN_MIN, Math.round(rawGoal)))
    : GOAL_MIN_DEFAULT;
  return { learnerName, goalMin };
}
