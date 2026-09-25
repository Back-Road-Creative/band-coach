// One adapter connecting every instrument family's arranger (fretted.js,
// bowed.js, keys.js, harmonica.js, voice.js) to a single shape Songs can
// render without knowing which family it is talking to. Pure: no DOM, no
// AudioContext, caller owns the clock.
//
// Wiring-pass API:
//   arrangeFor(notes, instrument, setup, { songKey }) -> {
//     family, summary, capo, tuningName, shiftSemitones, newKeyName,
//     harpAdvice, placements, unplayable
//   }
//   notes: a flat array of { start, dur, midi } (a Song part's notes,
//   already run through src/song/lesson.js's fitToInstrument). instrument: a
//   src/instruments/*.js record. setup: src/ui/fingerings/setup.js's
//   instrumentSetup() shape ({ capo, tuning, tuningMidi, harpKey,
//   voiceRange }), or {} for none saved. songKey: optional Song-shape
//   { tonic, mode }, the song's SOUNDING key -- used only to name the
//   written key (wind/brass) or the moved key (voice).
//
//   `placements` is a Map(noteIndex -> per-family shape), noteIndex being
//   the note's position in the input `notes` array so a caller can zip the
//   result back onto notes/steps the same way fretted.js/bowed.js/keys.js
//   already do:
//     fretted:   { string, fret }
//     bowed:     { string, position, finger }
//     keys:      { hand: 'rh'|'lh', finger }
//     free-reed: { hole, action, bendSteps }
//     wind, brass, percussion, voice: no placements (empty Map) -- these
//     families have nothing to place on a diagram; wind/brass get a
//     written-pitch `summary` instead, voice gets a key move.
//
//   Same as every arranger this builds on: an arrangement "unplayable" is
//   REPORTED, never dropped and never removed from the lesson -- only
//   fitToInstrument (upstream of this module) decides what the learner is
//   actually asked to play (see Risk 2, P4 plan).
//
//   arrangementKey(arr) -> a short stable string that changes whenever the
//   arrangement itself would look different to the learner (capo, tuning,
//   voice shift, harmonica fit) -- for P5's resumable practice state.
//
//   songForArrangement(song, partId, arr) -> a NEW song (model.js's
//   `transpose`) with the voice arrangement's key move applied, or the same
//   song unchanged for every other family (only a voice move changes what
//   is actually judged; every other family's arrangement is display and
//   advice only, per Risk 2).
import { arrangeFretted } from './fretted.js';
import { arrangeBowed } from './bowed.js';
import { arrangeKeys } from './keys.js';
import { fitHarmonicaKey, arrangeHarmonica } from './harmonica.js';
import { arrangeVoice } from './voice.js';
import { writtenNote } from './transposing.js';
import { keyByTonicMode } from '../../core/theory/keys.js';
import { transpose } from '../model.js';

// Readable names for the fretted alternate tunings fretboard.js knows about
// (src/instruments/how/fretboard.js's TUNINGS keys) -- anything not in this
// list (an instrument-specific name this module hasn't seen) is shown as-is
// rather than hidden.
const TUNING_NAMES = {
  'drop-d': 'drop D',
  dadgad: 'DADGAD',
  'open-g': 'open G',
  'open-d': 'open D',
  'half-step-down': 'half-step down',
  'ukulele-low-g': 'low G',
  'ukulele-high-g': 'high G',
  'bass-5-string': '5-string'
};

function humanizeTuning(name) {
  return TUNING_NAMES[name] || name;
}

function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// Plain-words summary shared by every family that has no per-note
// placement of its own to show (or that wants one on top of its
// placements): a fretted setup clause (capo/tuning), then, for any
// instrument written differently to how it sounds, transposing.js's
// writtenNote sentence.
function buildSummary(instrument, capo, tuningName) {
  const clauses = [];
  if (capo) clauses.push('capo ' + capo);
  if (tuningName) clauses.push(humanizeTuning(tuningName) + ' tuning');
  const setupText = clauses.length ? clauses.join(', ') : null;
  const written = writtenNote(instrument);
  if (setupText && written) return 'Arranged for ' + instrument.name + ': ' + setupText + '. ' + written + '.';
  if (setupText) return 'Arranged for ' + instrument.name + ': ' + setupText + '.';
  if (written) return 'Written for ' + instrument.name + ': ' + lowerFirst(written.replace(/^Written /, '')) + '.';
  return null;
}

function voiceSummary(shiftSemitones, newKeyName) {
  if (!shiftSemitones) return null;
  const direction = shiftSemitones < 0 ? 'down' : 'up';
  const n = Math.abs(shiftSemitones);
  let text = 'Moved ' + direction + ' ' + n + ' semitone' + (n === 1 ? '' : 's') + ' to suit your range';
  if (newKeyName) text += ' (now in ' + newKeyName + ')';
  return text + '.';
}

function harpAdviceText(notes, harpKey) {
  const best = fitHarmonicaKey(notes)[0];
  const bestName = keyByTonicMode(best.key, 'major').name;
  const yourName = keyByTonicMode(harpKey, 'major').name;
  return 'Best on a ' + bestName + ' harmonica — yours is set to ' + yourName + '.';
}

