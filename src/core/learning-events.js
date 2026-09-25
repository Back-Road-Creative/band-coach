// One versioned record of a single judged attempt -- a drill answer, a
// warm-up answer, or a judged song step -- kept in one place (plan 6.4) so
// every writer (app.js's built-in drills, src/ui/songs.js's lesson steps,
// and future ear/theory adapters) produces the same shape and every reader
// (a future progress UI, this module's own summarizeEvents) can trust it.
// No DOM, no AudioContext, no Date.now(): callers supply `now`/`id`, exactly
// like src/core/groove.js supplies its own clock.
//
// Raw audio is never part of this record -- only the judged outcome (which
// dimension was ok/miss/unassessed) and enough context (instrument, skill,
// source, song/part, tempo, input, assistance, active time) to explain it
// in plain language later.

export const EVENT_VERSION = 1;

const SOURCES = ['drill', 'warmup', 'song', 'ear', 'theory'];
const ASSISTANCE = ['none', 'shown', 'approximate', 'guided'];
const DIM_VALUES = ['ok', 'miss', 'unassessed'];

function isFiniteNumber(x) {
  return typeof x === 'number' && isFinite(x);
}

// makeEvent(fields, { now, id }): fills in the versioned envelope (v/id/at)
// around the caller's fields. `id` is a caller-supplied string (e.g. a
// counter this session has been keeping) so no crypto.randomUUID/uuid
// dependency is needed; if omitted, `id` falls back to `<at>:<n>` where `n`
// is a per-call counter local to this module (unique within a page load,
// which is all a client-only log needs -- it is never merged across
// clients).
let fallbackCounter = 0;
export function makeEvent(fields, { now, id } = {}) {
  const at = isFiniteNumber(now) ? now : Date.now();
  const eventId = typeof id === 'string' && id ? id : at + ':' + (fallbackCounter++);
  return Object.assign({ v: EVENT_VERSION, id: eventId, at: at }, fields);
}

// validateEvent(ev) -> { ok, errors }: never throws, so a caller (sanitizeDB
// loading a saved row, or a future importer) can drop a malformed row
// instead of crashing the whole load.
export function validateEvent(ev) {
  const errors = [];
  const req = (cond, msg) => { if (!cond) errors.push(msg); };
  if (!ev || typeof ev !== 'object') return { ok: false, errors: ['not an object'] };
  req(ev.v === EVENT_VERSION, 'v must equal EVENT_VERSION');
  req(typeof ev.id === 'string' && ev.id.length > 0, 'id must be a non-empty string');
  req(isFiniteNumber(ev.at), 'at must be a finite number');
  req(typeof ev.instrument === 'string' && ev.instrument.length > 0, 'instrument must be a non-empty string');
  req(typeof ev.skill === 'string' && ev.skill.length > 0, 'skill must be a non-empty string');
  req(SOURCES.indexOf(ev.source) >= 0, 'source must be one of ' + SOURCES.join(', '));
  req(ASSISTANCE.indexOf(ev.assistance) >= 0, 'assistance must be one of ' + ASSISTANCE.join(', '));
  req(ev.dims && typeof ev.dims === 'object' && !Array.isArray(ev.dims), 'dims must be an object');
  if (ev.dims && typeof ev.dims === 'object') {
    Object.keys(ev.dims).forEach((k) => { if (DIM_VALUES.indexOf(ev.dims[k]) < 0) errors.push('dims.' + k + ' must be one of ' + DIM_VALUES.join(', ')); });
  }
  req(Array.isArray(ev.unassessed) && ev.unassessed.every((x) => typeof x === 'string'), 'unassessed must be an array of strings');
  req(isFiniteNumber(ev.activeMs) && ev.activeMs >= 0, 'activeMs must be a finite number >= 0');
  if (ev.songId !== undefined) req(typeof ev.songId === 'string', 'songId must be a string');
  if (ev.partId !== undefined) req(typeof ev.partId === 'string', 'partId must be a string');
  if (ev.arrangementRev !== undefined) req(typeof ev.arrangementRev === 'string', 'arrangementRev must be a string');
  if (ev.bpmTarget !== undefined) req(ev.bpmTarget === null || isFiniteNumber(ev.bpmTarget), 'bpmTarget must be a number or null');
  if (ev.bpmActual !== undefined) req(ev.bpmActual === null || isFiniteNumber(ev.bpmActual), 'bpmActual must be a number or null');
  if (ev.input !== undefined) req(typeof ev.input === 'string', 'input must be a string');
  return { ok: errors.length === 0, errors: errors };
}

