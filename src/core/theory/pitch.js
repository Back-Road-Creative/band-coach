// Shared low-level pitch helpers for keys/scales/chords/transpose (internal --
// not the public theory API). src/notation/spell.js already spells a MIDI note
// against one of the 15 major/15 minor key signatures; this file is for
// scale/chord construction, which spells notes generatively from an interval
// pattern instead, so the two never duplicate each other's job.

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

// Natural (no accidental) pitch class of each letter.
export const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function mod12(n) {
  return ((n % 12) + 12) % 12;
}

export function mod7(n) {
  return ((n % 7) + 7) % 7;
}

// Signed distance (roughly -6..5) from `pc` to `natural`, centred on zero so
// "one flat" (-1) is distinct from "eleven sharps" (same pitch, wrong spelling).
export function centeredDiff(pc, natural) {
  return mod12(pc - natural + 6) - 6;
}

// Signed semitone difference -> text accidental. Beyond a double sharp/flat is
// still produced (never clamped) so a caller can see a bad letter choice.
export function accidentalForDiff(diff) {
  if (diff === 0) return '';
  return diff > 0 ? '#'.repeat(diff) : 'b'.repeat(-diff);
}

// Spell one pitch class against a specific staff letter (by letter index into
// LETTERS, 0=C..6=B). Returns { letter, accidental, pc }.
export function spellAtLetter(pc, letterIndex) {
  const idx = mod7(letterIndex);
  const letter = LETTERS[idx];
  const diff = centeredDiff(mod12(pc), LETTER_PC[letter]);
  return { letter, accidental: accidentalForDiff(diff), pc: mod12(pc) };
}

// Parse a spelled note name like 'F#', 'Bb', 'C', 'Ebb' into { letter, accidental, pc }.
export function parseSpelling(name) {
  const m = /^([A-G])(#{1,2}|b{1,2})?$/.exec(String(name).trim());
  if (!m) throw new Error('not a note name: ' + JSON.stringify(name));
  const letter = m[1];
  const accidental = m[2] || '';
  let pc = LETTER_PC[letter];
  for (const ch of accidental) pc += ch === '#' ? 1 : -1;
  return { letter, accidental, pc: mod12(pc) };
}

export function spellingToString(spelling) {
  return spelling.letter + spelling.accidental;
}

// Normalises a 'F#'/'Bb'/'C' string or a { letter, accidental } pair (pc
// computed either way) -- every scale()/chord() root argument goes through this.
export function toSpelling(x) {
  if (typeof x === 'string') return parseSpelling(x);
  if (x && typeof x.pc === 'number' && x.letter) return x;
  if (x && typeof x.letter === 'string') return parseSpelling(x.letter + (x.accidental || ''));
  throw new Error('not a note spelling: ' + JSON.stringify(x));
}

// The letter (scanning forward from `preferredIndex`) that spells `pc` with
// the smallest accidental -- for scales not pinned to one-letter-per-degree.
export function nearestSpelling(pc, preferredIndex) {
  let best = null;
  for (let step = 0; step < 7; step++) {
    const idx = mod7(preferredIndex + step);
    const candidate = spellAtLetter(pc, idx);
    const size = candidate.accidental.length;
    if (!best || size < best.accidental.length) {
      best = candidate;
      if (size === 0) break;
    }
  }
  return best;
}
