// Pure data for a one-octave keyboard diagram (12 keys, white/black, left to
// right x order) with a set of pitch classes marked active. theory.js turns
// this into DOM; kept separate so the layout math has a plain-object test.

const WHITE = [
  { pc: 0, letter: 'C' }, { pc: 2, letter: 'D' }, { pc: 4, letter: 'E' },
  { pc: 5, letter: 'F' }, { pc: 7, letter: 'G' }, { pc: 9, letter: 'A' }, { pc: 11, letter: 'B' },
];
// afterWhite: index (0-based) of the white key each black key sits between.
const BLACK = [
  { pc: 1, afterWhite: 0 }, { pc: 3, afterWhite: 1 },
  { pc: 6, afterWhite: 3 }, { pc: 8, afterWhite: 4 }, { pc: 10, afterWhite: 5 },
];

// activePcs: iterable of pitch classes (0-11) to mark. Returns 12 entries
// { pc, letter, isBlack, x, active }, x ascending left-to-right (black keys
// sit at a fractional x between the white keys they overlap).
export function keyboardDiagramKeys(activePcs) {
  const active = new Set(Array.from(activePcs, (n) => ((n % 12) + 12) % 12));
  const whites = WHITE.map((w, i) => ({ pc: w.pc, letter: w.letter, isBlack: false, x: i, active: active.has(w.pc) }));
  const blacks = BLACK.map((b) => ({ pc: b.pc, letter: null, isBlack: true, x: b.afterWhite + 0.65, active: active.has(b.pc) }));
  return whites.concat(blacks).sort((a, b) => a.x - b.x);
}
