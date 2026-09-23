// Move a song into the key that fits the SINGER's own measured comfortable
// range (plan §11.7 Wave D "voice key-to-range", after #70). This is a
// different problem from `src/song/lesson.js`'s `fitToInstrument`, which
// shifts a song to fit a fixed instrument-record range (open PR #99, do not
// edit): a voice's comfortable range comes from
// `src/instruments/how/voice-range.js`'s "Find my range" flow
// (estimateRange() -> a measured { low, high }), and a singer needs the song
// moved so its OWN tessitura lands centred in that range, not merely nudged
// clear of a fixed boundary an octave at a time.
//
// This module reuses `exerciseRangeFor` (voice-range.js) for the same
// margin-pulled-in-from-both-ends rule that flow already applies before a
// warm-up exercise -- so a song and the exercises building toward it never
// disagree about how close to a singer's limits is safe. It looks up the
// resulting key's display name via `core/theory/keys.js`'s
// `keyByTonicMode`, never re-deriving key-signature spelling here.
//
// Pure module: no DOM, no AudioContext, no Math.random, no Date.now() --
// caller owns the clock. Same house style as src/core/groove.js and
// src/song/lesson.js.
//
// Unwired: no caller yet (D8 wires this into the practice-song flow).
//
// Public API:
//   keyForVoice(notes, userRange, { margin }) -> ranked candidates
//     notes: [{ start, dur, midi, ... }] (a Song part's notes, as-is).
//     userRange: { low, high } -- the singer's own measured comfortable
//       range, not an instrument's fixed range.
//     Tries every semitone shift within a four-octave reach each way and
//     ranks them best-first by (a) fewest notes landing outside the
//     margin-pulled-in range (exerciseRangeFor(userRange, margin)), (b) how
//     close the song's duration-weighted mean pitch (its tessitura) lands
//     to that range's centre once shifted, (c) the smallest absolute shift.
//     Every candidate: { shiftSemitones, fits, lowestMidi, highestMidi,
//     tessituraCentre, outOfRange }; `outOfRange` lists every note that
//     still falls outside the range at that shift, as
//     { start, dur, originalMidi, attemptedMidi, reason: 'out-of-range' }
//     (same shape as fitToInstrument's `unplayable`, so a caller can render
//     either with one component) -- notes are reported, never dropped.
//   arrangeVoice(input, userRange, { margin }) -> { notes, shiftSemitones,
//     newKeyName? }
//     input is either a bare notes array or a { notes, key } pair (a Song
//     part with its song's `key` attached). Applies keyForVoice's top-ranked
//     shift to every note (never drops one, same never-drop contract as
//     fitToInstrument) and, only when `key` came in with the input, adds
//     `newKeyName`, the display name of the shifted tonic's key.

import { exerciseRangeFor } from '../../instruments/how/voice-range.js';
import { keyByTonicMode } from '../../core/theory/keys.js';
import { mod12 } from '../../core/theory/pitch.js';

const MAX_OCTAVE_REACH = 4; // +/- 4 octaves comfortably spans any voice-to-song gap

function candidateShifts() {
  const shifts = [];
  for (let s = -MAX_OCTAVE_REACH * 12; s <= MAX_OCTAVE_REACH * 12; s++) shifts.push(s);
  return shifts;
}

// Duration-weighted mean pitch: a long-held note pulls the tessitura toward
// it more than a passing eighth note does, matching how a singer actually
// experiences a song's centre of gravity.
function weightedTessitura(notes) {
  let weighted = 0;
  let totalDur = 0;
  for (const n of notes) {
    weighted += n.midi * n.dur;
    totalDur += n.dur;
  }
  if (totalDur > 0) return weighted / totalDur;
  return notes.length > 0 ? notes[0].midi : 0;
}

export function keyForVoice(notes, userRange, opts = {}) {
  const fitRange = exerciseRangeFor(userRange, opts.margin);
  const centre = (fitRange.low + fitRange.high) / 2;
  const baseTessitura = weightedTessitura(notes);

  const candidates = candidateShifts().map(shift => {
    const outOfRange = [];
    let lowest = Infinity;
    let highest = -Infinity;
    for (const n of notes) {
      const shiftedMidi = n.midi + shift;
      lowest = Math.min(lowest, shiftedMidi);
      highest = Math.max(highest, shiftedMidi);
      if (shiftedMidi < fitRange.low || shiftedMidi > fitRange.high) {
        outOfRange.push({ start: n.start, dur: n.dur, originalMidi: n.midi, attemptedMidi: shiftedMidi, reason: 'out-of-range' });
      }
    }
    return {
      shiftSemitones: shift,
      fits: outOfRange.length === 0,
      lowestMidi: notes.length > 0 ? lowest : null,
      highestMidi: notes.length > 0 ? highest : null,
      tessituraCentre: baseTessitura + shift,
      outOfRange
    };
  });

  candidates.sort((a, b) =>
    a.outOfRange.length - b.outOfRange.length ||
    Math.abs(a.tessituraCentre - centre) - Math.abs(b.tessituraCentre - centre) ||
    Math.abs(a.shiftSemitones) - Math.abs(b.shiftSemitones)
  );
  return candidates;
}

export function arrangeVoice(input, userRange, opts = {}) {
  const notes = Array.isArray(input) ? input : input.notes;
  const key = Array.isArray(input) ? undefined : input.key;
  const ranked = keyForVoice(notes, userRange, opts);
  const best = ranked[0];
  const shiftedNotes = notes.map(n => ({ ...n, midi: n.midi + best.shiftSemitones }));

  const result = { notes: shiftedNotes, shiftSemitones: best.shiftSemitones };
  if (key) {
    result.newKeyName = keyByTonicMode(mod12(key.tonic + best.shiftSemitones), key.mode).name;
  }
  return result;
}
