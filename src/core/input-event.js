// One input-event envelope, shared by every capture path (a MIDI message, a
// microphone pitch-detector frame, a computer-key press standing in for a
// MIDI note, or a plain rhythm tap) so a later judging/scoring reader never
// has to special-case where a note came from. Additive only: this module
// does not touch judge.js, assessed.js, practice.js or app.js -- wiring an
// actual capture path through it is a later unit.
//
// Pure: no DOM, no AudioContext, no Date.now() -- exactly like
// src/core/learning-events.js and src/core/groove.js, the caller owns the
// clock (src/core/timing.js's toAudioTime already converts a raw DOM/MIDI
// timestamp to AudioContext seconds before it ever reaches here).

export const INPUT_SOURCES = ['midi', 'mic', 'key', 'tap'];

function isFiniteNumber(x) {
  return typeof x === 'number' && isFinite(x);
}

// makeInputEvent(fields): fills in the envelope defaults around the
// caller's fields, never inventing a value that changes what the event
// means -- `confidence` defaults to null (unknown), never to 1 (certain),
// because a source that never measured its own confidence must not read as
// a confident one.
export function makeInputEvent(fields) {
  return Object.assign({
    source: undefined,
    port: null,
    channel: null,
    pitch: null,
    onsetSec: undefined,
    releaseSec: null,
    clock: 'audio',
    confidence: null,
    demo: false,
  }, fields);
}

// validateInputEvent(ev) -> { ok, errors }: never throws, same contract as
// learning-events.js's validateEvent, so a caller can drop a malformed
// event instead of crashing.
export function validateInputEvent(ev) {
  const errors = [];
  const req = (cond, msg) => { if (!cond) errors.push(msg); };
  if (!ev || typeof ev !== 'object') return { ok: false, errors: ['not an object'] };
  req(INPUT_SOURCES.indexOf(ev.source) >= 0, 'source must be one of ' + INPUT_SOURCES.join(', '));
  req(ev.clock === 'audio', "clock must be 'audio' -- the app clock, never perf/wall time");
  req(isFiniteNumber(ev.onsetSec), 'onsetSec must be a finite number');
  req(ev.releaseSec === null || isFiniteNumber(ev.releaseSec), 'releaseSec must be a finite number or null (still held)');
  req(ev.pitch === null || isFiniteNumber(ev.pitch), 'pitch must be a finite MIDI note number or null');
  req(ev.confidence === null || (isFiniteNumber(ev.confidence) && ev.confidence >= 0 && ev.confidence <= 1), 'confidence must be a number between 0 and 1, or null (unknown)');
  req(typeof ev.demo === 'boolean', 'demo must be a boolean');
  return { ok: errors.length === 0, errors: errors };
}

// Which learning-event dims (src/ui/songs/assessed.js's dims: pitch, onset,
// hold, tune, drum -- same names here, plus 'chord', for a dimension no
// current record's `assess` can prove yet) each capability.js `assess`
// value can actually prove. 'midi' never proves 'tune': a MIDI note number
// is always in tune (assessed.js: "keyboards are always in tune"). 'mic-single-note' is a monophonic pitch
// detector: it can hear one note's pitch/onset/hold/tune, but never which
// simultaneous notes make a chord, and never tell one drum from another.
// 'tap' has no pitch detection at all -- it proves rhythm only. 'none'
// proves nothing. This is the ONLY place that decides what a capability can
// prove; a future judge/assessed rewrite reads it from here instead of
// re-deriving it.
const DIM_CAPABILITY = {
  none: [],
  tap: ['onset'],
  'mic-single-note': ['pitch', 'onset', 'hold', 'tune'],
  midi: ['pitch', 'chord', 'onset', 'hold', 'drum'],
};

// provableDims(assess) -> the DIM_CAPABILITY row for that capability.js
// `assess` value, or [] for an unrecognized one -- the one place outside
// this module that needs "what can this capability ever prove" without
// running actual events through evidenceFor (src/ui/songs/assessed.js's
// dimsFromStep: a step's passRule can only grade what the capability can
// prove, before any single try's events come into it).
export function provableDims(assess) {
  return (DIM_CAPABILITY[assess] || []).slice();
}

// evidenceFor(events, { assess, dims, nowSec, staleSec }) -> { eligible,
// unassessed }: which of `events` count as evidence at all (eligible), and
// which of the requested `dims` this capability can never prove regardless
// of the events (unassessed) -- never guessed from the events themselves,
// since a capability's ceiling does not change note to note.
//
// An event is excluded from `eligible` (never assumed innocent) when: it is
// the app's own demonstration audio (`demo`); its confidence is null
// (unknown -- no source ever gets the benefit of the doubt); or it is a
// still-held note (`releaseSec` null) whose `onsetSec` is older than
// `nowSec - staleSec` -- a note that has been sitting there so long the app
// can no longer trust it is the SAME attempt the learner is still making.
export function evidenceFor(events, { assess, dims, nowSec, staleSec } = {}) {
  const requested = Array.isArray(dims) ? dims : [];
  const capable = DIM_CAPABILITY[assess] || [];
  const unassessed = requested.filter((d) => capable.indexOf(d) < 0);
  if (!capable.length) return { eligible: [], unassessed: requested.slice() };
  const list = Array.isArray(events) ? events : [];
  const eligible = list.filter((ev) => {
    if (!ev || typeof ev !== 'object') return false;
    if (ev.demo) return false;
    if (ev.confidence === null || ev.confidence === undefined) return false;
    // A tap has no sustain to go stale -- it is a single instant, always
    // reported with releaseSec null, so only a note-like source (one that
    // can actually be held) is ever checked against the stale window.
    const canBeHeld = ev.source === 'midi' || ev.source === 'mic' || ev.source === 'key';
    const stillHeld = canBeHeld && (ev.releaseSec === null || ev.releaseSec === undefined);
    if (stillHeld && isFiniteNumber(ev.onsetSec) && isFiniteNumber(nowSec) && isFiniteNumber(staleSec) && ev.onsetSec < nowSec - staleSec) return false;
    return true;
  });
  return { eligible: eligible, unassessed: unassessed };
}
