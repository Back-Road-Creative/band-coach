// Validates the small amount of extra state the "My progress" panel keeps
// in DB.panels.history (via panelApi.store('history')) beyond what
// src/core/history.js can already read straight out of DB.sessions. Right
// now that is just the name the learner wants shown on a teacher report —
// summarize()/toTeacherSummary() need nothing else the session log doesn't
// already carry. Pure, no DOM.
export const MAX_LEARNER_NAME = 60;

export function sanitizeHistoryStore(v) {
  const learnerName = v && typeof v.learnerName === 'string' ? v.learnerName.trim().slice(0, MAX_LEARNER_NAME) : '';
  return { learnerName };
}
