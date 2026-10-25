import { t } from './i18n.js';
import { pcKeyFor } from './pckeys.js';

// Pure wording for a wrong plucked or keyed note: which way to move. No DOM, no state.
//
// `fretted` is true for an item on a string of a fretted instrument (one fret is one
// semitone); false for keys and for mallet bars, which have no frets. `policy` is the item's
// octave policy (src/core/judge.js): 'exact' judges the octave too, so the real distance is
// worth stating; 'fold' and 'nearest-octave' judge the note name only, so the nearest note of
// that name is the right advice.
const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
const isWhite = (m) => WHITE_PCS.indexOf(((m % 12) + 12) % 12) >= 0;
const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

// `input` is how the wrong note arrived ('computer-key' names the key to press); `name` turns a
// MIDI note into the page's note name (app.js passes nname so sharps/flats follow the learner's
// setting). `fretted` and `policy` as before. On a drawn keyboard the learner counts WHITE keys,
// never semitones: a gap of 2 semitones between two white keys is one white key away.
export function wrongNoteHint({ heardMidi, targetMidi, policy, fretted, input, name }) {
  const gap = targetMidi - heardMidi;
  const n = Math.abs(gap);
  if (policy !== 'exact') {
    // Same fold the app used before this module: the shorter way round the 12 note names.
    let d = ((gap % 12) + 12) % 12; if (d > 6) d -= 12;
    return t(d > 0 ? 'wrongNote.higher' : 'wrongNote.lower');
  }
  if (n === 12) return t(gap < 0 ? 'wrongNote.octaveDown' : 'wrongNote.octaveUp');
  if (!fretted) {
    const dir = t(gap < 0 ? 'wrongNote.left' : 'wrongNote.right');
    let text;
    if (!isWhite(targetMidi)) text = t('wrongNote.black', { name: (name || ((m) => SHARP_NAMES[((m % 12) + 12) % 12]))(targetMidi), dir: dir });
    else {
      let whites = 0;
      for (let m = Math.min(heardMidi, targetMidi); m <= Math.max(heardMidi, targetMidi); m++) if (isWhite(m) && m !== heardMidi) whites++;
      text = whites === 1 ? t('wrongNote.white.one', { dir: dir }) : t('wrongNote.white.other', { count: whites <= 10 ? t('wrongNote.num.' + whites) : String(whites), dir: dir });
    }
    const key = input === 'computer-key' ? pcKeyFor(targetMidi) : undefined;
    return key ? text + ' ' + t('wrongNote.press', { key: key.toUpperCase() }) : text;
  }
  // Fretted: a fret count only means something within an octave; beyond it, just the direction,
  // by the sign of the gap (never the folded one, which points the wrong way for 7..11).
  if (n > 12) return t(gap > 0 ? 'wrongNote.higher' : 'wrongNote.lower');
  return t(n > 1 ? 'wrongNote.frets.other' : 'wrongNote.frets.one', { n: n, dir: t(gap > 0 ? 'wrongNote.up' : 'wrongNote.down') });
}

// F13: a MIDI keyboard with its octave or transpose button on plays every note the same
// distance off, so each wrong-note hint ("go one octave down") is right but the cause is the
// keyboard. `misses` is the run of consecutive wrong MIDI notes, oldest first, each
// { heardMidi, targetMidi }; once the last SHIFT_RUN share one nonzero offset (heard minus
// target) that offset is returned, else 0. One stray note is never enough.
export const SHIFT_RUN = 4;
export function midiShift(misses) {
  if (!Array.isArray(misses) || misses.length < SHIFT_RUN) return 0;
  const d = misses.slice(-SHIFT_RUN).map((m) => m.heardMidi - m.targetMidi);
  return d[0] !== 0 && d.every((x) => x === d[0]) ? d[0] : 0;
}
export function midiShiftHint(offset) {
  const dir = offset > 0 ? 'Up' : 'Down';
  const n = Math.abs(offset);
  if (n === 12) return t('wrongNote.shift.octave' + dir);
  return n === 1 ? t('wrongNote.shift.one' + dir) : t('wrongNote.shift.semis' + dir, { n: n });
}

// A transposing wind item carries `written` (what the prompt and staff show) beside `midi` (what
// sounds). Corrections name notes the way the page does, so this maps a heard SOUNDING pitch to
// the written one; an item with no `written` (concert pitch, bass clef) is returned unchanged.
export function writtenMidi(info, heardMidi) {
  return typeof info.written === 'number' ? heardMidi - (info.midi - info.written) : heardMidi;
}
