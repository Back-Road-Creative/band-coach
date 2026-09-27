// Import fidelity report (plan unit E6a): a pure measurement of how far a
// song part actually diverges from the notes an importer first saw, plus
// how much fitToInstrument() (src/song/lesson.js) and arrangeFor()
// (src/song/arrange/index.js) still bend it to fit a chosen instrument.
// Reported, never dropped -- like feasibility.js, this never silently
// discards a discrepancy; it only ever hands the caller plain data to word
// for the learner. Nothing here produces a user-facing string.
//
// Public API:
//   fidelityReport(sourceNotes, song, partId, instrument) -> {
//     dropped: [{start, dur, midi}],
//     merged: [{start, midi, count}],
//     octaveShift: <int semitones, 0 unless fitToInstrument moved the part
//       by a whole octave or more>,
//     shiftSemitones: <int, fitToInstrument's raw shift, any amount>,
//     outOfRange: [{index, start, dur, midi, originalMidi, reason}],
//     chordReduced: [{index, start, midi}],
//     hands: {rh, lh} | null (null unless instrument.family === 'keys')
//   }
//
// sourceNotes is optional (null/undefined means "compare the part to
// itself": dropped and merged are always empty in that case, since every
// key matches its own count). Importers (src/song/import-midi.js) return
// only {song, warnings} today, so most real callers will pass null; a
// future importer that keeps its pre-import note list around can pass it
// here to see exactly what changed on the way in.

import { fitToInstrument } from '../lesson.js';
import { arrangeFor } from '../arrange/index.js';

function partNotesOf(song, partId) {
  const part = song.parts.find((p) => p.id === partId);
  return part ? part.notes : [];
}

// (start, midi) is the diff key -- see the module comment above and the
// header comment in lesson.js's own note-matching code for why duration
// isn't part of it: a held note that got re-typed to a different length by
// an importer is still "the same note", not a drop-and-add.
function keyOf(n) {
  return n.start + ':' + n.midi;
}

// A multiset diff of sourceNotes against the song's own part notes, by
// (start, midi). A source note whose key has no surviving copy at all is
// "dropped"; a key where the source had MORE copies than the song still
// has (but at least one survived) is "merged" -- several identical source
// notes collapsed onto fewer song notes -- reported with the original
// source count so the caller can say how many became one.
function diffNotes(sourceNotes, partNotes) {
  if (!sourceNotes) return { dropped: [], merged: [] };
  const sourceGroups = new Map();
  for (const n of sourceNotes) {
    const k = keyOf(n);
    const group = sourceGroups.get(k) || [];
    group.push(n);
    sourceGroups.set(k, group);
  }
  const partCounts = new Map();
  for (const n of partNotes) {
    const k = keyOf(n);
    partCounts.set(k, (partCounts.get(k) || 0) + 1);
  }
  const dropped = [];
  const merged = [];
  for (const [k, group] of sourceGroups) {
    const partCount = partCounts.get(k) || 0;
    if (partCount === 0) {
      for (const n of group) dropped.push({ start: n.start, dur: n.dur, midi: n.midi });
    } else if (group.length > partCount) {
      merged.push({ start: group[0].start, midi: group[0].midi, count: group.length });
    }
  }
  return { dropped, merged };
}

export function fidelityReport(sourceNotes, song, partId, instrument) {
  const partNotes = partNotesOf(song, partId);
  const { dropped, merged } = diffNotes(sourceNotes, partNotes);

  const fit = fitToInstrument(song, partId, instrument);
  const shiftSemitones = fit.shiftSemitones;
  // Only call it an "octave shift" when it actually is one -- a same-family
  // semitone nudge (harmonica key-friendliness) is still in shiftSemitones,
  // just not surfaced as octaveShift.
  const octaveShift = shiftSemitones !== 0 && shiftSemitones % 12 === 0 ? shiftSemitones : 0;

  // fit.unplayable holds both range/harmonica misses AND chord-reduced
  // notes (lesson.js's chordReductionFor) under one list, tagged by
  // `reason` -- split them back apart here, since only the range/harmonica
  // ones are actually "out of range".
  const outOfRange = fit.unplayable
    .filter((u) => u.reason !== 'chord-note')
    .map((u) => ({ index: u.index, start: u.start, dur: u.dur, midi: u.attemptedMidi, originalMidi: u.originalMidi, reason: u.reason }));
  const chordReduced = fit.unplayable
    .filter((u) => u.reason === 'chord-note')
    .map((u) => ({ index: u.index, start: u.start, midi: u.attemptedMidi }));

  // hands mirrors the app's own arrangeFor call for keyboard (src/ui/songs.js)
  // -- only the 'keys' family splits placements by hand; every other family
  // gets null rather than a misleading {rh: 0, lh: 0}.
  let hands = null;
  if (instrument.family === 'keys') {
    const arr = arrangeFor(fit.notes, instrument);
    let rh = 0;
    let lh = 0;
    for (const placement of arr.placements.values()) {
      if (placement.hand === 'rh') rh++;
      else if (placement.hand === 'lh') lh++;
    }
    hands = { rh, lh };
  }

  return { dropped, merged, octaveShift, shiftSemitones, outOfRange, chordReduced, hands };
}
