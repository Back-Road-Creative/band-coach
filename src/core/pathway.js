// The keyboard pathway contract: given a learner's history plus the current
// live MIDI proof, what is the one next step to show, and what should the
// UI do about it? Pure -- no DOM, no Date.now(): caller supplies `now`,
// exactly like src/core/groove.js supplies its own clock. P1 covers the
// 'kbd' instrument/mod only; P2 wires this into a panel, P3 adds a
// 'complete' step past 'return'.

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

// latestCheckRow: the most recent qualifying row, by `at`. Returns null when
// none exists.
function latestCheckRow(events) {
  let best = null;
  events.forEach((ev) => { if (qualifies(ev) && (!best || ev.at > best.at)) best = ev; });
  return best;
}

// pathwayState({ events, sessions, midiProof, level, now }) -> { step,
// action, checkAt? }. events/sessions tolerate undefined, empty, or
// non-object rows without throwing -- a caller loading a saved DB never
// gets to assume every row is well-formed.
export function pathwayState({ events, sessions, midiProof, level, now }) {
  const evs = asArray(events).filter(isObj);
  const rows = asArray(sessions);
  const checkRow = latestCheckRow(evs);
  if (checkRow) {
    const dueAt = checkRow.at + DAY_MS;
    return now < dueAt
      ? { step: 'return', action: { kind: 'wait', dueAt: dueAt }, checkAt: checkRow.at }
      : { step: 'return', action: { kind: 'recheck' }, checkAt: checkRow.at };
  }
  if (!hasProof(evs, midiProof)) return { step: 'setup', action: { kind: 'connect-midi' } };
  if (level <= 1) return { step: 'lesson', action: { kind: 'trainer' } };
  if (!songTried(evs, rows)) return { step: 'song', action: { kind: 'open-song' } };
  return { step: 'check', action: { kind: 'check-song' } };
}
