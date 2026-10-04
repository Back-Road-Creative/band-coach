// Pure wording for a wrong plucked or keyed note: which way to move. No DOM, no state.
//
// `fretted` is true for an item on a string of a fretted instrument (one fret is one
// semitone); false for keys and for mallet bars, which have no frets. `policy` is the item's
// octave policy (src/core/judge.js): 'exact' judges the octave too, so the real distance is
// worth stating; 'fold' and 'nearest-octave' judge the note name only, so the nearest note of
// that name is the right advice.
export function wrongNoteHint({ heardMidi, targetMidi, policy, fretted }) {
  const gap = targetMidi - heardMidi;
  const n = Math.abs(gap);
  if (policy !== 'exact') {
    // Same fold the app used before this module: the shorter way round the 12 note names.
    let d = ((gap % 12) + 12) % 12; if (d > 6) d -= 12;
    return 'Go ' + (d > 0 ? 'higher' : 'lower') + '.';
  }
  if (n === 12) return 'Right note, wrong octave: go one octave ' + (gap < 0 ? 'down' : 'up') + '.';
  if (!fretted) return 'Go ' + n + ' key' + (n > 1 ? 's' : '') + ' to the ' + (gap < 0 ? 'left' : 'right') + '.';
  // Fretted: a fret count only means something within an octave; beyond it, just the direction,
  // by the sign of the gap (never the folded one, which points the wrong way for 7..11).
  if (n > 12) return 'Go ' + (gap > 0 ? 'higher' : 'lower') + '.';
  return 'Go ' + n + ' fret' + (n > 1 ? 's' : '') + ' ' + (gap > 0 ? 'higher' : 'lower') + '.';
}

// A transposing wind item carries `written` (what the prompt and staff show) beside `midi` (what
// sounds). Corrections name notes the way the page does, so this maps a heard SOUNDING pitch to
// the written one; an item with no `written` (concert pitch, bass clef) is returned unchanged.
export function writtenMidi(info, heardMidi) {
  return typeof info.written === 'number' ? heardMidi - (info.midi - info.written) : heardMidi;
}