// bowed.js's unplayable/placed spread the whole note object it was given
// (see bowed.js's `{ ...note, reason }` / `{ ...note, string, position,
// finger }`); tagging the input with `__idx` before calling it, and
// stripping it back out here, is how this module recovers the note's
// position in `notes` without bowed.js needing to know about indices at
// all. fretted.js and keys.js already carry an explicit `index` and need no
// tagging.
function cleanUnplayable(u) {
  return { index: u.__idx !== undefined ? u.__idx : u.index, start: u.start, dur: u.dur, midi: u.midi, reason: u.reason };
}

export function arrangeFor(notes, instrument, setup = {}, opts = {}) {
  const family = instrument.family;
  const songKey = opts.songKey;
  const indexed = notes.map((n, i) => ({ ...n, __idx: i }));

  const result = {
    family,
    summary: null,
    capo: 0,
    tuningName: null,
    shiftSemitones: 0,
    newKeyName: null,
    harpAdvice: null,
    placements: new Map(),
    unplayable: []
  };

  if (family === 'fretted') {
    const capo = Number.isInteger(setup.capo) ? setup.capo : 0;
    const tuningMidi = Array.isArray(setup.tuningMidi) ? setup.tuningMidi : instrument.tuning;
    const arr = arrangeFretted(notes, { ...instrument, tuning: tuningMidi }, { capo });
    result.capo = capo;
    result.tuningName = setup.tuning || null;
    arr.placed.forEach(p => result.placements.set(p.index, { string: p.string, fret: p.fret }));
    result.unplayable = arr.unplayable.map(u => ({ index: u.index, start: u.start, dur: u.dur, midi: u.midi, reason: u.reason }));
    result.summary = buildSummary(instrument, capo, result.tuningName);
  } else if (family === 'bowed') {
    const arr = arrangeBowed(indexed, instrument);
    arr.placed.forEach(p => result.placements.set(p.__idx, { string: p.string, position: p.position, finger: p.finger }));
    result.unplayable = arr.unplayable.map(cleanUnplayable);
    result.summary = buildSummary(instrument, 0, null);
  } else if (family === 'keys') {
    const arr = arrangeKeys(indexed, instrument);
    arr.rh.forEach(n => result.placements.set(n.__idx, { hand: 'rh', finger: n.finger }));
    arr.lh.forEach(n => result.placements.set(n.__idx, { hand: 'lh', finger: n.finger }));
    result.unplayable = arr.unplayable.map(u => ({ index: u.index, start: u.start, dur: u.dur, midi: u.midi, reason: u.reason }));
    result.summary = buildSummary(instrument, 0, null);
  } else if (family === 'free-reed') {
    const harpKey = Number.isInteger(setup.harpKey) ? setup.harpKey : 0;
    const learnerFit = fitHarmonicaKey(notes, { keys: [harpKey] })[0];
    if (learnerFit && learnerFit.playable) {
      try {
        const shifted = indexed.map(n => ({ ...n, midi: n.midi + learnerFit.shift }));
        const arranged = arrangeHarmonica(shifted, harpKey);
        arranged.forEach(n => result.placements.set(n.__idx, { hole: n.hole, action: n.action, bendSteps: n.bendSteps }));
        result.shiftSemitones = learnerFit.shift;
      } catch (e) {
        result.harpAdvice = harpAdviceText(notes, harpKey);
      }
    } else {
      result.harpAdvice = harpAdviceText(notes, harpKey);
    }
  } else if (family === 'voice') {
    if (setup.voiceRange) {
      const input = songKey ? { notes, key: songKey } : notes;
      const arranged = arrangeVoice(input, setup.voiceRange);
      result.shiftSemitones = arranged.shiftSemitones;
      if (arranged.newKeyName) result.newKeyName = arranged.newKeyName;
      result.summary = voiceSummary(result.shiftSemitones, result.newKeyName);
    }
  } else {
    // wind, brass, percussion: no per-note placement, just a written-pitch
    // summary when this instrument reads differently to how it sounds.
    result.summary = buildSummary(instrument, 0, null);
  }

  return result;
}

// A short string that changes whenever the arrangement would look
// different to the learner -- everything a saved practice state (P5) needs
// to know it must re-render, without hashing the whole placements Map.
export function arrangementKey(arr) {
  return [
    arr.family,
    arr.capo,
    arr.tuningName || '',
    arr.shiftSemitones,
    arr.newKeyName || '',
    arr.harpAdvice ? '1' : '0'
  ].join('|');
}

// Only a voice arrangement's key move changes what is actually judged
// (Risk 2, P4 plan): every other family's arrangement is display and
// advice, so fitToInstrument's already-fitted song is returned unchanged.
export function songForArrangement(song, partId, arr) {
  if (!arr || arr.family !== 'voice' || !arr.shiftSemitones) return song;
  return transpose(song, arr.shiftSemitones);
}
