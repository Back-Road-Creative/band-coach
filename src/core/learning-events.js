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
    const dims = ev.dims || {};
    const assessed = Object.keys(dims).filter((k) => dims[k] !== 'unassessed');
    const independentOk = !withHelp && assessed.length > 0 && assessed.every((k) => dims[k] === 'ok');
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
