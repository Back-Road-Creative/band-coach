// The keyboard pathway contract: given a learner's history plus the current
// live MIDI proof, what is the one next step to show, and what should the
// UI do about it? Pure -- no DOM, no Date.now(): caller supplies `now`,
// exactly like src/core/groove.js supplies its own clock. P1 covers the
// 'kbd' instrument/mod only; P2 wires this into a panel, P3 adds a
// 'complete' step past 'return', needing TWO pieces of evidence: a
// qualifying row played at least a day after the original check (retained
// -- any song), and a qualifying row on a DIFFERENT song than the original
// (transfer -- any time after the original). Either one landing alone
// keeps 'return' going, just with a different action (see pathwayState's
// comment below); only both together close it out.
//
// This assumes event `at` values are real epoch milliseconds throughout --
// a day-boundary comparison against a mixed clock (some rows in audio-clock
// seconds, e.g. an older src/ui/songs.js `at` before its own epoch-clock
// fix lands) would silently misjudge "a day later". No workaround for that
// lives here; it is a separate unit's job to guarantee the input, not this
// pure function's to detect a mismatched clock.

import { isIndependentOk } from './learning-events.js';

// DAY_MS: how long a passed check stays "recent" before the pathway asks
// for a recheck instead of just waiting -- one calendar day, same constant
// src/core/history.js and src/core/srs.js already use under this name.
export const DAY_MS = 24 * 3600 * 1000;

function asArray(x) { return Array.isArray(x) ? x : []; }
function isObj(x) { return !!x && typeof x === 'object'; }

// hasProof: live proof (midiProof === true, this page load) OR history proof
// (a kbd MIDI event ever logged) -- the history clause keeps a returning
// learner, whose live proof resets on every page load, from falling back to
// 'setup' just because MIDI has not spoken yet this visit.
function hasProof(events, midiProof) {
  if (midiProof === true) return true;
  return events.some((ev) => isObj(ev) && ev.instrument === 'kbd' && ev.input === 'midi');
}

// songTried: a kept sessions row (logSession, capped at 60 -- app.js's
// DB.sessions.slice(-60)) OR a kbd event with source 'song' -- the events
// clause covers a learner whose song session fell off the sessions cap but
// whose events log (capped far higher, EVENT_HISTORY_MAX) still has it.
function songTried(events, sessions) {
  if (sessions.some((row) => isObj(row) && row.mod === 'kbd' && row.source === 'song')) return true;
  return events.some((ev) => isObj(ev) && ev.instrument === 'kbd' && ev.source === 'song');
}

// qualifies(ev): the one row that proves the whole piece has been played
// independently, on a real MIDI keyboard, start to finish, with nothing
// unassessed marked wrong. ASSUMPTION (flagged in the PR body): this checks
// the whole-piece step (skill 'whole:null', src/song/lesson.js's `kind:
// 'whole', phraseIndex: null`), not any single phrase step -- a learner who
// nails every phrase but never plays the whole piece through has not yet
// satisfied this pathway's check.
function qualifies(ev) {
  return isObj(ev) && ev.instrument === 'kbd' && ev.source === 'song' && ev.input === 'midi'
    && ev.assistance === 'none' && ev.skill === 'whole:null' && isIndependentOk(ev);
}

// earliestCheckRow: the FIRST qualifying row ever logged, by `at` -- "the
// first independent song check", and the fixed anchor every rule below
// reads from. Its `at` is what dueAt is computed from, and stays fixed: a
// later qualifying row (on this same song or a different one) never moves
// it, only supplies further evidence. Returns null when none exists.
function earliestCheckRow(events) {
  let best = null;
  events.forEach((ev) => { if (qualifies(ev) && (!best || ev.at < best.at)) best = ev; });
  return best;
}

// earliestRetainedRow: the EARLIEST qualifying row (any songId, including
// the anchor's own) at or after `dueAt` -- real evidence the check still
// held up a day later, not just elapsed time with nothing played. A
// transfer-song row that happens to land at or after dueAt satisfies this
// too (one play can prove both retention and transfer at once); a same-song
// recheck before dueAt does not count yet.
function earliestRetainedRow(events, dueAt) {
  let best = null;
  events.forEach((ev) => { if (qualifies(ev) && ev.at >= dueAt && (!best || ev.at < best.at)) best = ev; });
  return best;
}

// latestTransferRow: the most recent qualifying row (same MIDI/no-assistance
// whole-piece rule as qualifies()) whose songId differs from the anchor
// check's -- proof the learner carried the same skill to a piece they were
// never drilled to pass, not just repeated the one they were checked on.
// Any qualifying row other than the anchor is necessarily at or after the
// anchor's `at` (the anchor is the earliest qualifying row overall), so no
// separate time check is needed here. A row with no songId at all (an
// older row logged before songId rode along on song sessions/events) never
// counts as a transfer -- there is nothing to compare it against.
function latestTransferRow(events, excludeSongId) {
  let best = null;
  events.forEach((ev) => { if (qualifies(ev) && typeof ev.songId === 'string' && ev.songId !== excludeSongId && (!best || ev.at > best.at)) best = ev; });
  return best;
}

// pathwayState({ events, sessions, midiProof, level, now }) -> { step,
// action, checkAt?, checkSongId?, retainedAt?, transferAt?, transferSongId?
// }. events/sessions tolerate undefined, empty, or non-object rows without
// throwing -- a caller loading a saved DB never gets to assume every row is
// well-formed.
export function pathwayState({ events, sessions, midiProof, level, now }) {
  const evs = asArray(events).filter(isObj);
  const rows = asArray(sessions);
  const anchor = earliestCheckRow(evs);
  if (anchor) {
    const dueAt = anchor.at + DAY_MS;
    const retainedRow = earliestRetainedRow(evs, dueAt);
    const transferRow = latestTransferRow(evs, anchor.songId);
    // 'complete' needs BOTH: a row proving retention (any song, at/after
    // dueAt) AND a row proving transfer (a different song, any time after
    // the anchor) -- one row can satisfy both at once, but elapsed time
    // alone, with nothing played, satisfies neither.
    if (retainedRow && transferRow) {
      return { step: 'complete', action: { kind: 'complete' }, checkAt: anchor.at, retainedAt: retainedRow.at, transferAt: transferRow.at, transferSongId: transferRow.songId };
    }
    if (now < dueAt) {
      return { step: 'return', action: { kind: 'wait', dueAt: dueAt }, checkAt: anchor.at, checkSongId: anchor.songId };
    }
    if (!retainedRow) {
      return { step: 'return', action: { kind: 'recheck' }, checkAt: anchor.at, checkSongId: anchor.songId };
    }
    // retainedRow exists but no transfer row yet -- do not offer the
    // same-song recheck again (that evidence is already in), offer the
    // transfer song instead.
    return { step: 'return', action: { kind: 'transfer' }, checkAt: anchor.at, checkSongId: anchor.songId, retainedAt: retainedRow.at };
  }
  if (!hasProof(evs, midiProof)) return { step: 'setup', action: { kind: 'connect-midi' } };
  if (level <= 1) return { step: 'lesson', action: { kind: 'trainer' } };
  if (!songTried(evs, rows)) return { step: 'song', action: { kind: 'open-song' } };
  return { step: 'check', action: { kind: 'check-song' } };
}
