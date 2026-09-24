// Orders one practice sitting into at most four plain-language blocks:
// review what is due, work the weakest active skill, use that skill in a
// phrase/song, then check it independently. Pure, no DOM, no AudioContext,
// no Date.now() -- callers supply `now` and pass in src/core/srs.js's own
// `due` function, exactly the way src/core/groove.js takes its clock from
// the caller. This module never imports srs.js itself, so a unit test can
// hand-build items and a stub `due` without pulling in the real forgetting
// model (though the real tests use the real one).
//
// `events` (src/core/learning-events.js records) is accepted but unused
// today: it is reserved for a later unit that adds a "retained on review"
// / "applied in a new phrase" block, which needs cross-event history this
// module does not otherwise touch (see learning-events.js's own comment on
// summarizeEvents).

// planSession({ instrumentId, level, activeIds, items, events, now, due })
// -> ordered array of up to four blocks:
//   { kind: 'review', ids }            -- SRS-due ids among ones already seen
//   { kind: 'weak', id, why }          -- the active id needing the most work
//   { kind: 'apply', skill }           -- that same id, marked for use in a phrase/song
//   { kind: 'check', ids }             -- review ids + the weak id, no hints
// `items` is S.item-shaped: a map of id -> { stability, difficulty, lastSeen,
// reps, lapses }. `instrumentId`/`level` are accepted for the caller's own
// bookkeeping/future song lookups; this module does not read them.
export function planSession({ instrumentId, level, activeIds, items, events = [], now, due } = {}) {
  const ids = Array.isArray(activeIds) ? activeIds : [];
  const itemsMap = items || {};
  const blocks = [];

  // Review: only ids this learner has actually been shown before -- an id
  // with no item record yet has never been reviewed, so it cannot be "due".
  const seen = ids.filter(id => itemsMap[id]).map(id => Object.assign({ id }, itemsMap[id]));
  const dueScored = typeof due === 'function' ? due(seen, now) : [];
  const dueIds = dueScored.filter(e => e.overdue).map(e => e.id);
  if (dueIds.length) blocks.push({ kind: 'review', ids: dueIds });

  // Weak: score every active id (an id with no item record yet reads as
  // perfectly retrievable, so it never wins this unless everything ties).
  // An id that has lapsed before is stronger evidence of a real weak spot
  // than one merely low on retrievability with a clean record, so a lapsed
  // id always wins when one exists; `due()` already sorts ascending by
  // retrievability, so its first match is the most-forgotten of the pool.
  let weak = null;
  if (ids.length && typeof due === 'function') {
    const allScored = due(ids.map(id => Object.assign({ id }, itemsMap[id])), now);
    const lapsed = allScored.filter(e => itemsMap[e.id] && itemsMap[e.id].lapses > 0);
    const pool = lapsed.length ? lapsed : allScored;
    const pick = pool[0];
    if (pick) {
      const hasLapsed = !!(itemsMap[pick.id] && itemsMap[pick.id].lapses > 0);
      weak = { id: pick.id, why: hasLapsed ? 'slipped before, worth another pass' : 'the one practiced least so far' };
    }
  }

  if (weak) {
    blocks.push({ kind: 'weak', id: weak.id, why: weak.why });
    blocks.push({ kind: 'apply', skill: weak.id });
    const checkIds = dueIds.indexOf(weak.id) >= 0 ? dueIds.slice() : dueIds.concat([weak.id]);
    blocks.push({ kind: 'check', ids: checkIds });
  }

  return blocks;
}

// describePlan(blocks, nameOf) -> one plain sentence for the coach line, e.g.
// "Today: 3 to review, then G4, then use it in a phrase, then a check."
// Reads whatever blocks planSession produced; never recomputes anything.
// `nameOf(id) -> string` names the weak block's id in plain words (e.g. the
// app passes `id => inf(id).short`, turning a raw id like 'n67' into 'G4');
// defaults to the identity function so a caller that does not pass one gets
// today's behaviour unchanged.
export function describePlan(blocks, nameOf) {
  const list = Array.isArray(blocks) ? blocks : [];
  const name = typeof nameOf === 'function' ? nameOf : (id => String(id));
  const review = list.find(b => b.kind === 'review');
  const weak = list.find(b => b.kind === 'weak');
  const apply = list.find(b => b.kind === 'apply');
  const check = list.find(b => b.kind === 'check');
  const parts = [];
  if (review) parts.push(review.ids.length + ' to review');
  if (weak) parts.push(name(weak.id));
  if (apply) parts.push('use it in a phrase');
  if (check) parts.push('a check');
  if (!parts.length) return 'Today: nothing new due -- free practice.';
  return 'Today: ' + parts.join(', then ') + '.';
}

// nextPlanStep(blocks, progress) -> { kind, ids, blind } | null
// Pure cursor over the ordered blocks planSession produced: `progress` is
// the caller's own tally of how many tasks each block kind has already
// served (`{ review, weak, apply, check }`, any missing key reads as 0).
// Each block kind has a small fixed budget of tasks before the plan moves
// on to the next one -- review and check each serve one task per id in
// their `ids` (so every id gets its own turn), weak repeats its single id
// three times running, apply gets two goes at using it in a phrase. A block
// the current plan never produced (e.g. no review due) is skipped outright.
// Returns null once every block present has used up its budget, which is
// the caller's cue to fall back to today's ordinary level chooser.
const PLAN_ORDER = ['review', 'weak', 'apply', 'check'];
const PLAN_BUDGET = { review: b => b.ids.length, weak: () => 3, apply: () => 2, check: b => b.ids.length };
export function nextPlanStep(blocks, progress) {
  const list = Array.isArray(blocks) ? blocks : [];
  const p = progress || {};
  for (let i = 0; i < PLAN_ORDER.length; i++) {
    const kind = PLAN_ORDER[i];
    const block = list.find(b => b.kind === kind);
    if (!block) continue;
    const budget = PLAN_BUDGET[kind](block), done = p[kind] || 0;
    if (done >= budget) continue;
    const ids = kind === 'review' ? block.ids.slice() : kind === 'weak' ? [block.id] : kind === 'apply' ? [block.skill] : block.ids.slice();
    return { kind: kind, ids: ids, blind: kind === 'check' };
  }
  return null;
}
