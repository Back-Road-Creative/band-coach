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

// The one written-pitch rule for every instrument on the page: written =
// sounding - transposition, plus an extra octave for the fretted
// instruments notated an octave above where they sound (gtr, bass;
// writtenOctaveUp on the record). Guitar/bass have transposition 0 (their
// note NAMES read the same as sounding, only the octave differs), so this
// is additive, not a second transposition scheme.
export function writtenMidi(instrument, soundingMidi) {
  const transposition = instrument.transposition || 0;
  return soundingMidi - transposition + (instrument.writtenOctaveUp ? 12 : 0);
}

// The key this instrument's part should be notated in, given the song's
// (sounding) key -- same tonic shift writtenPart already applied inline.
// Octave-only shifts (writtenOctaveUp) never change a key's name.
export function writtenKeyName(instrument, songKey) {
  const transposition = instrument.transposition || 0;
  return keyByTonicMode(mod12(songKey.tonic - transposition), songKey.mode).name;
}

// Semitone distance from sounding to written pitch (writtenMidi(instrument,
// 0) - 0), given a name a learner can read. Only the intervals this app's
// instruments actually use are named; an instrument transposed by
// something else still gets a plain, if blunter, "N semitones" fallback
// rather than a wrong or missing word.
const INTERVAL_NAMES = {
  1: 'a semitone',
  2: 'a tone',
  3: 'a minor third',
  4: 'a major third',
  5: 'a fourth',
  6: 'a tritone',
  7: 'a fifth',
  8: 'a minor sixth',
  9: 'a sixth',
  10: 'a minor seventh',
  11: 'a major seventh',
  12: 'an octave',
  13: 'an octave and a semitone',
  14: 'a ninth',
};

function intervalName(semitones) {
  return INTERVAL_NAMES[semitones] || (semitones + ' semitones');
}

// Plain-words explanation of writtenMidi's shift for this instrument, or
// null when written and sounding pitch are the same (keyboard, and every
// other non-transposing, non-octave-shifted instrument).
export function writtenNote(instrument) {
  const interval = writtenMidi(instrument, 0);
  if (interval === 0) return null;
  const direction = interval > 0 ? 'higher' : 'lower';
  return 'Written ' + intervalName(Math.abs(interval)) + ' ' + direction + ' than it sounds';
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
  const writtenNotes = notes.map(n => ({ ...n, written: writtenMidi(instrument, n.midi) }));
  const writtenKey = key
    ? keyByTonicMode(mod12(key.tonic - (instrument.transposition || 0)), key.mode)
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
