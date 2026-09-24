// Feasibility badge (plan unit D8, "Play it on…" cards): a plain-language
// verdict for "can THIS instrument actually play THIS song part", computed
// entirely from fitToInstrument()'s real result (src/song/lesson.js) --
// never a guessed or invented score. Shown before the learner commits to a
// practice lesson, so picking an instrument for a song is an informed
// choice, not a surprise three steps in.
//
// Public API:
//   feasibility(song, partId, instrument) -> { level, label, detail }
//     level is one of 'as-written' | 'transposed' | 'partial' | 'unplayable'
//     | 'empty' (the part has no notes at all, e.g. an instrument-only
//     harmony part on a melody-only starter song).
//     label is a short phrase for the badge itself ("Fits as written",
//     "Transposed to G", "3 notes skipped").
//     detail is one full sentence for the card body, reusing the exact
//     wording fitToInstrument() already produces for renderPractice()'s own
//     "this song was ... to fit your instrument" line, so the badge and the
//     practice screen never disagree about what happened to the song.

import { fitToInstrument, isSingleLine } from './lesson.js';

// Re-exported so a caller of this module never has to know isSingleLine's
// canonical home is lesson.js (fitToInstrument needs it too -- see the
// comment on POLYPHONIC_FAMILIES there for why it isn't defined here
// instead, which would make this file and lesson.js a circular import pair).
export { isSingleLine };

const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function mod12(n) {
  return ((n % 12) + 12) % 12;
}

// Plain-language name for the key the song ends up in after fitToInstrument's
// chosen shift, when the song carries key data (song.key: { tonic, mode } --
// see src/song/model.js). Returns null for a song with no key (song.key ===
// null is a valid, allowed shape), so the caller falls back to describing
// the shift itself rather than inventing a key name.
function transposedKeyName(song, shiftSemitones) {
  if (!song.key) return null;
  const tonic = PITCH_CLASS_NAMES[mod12(song.key.tonic + shiftSemitones)];
  return song.key.mode === 'minor' ? tonic + ' minor' : tonic;
}

export function feasibility(song, partId, instrument) {
  const fit = fitToInstrument(song, partId, instrument);

  if (fit.notes.length === 0) {
    return { level: 'empty', label: 'No notes yet', detail: 'This part has no notes to practise yet.', monophonic: true };
  }

  // fit.unplayable mixes two different reasons a note doesn't reach the
  // lesson: genuinely out of the instrument's reach ('out-of-range' /
  // 'not-on-instrument') vs. a chord note on a single-line instrument
  // ('chord-note', see lesson.js's chordReductionFor) -- the latter isn't
  // dropped from the SONG, it's still played as the top note of its chord,
  // so it gets its own message below rather than being counted as "skipped".
  const chordEntries = fit.unplayable.filter(u => u.reason === 'chord-note');
  const otherUnplayable = fit.unplayable.filter(u => u.reason !== 'chord-note');
  const monophonic = chordEntries.length === 0;

  const unplayableCount = otherUnplayable.length;

  if (unplayableCount > 0) {
    const level = unplayableCount >= fit.notes.length ? 'unplayable' : 'partial';
    const label = unplayableCount + ' note' + (unplayableCount === 1 ? '' : 's') + ' skipped';
    const prefix = fit.changes.length ? 'This song was ' + fit.changes.join('; ') + ', but ' : 'This song has ';
    const detail = prefix + unplayableCount + ' note' + (unplayableCount === 1 ? '' : 's') +
      ' that cannot be played on this instrument and will be skipped.';
    return { level, label, detail, monophonic };
  }

  if (!monophonic) {
    const chordCount = new Set(chordEntries.map(u => u.start)).size;
    const detail = 'This part has ' + chordCount + ' chord' + (chordCount === 1 ? '' : 's') + '; a ' + instrument.name +
      ' plays one note at a time, so the lesson uses the top note of each chord.';
    return { level: 'partial', label: 'Has chords', detail, monophonic };
  }

  if (fit.changed) {
    const keyName = transposedKeyName(song, fit.shiftSemitones);
    const label = keyName ? 'Transposed to ' + keyName : capitalize(fit.changes[0]);
    return { level: 'transposed', label, detail: 'This song was ' + fit.changes.join('; ') + ' to fit this instrument.', monophonic };
  }

  return { level: 'as-written', label: 'Fits as written', detail: 'Every note in this song is playable on this instrument, unchanged.', monophonic };
}

function capitalize(text) {
  return text.length ? text[0].toUpperCase() + text.slice(1) : text;
}