// RETAIN_GAP_MS: how long after an earlier independent-ok attempt a later
// independent-ok attempt on the same skill/instrument counts as evidence the
// skill was *retained*, not just repeated in the same sitting. 20h clears a
// same-day repeat while still catching a "yesterday and today" practice
// rhythm; a caller can override it per summarizeEvents call.
export const RETAIN_GAP_MS = 20 * 3600 * 1000;

// summarizeEvents(events, { instrument?, skill?, retainGapMs? }) -> counts
// per one of the plan's understandable states (6.4 lists five):
//   - withHelp: assistance was not 'none' (a Show me / guided / approximate
//     attempt -- practice happened, but it is not independent evidence).
//   - independent: no assistance, and every dimension this event DID assess
//     came back 'ok' (an unassessed dimension does not count against it --
//     it was never judged, not judged wrong).
//   - introduced: everything else (no assistance, but at least one assessed
//     dimension came back 'miss') -- first contact or still-shaky attempts.
//   - retained: an independent-ok attempt that lands at least retainGapMs
//     (default RETAIN_GAP_MS) after an earlier independent-ok attempt on the
//     same instrument+skill -- evidence the skill survived a break, not
//     just a lucky second try in the same sitting.
//   - applied: an independent-ok attempt whose source is 'song' or whose
//     songId is set, landing after an earlier independent-ok attempt on the
//     same instrument+skill from a non-song source -- evidence the skill
//     transferred out of drilling into real playing.
// retained and applied are refinements of independent, not separate buckets
// -- every event counted as either is also counted in independent, so the
// five numbers do not sum to the event count. History is built from ALL
// events regardless of the instrument/skill filter (a filter narrows what
// gets counted, never what counts as "earlier"), and events are walked in
// `at` order regardless of array order -- a copy is sorted, the caller's
// array is never touched.
// isIndependentOk(ev): no assistance, and every dimension this event DID
// assess came back 'ok' (an unassessed dimension does not count against it,
// and an event that assessed nothing is not evidence of anything). This is
// the same test summarizeEvents uses internally, pulled out because
// boundEvents (below) needs it too, to find the rows worth keeping as
// anchors past the plain size cut.
export function isIndependentOk(ev) {
  const withHelp = !!(ev.assistance && ev.assistance !== 'none');
  const dims = ev.dims || {};
  const assessed = Object.keys(dims).filter((k) => dims[k] !== 'unassessed');
  return !withHelp && assessed.length > 0 && assessed.every((k) => dims[k] === 'ok');
}

export function summarizeEvents(events, { instrument, skill, retainGapMs } = {}) {
  const gapMs = isFiniteNumber(retainGapMs) ? retainGapMs : RETAIN_GAP_MS;
  const out = { introduced: 0, withHelp: 0, independent: 0, retained: 0, applied: 0 };
  const sorted = (events || []).filter((ev) => ev && typeof ev === 'object').slice().sort((a, b) => a.at - b.at);
  const groups = new Map(); // instrument|skill -> { earliestOkAt, earliestNonSongOkAt }
  sorted.forEach((ev) => {
    const key = ev.instrument + '\u0001' + ev.skill;
    let g = groups.get(key);
    if (!g) { g = { earliestOkAt: null, earliestNonSongOkAt: null }; groups.set(key, g); }
    const matches = (instrument === undefined || ev.instrument === instrument) && (skill === undefined || ev.skill === skill);
    const withHelp = !!(ev.assistance && ev.assistance !== 'none');
    const independentOk = isIndependentOk(ev);
    if (matches) {
      if (withHelp) out.withHelp++;
      else if (independentOk) {
        out.independent++;
        if (g.earliestOkAt !== null && (ev.at - g.earliestOkAt) >= gapMs) out.retained++;
        const songSourced = ev.source === 'song' || !!ev.songId;
        if (songSourced && g.earliestNonSongOkAt !== null && ev.at > g.earliestNonSongOkAt) out.applied++;
      } else out.introduced++;
    }
    if (independentOk) {
      if (g.earliestOkAt === null || ev.at < g.earliestOkAt) g.earliestOkAt = ev.at;
      if (ev.source !== 'song' && (g.earliestNonSongOkAt === null || ev.at < g.earliestNonSongOkAt)) g.earliestNonSongOkAt = ev.at;
    }
  });
  return out;
}

// EVENT_HISTORY_MAX: today's flat cap on DB.events (app.js used to
// `slice(-500)` in two places -- on load and on every append). At roughly
// 300 bytes/row (a typical drill row with a handful of dims) that alone is
// about 150 KB, well under localStorage's usual several-MB budget.
export const EVENT_HISTORY_MAX = 500;

