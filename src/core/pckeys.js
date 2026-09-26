// Pure computer-key -> MIDI mapping for the on-screen keyboard mod ('kbd').
// No DOM, no AudioContext -- src/app.js owns the keydown listener and the
// audio engine; this only owns which physical key means which pitch, so the
// mapping itself is unit-tested on its own.
//
// Two independent rows on a QWERTY layout:
//   upper row (home row + the row above it, starting on 'a'): a w s e d f t
//   g y h u j k -> C4 up to C5 (60-72), naturals and sharps both -- unchanged
//   from before this module existed.
//   lower row (the bottom letter row): z x c v b n m -> C3 up to B3
//   (48,50,52,53,55,57,59), naturals only. The bottom row has no letters left
//   over for black keys once the seven naturals are placed, and s/d/g/h/j are
//   already spoken for by the upper row's sharps, so this row cannot offer
//   lower sharps without silently double-booking a key.
export const PCKEYS_UPPER = { a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, u: 70, j: 71, k: 72 };
export const PCKEYS_LOWER = { z: 48, x: 50, c: 52, v: 53, b: 55, n: 57, m: 59 };

// The combined map the keydown handler actually looks keys up in. Built with
// Object.assign (not spread, to match this codebase's style) from the two
// named rows above so a caller that only cares about one row can still get
// it on its own.
export const PCKEYS = Object.assign({}, PCKEYS_UPPER, PCKEYS_LOWER);

// The lowest and highest MIDI note either row reaches, for hint/help text --
// this module stays free of any note-naming convention (that lives in
// app.js's own NAMES/nname()), so it only ever hands back numbers.
export function pckeysRowRange(row) {
  const vals = Object.values(row);
  return [Math.min(...vals), Math.max(...vals)];
}
