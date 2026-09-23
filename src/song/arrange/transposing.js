// Written parts for transposing brass/woodwinds (plan §11.7, Wave D unit D3).
//
// Convention, confirmed against every src/instruments/*.js record with a
// non-zero `transposition` (see each file's own header comment) and against
// the existing src/app.js wiring (transposedMicRange, app.js:556-562):
// sounding pitch = written pitch + transposition, so written = sounding -
// transposition. Every note anywhere else in this app (Song notes, the
// judge, the mic/pitch detector, MIDI playback) is SOUNDING pitch -- this
// module is the only place "written" pitch is computed, purely to know what
// a learner reading notation would see on the page.
//
// Pure module: no DOM, no AudioContext. Caller passes plain note objects
// ({ start, dur, midi, ... }); nothing here mutates its input.

import { keyByTonicMode } from '../../core/theory/keys.js';

function mod12(n) {
  return ((n % 12) + 12) % 12;
}

// notes: [{ start, dur, midi, ... }] in SOUNDING pitch (the shared Song note
// shape). instrument: a src/instruments/*.js record. key: optional Song-shape
// { tonic, mode } (sounding); when given, the returned `key` is the written
// key this part should be notated in.
//
// Returns { notes, key }: `notes` is a NEW array, each note spread from the
// input with a `written` field added (sounding pitch is untouched, still on
// `midi`); `key` is null unless a `key` argument was passed.
export function writtenPart(notes, instrument, key) {
  const transposition = instrument.transposition || 0;
  const writtenNotes = notes.map(n => ({ ...n, written: n.midi - transposition }));
  const writtenKey = key
    ? keyByTonicMode(mod12(key.tonic - transposition), key.mode)
    : null;
  return { notes: writtenNotes, key: writtenKey };
}

// Inverse of writtenPart's pitch conversion: notes given in WRITTEN pitch
// (on `midi`, matching the shared note shape) -> notes in SOUNDING pitch.
// Used by anything that starts from notation (e.g. an editor typing written
// notes for a transposing instrument) and needs the real, mic/MIDI-audible
// pitch back out.
export function soundingFromWritten(writtenNotes, instrument) {
  const transposition = instrument.transposition || 0;
  return writtenNotes.map(n => ({ ...n, midi: n.midi + transposition }));
}
