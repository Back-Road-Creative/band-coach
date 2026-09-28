// Orders one practice sitting into up to five plain-language blocks:
// review what is due, work the weakest active skill, use that skill in a
// phrase/song, check it independently, and (keyboard only) a suggested
// starter song to play. Pure, no DOM, no AudioContext,
// no Date.now() -- callers supply `now` and pass in src/core/srs.js's own
// `due` function, exactly the way src/core/groove.js takes its clock from
// the caller. This module never imports srs.js itself, so a unit test can
// hand-build items and a stub `due` without pulling in the real forgetting
// model (though the real tests use the real one).

// planSession({ instrumentId, level, activeIds, items, now, due,
// sessions, songFor, today }) -> ordered array of up to five blocks:
//   { kind: 'review', ids }            -- SRS-due ids among ones already seen
//   { kind: 'weak', id, why }          -- the active id needing the most work
//   { kind: 'apply', skill }           -- that same id, marked for use in a phrase/song
//   { kind: 'check', ids }             -- review ids + the weak id, no hints
//   { kind: 'song', songId, title, done } -- a suggested starter song, always LAST
// `items` is S.item-shaped: a map of id -> { stability, difficulty, lastSeen,
// reps, lapses }. `instrumentId`/`level` are now read, but only to look up
// the song block: `songFor(level)` (optional; when it is not a function, or
// returns null/non-object, no song block is added) names {songId, title} for
// this level, and `done` is derived from `sessions` (optional, defaults to
// []) -- true when some row has `d === today`, `source === 'song'`,
// `songId` matching and `mod === instrumentId`. The song block is appended
// even when there is nothing else to plan (no weak/apply/check), so a
// fresh learner with no item records yet still sees it.
export function planSession({ instrumentId, level, activeIds, items, now, due, sessions, songFor, today } = {}) {
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
  // A learner who has never been shown ANY of this level's ids yet (no
  // item record at all in the pool) has no real weak spot to single out --
  // every id would tie on "never practiced", and due()'s alphabetical
  // tie-break would then pick whichever id merely sorts first, forcing a
  // task on it for no reason grounded in this learner's own history. Only
  // look for a weak id once at least one active id has actually been seen.
  let weak = null;
  if (ids.length && ids.some(id => itemsMap[id]) && typeof due === 'function') {
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

  if (typeof songFor === 'function') {
    const song = songFor(level);
    if (song && typeof song === 'object' && song.songId) {
      const rows = Array.isArray(sessions) ? sessions : [];
      const done = rows.some(r => r && r.d === today && r.source === 'song' && r.songId === song.songId && r.mod === instrumentId);
      blocks.push({ kind: 'song', songId: song.songId, title: song.title, done: done });
    }
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
  const song = list.find(b => b.kind === 'song');
  const parts = [];
  if (review) parts.push(review.ids.length + ' to review');
  if (weak) parts.push(name(weak.id));
  if (apply) parts.push('use it in a phrase');
  if (check) parts.push('a check');
  if (song) parts.push('play ' + song.title + (song.done ? ' (done today)' : ''));
  if (!parts.length) return 'Today: nothing new due -- free practice.';
  return 'Today: ' + parts.join(', then ') + '.';
}

// describeWhy(blocks, nameOf) -> a second, separate sentence naming the
// reason planSession recorded for the weak skill it picked (see the `weak`
// assignment above), e.g. "G4: slipped before, worth another pass." Returns
// '' when there is no weak block, or its why is missing/not a string, so a
// caller with nothing to say can simply skip appending it. Same argument
// handling as describePlan: a non-array blocks becomes [], nameOf defaults
// to the identity function. Plain English literals only -- never t(), which
// would pull in i18n.js.
export function describeWhy(blocks, nameOf) {
  const list = Array.isArray(blocks) ? blocks : [];
  const name = typeof nameOf === 'function' ? nameOf : (id => String(id));
  const weak = list.find(b => b.kind === 'weak');
  if (!weak || typeof weak.why !== 'string' || !weak.why) return '';
  return name(weak.id) + ': ' + weak.why + '.';
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
