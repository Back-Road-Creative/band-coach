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
// source, song/part, tempo, input, assistance, active time, and -- when the
// caller knows them -- which hand(s) played it and which content revision it
// was judged against) to explain it in plain language later.

export const EVENT_VERSION = 1;

const SOURCES = ['drill', 'warmup', 'song', 'ear', 'theory'];
const ASSISTANCE = ['none', 'shown', 'approximate', 'guided'];
const DIM_VALUES = ['ok', 'miss', 'unassessed'];
const HANDS = ['left', 'right', 'both'];
const CONTENT_REV_MAX_LEN = 64;

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
  if (ev.hands !== undefined) req(HANDS.indexOf(ev.hands) >= 0, 'hands must be one of ' + HANDS.join(', '));
  if (ev.contentRev !== undefined) req(typeof ev.contentRev === 'string' && ev.contentRev.length > 0 && ev.contentRev.length <= CONTENT_REV_MAX_LEN, 'contentRev must be a non-empty string of at most ' + CONTENT_REV_MAX_LEN + ' characters');
  return { ok: errors.length === 0, errors: errors };
}

// RETAIN_GAP_MS: how long after an earlier independent-ok attempt a later
// independent-ok attempt on the same skill/instrument counts as evidence the
// skill was *retained*, not just repeated in the same sitting. 20h clears a
// same-day repeat while still catching a "yesterday and today" practice
// rhythm; a caller can override it per summarizeEvents call.
export const RETAIN_GAP_MS = 20 * 3600 * 1000;

// summarizeEvents(events, { instrument?, skill?, retainGapMs?, skillMap?,
// skillMapInstrument? }) -> counts
// per one of the plan's understandable states (6.4 lists five):
//   - withHelp: assistance was not 'none' (a Show me / guided / approximate
//     attempt -- practice happened, but it is not independent evidence).
//   - independent: no assistance, every dimension this event DID assess came
//     back 'ok' (an unassessed dimension does not count against it -- it was
//     never judged, not judged wrong), and, for a `kbd` row, `input` is
//     either absent or 'midi' -- a keyboard attempt made over a non-MIDI
//     route (computer-key, mixed) is practice, not proof.
//   - introduced: everything else -- no assistance, but either at least one
//     assessed dimension came back 'miss', or (for `kbd`) the attempt was
//     made over a non-MIDI route regardless of how its dims came back --
//     first contact, still-shaky attempts, and non-MIDI keyboard practice.
//   - retained: an independent-ok attempt that lands at least retainGapMs
//     (default RETAIN_GAP_MS) after an earlier independent-ok attempt on the
//     same instrument+skill -- evidence the skill survived a break, not
//     just a lucky second try in the same sitting.
//   - applied: an independent-ok attempt whose source is 'song' or whose
//     songId is set, landing after an earlier independent-ok attempt on the
//     same instrument+skill from a non-song source -- evidence the skill
//     transferred out of drilling into real playing. A given songId counts
//     at most once per instrument+skill group -- replaying the same song
//     over and over is not new evidence of transfer, only a song event with
//     no songId (songId is optional on validateEvent) is counted every time,
//     same as before, since there is no identity to dedupe it against.
//     `skillMap` (songId -> array of drill skill ids) is a second, optional
//     bridge for the common case where a song event's OWN skill never shares
//     an instrument|skill group with the drill skills it actually uses (e.g.
//     a keyboard drill logs 'n64' while a song step logs 'phrase-slow:0') --
//     see src/instruments/kbd-songs.js's KBD_SONG_SKILL_MAP for the
//     keyboard's own map. An event only takes this path when it is counted,
//     independent-ok, song-sourced, NOT already counted by the rule above,
//     its songId has a skillMap entry, `skillMapInstrument` is undefined or
//     matches ev.instrument, and ev.dims.pitch is 'ok' (mapped skills are
//     note identities, so a step that never checked pitch -- a rhythm-only
//     pass -- is not evidence the note transferred). It then credits applied
//     at most once if any mapped skill has an instrument|skill group whose
//     earliestNonSongOkAt is set and earlier than this event -- reusing the
//     same groups the rule above builds, never creating one for a skill that
//     was never drilled. Dedupe is by instrument+songId (separate from the
//     rule above's per-group appliedSongIds), so a song credited through the
//     map counts at most once no matter how many of its steps or replays
//     qualify. The instrument/skill filters (`instrument`/`skill` above)
//     still apply only to the song event's own skill -- `skill: 'n64'` does
//     not pull song rows into the count through this bridge.
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
// A `kbd` row whose `input` names a route other than 'midi' (e.g.
// 'computer-key', 'screen' -- an on-screen song tap or drill answer, or
// 'mixed', a take assembled from more than one route) is never
// independent-ok either, however its dims came back: a keyboard attempt made
// without a real MIDI keyboard is practice, not proof the skill transferred
// to the instrument. A row with no `input` field at all (legacy rows, and
// drill/song rows recorded before input was tagged) keeps its existing
// meaning.
export function isIndependentOk(ev) {
  const withHelp = !!(ev.assistance && ev.assistance !== 'none');
  if (ev.instrument === 'kbd' && typeof ev.input === 'string' && ev.input !== 'midi') return false;
  const dims = ev.dims || {};
  const assessed = Object.keys(dims).filter((k) => dims[k] !== 'unassessed');
  return !withHelp && assessed.length > 0 && assessed.every((k) => dims[k] === 'ok');
}

