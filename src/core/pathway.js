// The keyboard pathway contract: given a learner's history plus the current
// live MIDI proof, what is the one next step to show, and what should the
// UI do about it? Pure -- no DOM, no Date.now(): caller supplies `now`,
// exactly like src/core/groove.js supplies its own clock. P1 covers the
// 'kbd' instrument/mod only; P2 wires this into a panel, P3 adds a
// 'complete' step past 'return' -- a qualifying MIDI/no-assistance row on a
// DIFFERENT song (the transfer song) than the original check, once a full
// day has passed since that check (the same day 'return' already waits
// out).

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
// first independent song check" the transfer/retention rules below anchor
// to. Its songId is the one the recheck/transfer distinction is drawn
// against; a later qualifying row on that same song only refreshes the
// wait/recheck date (latestForSong below), it never starts a new anchor.
// Returns null when none exists.
function earliestCheckRow(events) {
  let best = null;
  events.forEach((ev) => { if (qualifies(ev) && (!best || ev.at < best.at)) best = ev; });
  return best;
}

// latestForSong: the most recent qualifying row whose songId matches
// `songId` (including a shared `undefined` for pre-songId rows) -- what
// 'return's own wait/recheck date tracks, so repeating the SAME song's
// check resets that date exactly as it always has.
function latestForSong(events, songId) {
  let best = null;
  events.forEach((ev) => { if (qualifies(ev) && ev.songId === songId && (!best || ev.at > best.at)) best = ev; });
  return best;
}

// latestTransferRow: the most recent qualifying row (same MIDI/no-assistance
// whole-piece rule as qualifies()) whose songId differs from the anchor
// check's -- proof the learner carried the same skill to a piece they were
// never drilled to pass, not just repeated the one they were checked on. A
// row with no songId at all (an older row logged before songId rode along
// on song sessions/events) never counts as a transfer -- there is nothing to
// compare it against.
function latestTransferRow(events, excludeSongId) {
  let best = null;
  events.forEach((ev) => { if (qualifies(ev) && typeof ev.songId === 'string' && ev.songId !== excludeSongId && (!best || ev.at > best.at)) best = ev; });
  return best;
}

// pathwayState({ events, sessions, midiProof, level, now }) -> { step,
// action, checkAt?, transferAt?, transferSongId? }. events/sessions
// tolerate undefined, empty, or non-object rows without throwing -- a
// caller loading a saved DB never gets to assume every row is well-formed.
export function pathwayState({ events, sessions, midiProof, level, now }) {
  const evs = asArray(events).filter(isObj);
  const rows = asArray(sessions);
  const anchor = earliestCheckRow(evs);
  if (anchor) {
    const checkRow = latestForSong(evs, anchor.songId) || anchor;
    const dueAt = checkRow.at + DAY_MS;
    const transferRow = latestTransferRow(evs, anchor.songId);
    // 'complete' needs BOTH pieces of evidence: a transfer-song row, AND a
    // full day since the original check (the same "recent" boundary
    // 'return' already uses for its own recheck) -- a transfer logged
    // within the first day still counts once the day passes, so this does
    // not require a THIRD row proving the original song was retained; the
    // day itself, with the original check still standing unchallenged, is
    // what 'return's own wait/recheck action already treats as the
    // retention boundary.
    if (transferRow && now >= dueAt) {
      return { step: 'complete', action: { kind: 'complete' }, checkAt: checkRow.at, transferAt: transferRow.at, transferSongId: transferRow.songId };
    }
    return now < dueAt
      ? { step: 'return', action: { kind: 'wait', dueAt: dueAt }, checkAt: checkRow.at, checkSongId: checkRow.songId }
      : { step: 'return', action: { kind: 'recheck' }, checkAt: checkRow.at, checkSongId: checkRow.songId };
  }
  if (!hasProof(evs, midiProof)) return { step: 'setup', action: { kind: 'connect-midi' } };
  if (level <= 1) return { step: 'lesson', action: { kind: 'trainer' } };
  if (!songTried(evs, rows)) return { step: 'song', action: { kind: 'open-song' } };
  return { step: 'check', action: { kind: 'check-song' } };
}