// EVENT_ANCHOR_MAX: the most "anchor" rows (see boundEvents below) kept on
// top of the window. 200 covers far more distinct instrument|skill pairs
// than a beginner curriculum activates; only a learner who has played over
// 200 distinct skills, none of them in the last 500 rows, would ever lose
// the oldest anchor. Worst case size: 500 window rows + 200 anchor rows =
// 700 rows, about 210 KB at ~300 bytes/row -- still far below what
// localStorage allows.
export const EVENT_ANCHOR_MAX = 200;

// boundEvents(events, { max, anchorMax }) -> a NEW array, capped at `max`
// plus a handful of "anchor" rows. A flat `slice(-max)` (what app.js used to
// do) throws away exactly the rows summarizeEvents needs most: the FIRST
// time a skill was played independently-ok, and the first time that
// happened outside a song. Those two rows are what `retained` and `applied`
// (above) compare every later attempt against -- lose them and a skill that
// really was retained over weeks quietly stops counting as retained, only
// because the learner practised a lot in between.
//
// So boundEvents keeps the newest `max` rows exactly as `slice(-max)` did,
// then walks the OLDER, dropped rows and keeps, per instrument|skill group,
// its earliest independent-ok row and its earliest non-song independent-ok
// row -- but only when the window does not already hold an equal-or-earlier
// row of that same kind for that group (no point keeping a stale anchor the
// window already proves). When the same dropped row is the earliest for
// both kinds, it is kept once. If more anchors than `anchorMax` survive,
// only the ones with the latest `at` are kept, so a learner who has played
// far more than 200 distinct skills loses the oldest evidence first, not at
// random. The result never mutates its input: anchors first (in their
// original order), then the window.
export function boundEvents(events, { max = EVENT_HISTORY_MAX, anchorMax = EVENT_ANCHOR_MAX } = {}) {
  const list = Array.isArray(events) ? events : [];
  const window = list.slice(-max);
  const dropped = list.slice(0, Math.max(0, list.length - max));
  if (dropped.length === 0) return window;

  const groupKey = (ev) => ev.instrument + '\u0001' + ev.skill;
  const isSongSourced = (ev) => ev.source === 'song' || !!ev.songId;

  const windowOkAt = new Map(); // group -> earliest `at` of an independent-ok row already in the window
  const windowNonSongOkAt = new Map();
  window.forEach((ev) => {
    if (!isIndependentOk(ev)) return;
    const key = groupKey(ev);
    if (!windowOkAt.has(key) || ev.at < windowOkAt.get(key)) windowOkAt.set(key, ev.at);
    if (!isSongSourced(ev) && (!windowNonSongOkAt.has(key) || ev.at < windowNonSongOkAt.get(key))) windowNonSongOkAt.set(key, ev.at);
  });

  const droppedEarliestOk = new Map(); // group -> the earliest independent-ok row among the dropped rows
  const droppedEarliestNonSongOk = new Map();
  dropped.forEach((ev) => {
    if (!isIndependentOk(ev)) return;
    const key = groupKey(ev);
    const curOk = droppedEarliestOk.get(key);
    if (!curOk || ev.at < curOk.at) droppedEarliestOk.set(key, ev);
    if (!isSongSourced(ev)) {
      const curNonSong = droppedEarliestNonSongOk.get(key);
      if (!curNonSong || ev.at < curNonSong.at) droppedEarliestNonSongOk.set(key, ev);
    }
  });

  const anchorSeen = new Set();
  const anchors = [];
  const considerAnchor = (row) => { if (row && !anchorSeen.has(row)) { anchorSeen.add(row); anchors.push(row); } };
  droppedEarliestOk.forEach((row, key) => {
    const coveredByWindow = windowOkAt.has(key) && windowOkAt.get(key) <= row.at;
    if (!coveredByWindow) considerAnchor(row);
  });
  droppedEarliestNonSongOk.forEach((row, key) => {
    const coveredByWindow = windowNonSongOkAt.has(key) && windowNonSongOkAt.get(key) <= row.at;
    if (!coveredByWindow) considerAnchor(row);
  });

  const originalIndex = new Map();
  dropped.forEach((ev, i) => originalIndex.set(ev, i));
  anchors.sort((a, b) => originalIndex.get(a) - originalIndex.get(b));

  let kept = anchors;
  if (kept.length > anchorMax) {
    const latestFirst = kept.slice().sort((a, b) => b.at - a.at).slice(0, anchorMax);
    const keepSet = new Set(latestFirst);
    kept = kept.filter((row) => keepSet.has(row));
  }

  return kept.concat(window);
}