export function summarizeEvents(events, { instrument, skill, retainGapMs, skillMap, skillMapInstrument } = {}) {
  const gapMs = isFiniteNumber(retainGapMs) ? retainGapMs : RETAIN_GAP_MS;
  const out = { introduced: 0, withHelp: 0, independent: 0, retained: 0, applied: 0 };
  const sorted = (events || []).filter((ev) => ev && typeof ev === 'object').slice().sort((a, b) => a.at - b.at);
  const groups = new Map(); // instrument|skill -> { earliestOkAt, earliestNonSongOkAt, appliedSongIds }
  const mappedSongIds = new Set(); // 'instrument|songId' already credited through skillMap -- see the doc comment above
  sorted.forEach((ev) => {
    const key = ev.instrument + '\u0001' + ev.skill;
    let g = groups.get(key);
    if (!g) { g = { earliestOkAt: null, earliestNonSongOkAt: null, appliedSongIds: new Set() }; groups.set(key, g); }
    const matches = (instrument === undefined || ev.instrument === instrument) && (skill === undefined || ev.skill === skill);
    const withHelp = !!(ev.assistance && ev.assistance !== 'none');
    const independentOk = isIndependentOk(ev);
    if (matches) {
      if (withHelp) out.withHelp++;
      else if (independentOk) {
        out.independent++;
        if (g.earliestOkAt !== null && (ev.at - g.earliestOkAt) >= gapMs) out.retained++;
        const songSourced = ev.source === 'song' || !!ev.songId;
        let alreadyApplied = false;
        if (songSourced && g.earliestNonSongOkAt !== null && ev.at > g.earliestNonSongOkAt) {
          // A songId already credited for this instrument+skill does not count
          // again -- replaying the same song is not new transfer evidence. An
          // event with no songId at all has no identity to dedupe against, so
          // it is (as before) counted every time it qualifies.
          if (!ev.songId || !g.appliedSongIds.has(ev.songId)) {
            out.applied++;
            alreadyApplied = true;
            if (ev.songId) g.appliedSongIds.add(ev.songId);
          }
        }
        // skillMap bridge (see doc comment above): only when the native rule
        // above did not already credit this event, songSourced with a mapped
        // songId, the instrument filter (if any) matches, and this event's
        // own pitch dimension was checked ok.
        if (!alreadyApplied && songSourced && ev.songId && skillMap && Array.isArray(skillMap[ev.songId])
          && (skillMapInstrument === undefined || ev.instrument === skillMapInstrument)
          && ev.dims && ev.dims.pitch === 'ok') {
          const dedupeKey = ev.instrument + '|' + ev.songId;
          if (!mappedSongIds.has(dedupeKey)) {
            const credited = skillMap[ev.songId].some((s) => {
              const mg = groups.get(ev.instrument + '\u0001' + s);
              return mg && mg.earliestNonSongOkAt !== null && ev.at > mg.earliestNonSongOkAt;
            });
            if (credited) { out.applied++; mappedSongIds.add(dedupeKey); }
          }
        }
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
// top of the window, shared between per-instrument|skill anchors and the
// per-(instrument|skill, songId) anchors described below -- so it now covers
// far more (skill, song) pairs than a beginner curriculum activates, not
// only distinct skills. Worst case size: 500 window rows + 200 anchor rows =
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
// its earliest independent-ok row (the "group anchors": earliest-ok and
// earliest-non-song-ok) and -- since summarizeEvents also credits `applied`
// at most once per distinct songId -- the earliest QUALIFYING independent-ok
// row for each songId seen in that group (a "song anchor"): qualifying means
// it lands after that group's earliest non-song-ok row (in the window OR
// among the dropped rows, whichever is earlier), the same test summarizeEvents
// itself applies, since the row that actually counted toward `applied` is not
// always a song's very first play -- a song played once before any drilling
// and replayed after only earns credit on the replay. Any of these is kept
// only when the window does not already hold an equal-or-earlier qualifying
// row of that same kind for that group (no point keeping a stale anchor the
// window already proves).
//
// Group anchors and song anchors share the `anchorMax` budget, but group
// anchors are kept FIRST: a song anchor only ever matters if its group's
// earliest non-song-ok row is also present in the result (in the window or
// kept as a group anchor) -- without it the song row can never be counted as
// applied anyway, so spending budget on it would waste a slot a group anchor
// could have used instead. If more group anchors survive than fit in
// `anchorMax`, only the ones with the latest `at` are kept (oldest evidence
// lost first); any remaining budget is then filled by song anchors, again
// latest `at` first, and a song anchor whose group's non-song-ok row did not
// survive (neither in the window nor kept as a group anchor) is dropped
// outright rather than spend budget on a row that can no longer count for
// anything. The result never mutates its input: anchors first (group
// anchors, then song anchors, both in their original order), then the
// window.
export function boundEvents(events, { max = EVENT_HISTORY_MAX, anchorMax = EVENT_ANCHOR_MAX } = {}) {
  const list = Array.isArray(events) ? events : [];
  const window = list.slice(-max);
  const dropped = list.slice(0, Math.max(0, list.length - max));
  if (dropped.length === 0) return window;

  const groupKey = (ev) => ev.instrument + '\u0001' + ev.skill;
  const isSongSourced = (ev) => ev.source === 'song' || !!ev.songId;

  const songKey = (ev) => groupKey(ev) + '\u0001' + ev.songId;

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

  // groupNonSongOkAt: the earliest non-song-ok `at` for a group ACROSS THE
  // WHOLE LIST (window or dropped, whichever is earlier) -- this is what
  // summarizeEvents actually compares a song row's `at` against to decide
  // whether it counts as applied, so it is also what decides which song row
  // is worth anchoring: the one that comes after it, not simply the
  // earliest-ever play of that song (which may predate any drilling and so
  // never counted toward applied at all).
  const groupNonSongOkAt = new Map();
  const setGroupNonSongOkAt = (key, at) => { if (!groupNonSongOkAt.has(key) || at < groupNonSongOkAt.get(key)) groupNonSongOkAt.set(key, at); };
  windowNonSongOkAt.forEach((at, key) => setGroupNonSongOkAt(key, at));
  droppedEarliestNonSongOk.forEach((row, key) => setGroupNonSongOkAt(key, row.at));

  const qualifies = (ev) => {
    const at = groupNonSongOkAt.get(groupKey(ev));
    return at !== undefined && ev.at > at;
  };

  const windowSongOkAt = new Map(); // group|songId -> earliest `at` of a QUALIFYING independent-ok row for that songId already in the window
  window.forEach((ev) => {
    if (!isIndependentOk(ev) || !ev.songId || !qualifies(ev)) return;
    const sKey = songKey(ev);
    if (!windowSongOkAt.has(sKey) || ev.at < windowSongOkAt.get(sKey)) windowSongOkAt.set(sKey, ev.at);
  });

  const droppedEarliestSongOk = new Map(); // group|songId -> the earliest QUALIFYING independent-ok row for that songId among the dropped rows
  dropped.forEach((ev) => {
    if (!isIndependentOk(ev) || !ev.songId || !qualifies(ev)) return;
    const sKey = songKey(ev);
    const curSong = droppedEarliestSongOk.get(sKey);
    if (!curSong || ev.at < curSong.at) droppedEarliestSongOk.set(sKey, ev);
  });

  // Per-group anchors (earliest-ok, earliest-non-song-ok) are what give a
  // per-song anchor its meaning at all: a song row only counts as applied
  // when a group's earliest non-song-ok row is ALSO present in the trimmed
  // result. So they are kept first, ahead of per-song anchors, out of the
  // shared anchorMax budget -- see EVENT_ANCHOR_MAX above.
  const groupAnchorSeen = new Set();
  const groupAnchors = [];
  const considerGroupAnchor = (row) => { if (row && !groupAnchorSeen.has(row)) { groupAnchorSeen.add(row); groupAnchors.push(row); } };
  droppedEarliestOk.forEach((row, key) => {
    const coveredByWindow = windowOkAt.has(key) && windowOkAt.get(key) <= row.at;
    if (!coveredByWindow) considerGroupAnchor(row);
  });
  const nonSongAnchorKey = new Set(); // group keys whose non-song anchor row was kept (dropped, not covered by window)
  droppedEarliestNonSongOk.forEach((row, key) => {
    const coveredByWindow = windowNonSongOkAt.has(key) && windowNonSongOkAt.get(key) <= row.at;
    if (!coveredByWindow) { considerGroupAnchor(row); nonSongAnchorKey.add(key); }
  });

  const originalIndex = new Map();
  dropped.forEach((ev, i) => originalIndex.set(ev, i));
  groupAnchors.sort((a, b) => originalIndex.get(a) - originalIndex.get(b));

  let keptGroupAnchors = groupAnchors;
  if (keptGroupAnchors.length > anchorMax) {
    const latestFirst = keptGroupAnchors.slice().sort((a, b) => b.at - a.at).slice(0, anchorMax);
    const keepSet = new Set(latestFirst);
    keptGroupAnchors = keptGroupAnchors.filter((row) => keepSet.has(row));
  }
  const keptGroupAnchorSet = new Set(keptGroupAnchors);

  const songAnchorCandidates = [];
  droppedEarliestSongOk.forEach((row, sKey) => {
    const coveredByWindow = windowSongOkAt.has(sKey) && windowSongOkAt.get(sKey) <= row.at;
    if (coveredByWindow) return;
    const key = groupKey(row);
    // Without its group's non-song evidence surviving too, this song anchor
    // cannot ever count toward `applied` -- keeping it would spend shared
    // budget for nothing, at the expense of an anchor that could.
    if (!windowNonSongOkAt.has(key) && !(nonSongAnchorKey.has(key) && keptGroupAnchorSet.has(droppedEarliestNonSongOk.get(key)))) return;
    songAnchorCandidates.push(row);
  });
  songAnchorCandidates.sort((a, b) => originalIndex.get(a) - originalIndex.get(b));

  const remainingBudget = Math.max(0, anchorMax - keptGroupAnchors.length);
  let keptSongAnchors = songAnchorCandidates;
  if (keptSongAnchors.length > remainingBudget) {
    const latestFirst = keptSongAnchors.slice().sort((a, b) => b.at - a.at).slice(0, remainingBudget);
    const keepSet = new Set(latestFirst);
    keptSongAnchors = keptSongAnchors.filter((row) => keepSet.has(row));
  }

  const kept = keptGroupAnchors.concat(keptSongAnchors).sort((a, b) => originalIndex.get(a) - originalIndex.get(b));

  return kept.concat(window);
}
