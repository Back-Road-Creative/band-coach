// Hand-authored vector glyph geometry for clefs, accidentals and rests, replacing the
// Unicode-glyph-or-plain-letter fallback in draw-canvas.js / draw-svg.js. Every `d` string
// is an SVG path-data string, usable directly as an SVG <path d="..."> attribute or fed to
// `new Path2D(d)` on a Canvas 2D context.
//
// Coordinates share layout.js's pixel space (LINE_GAP = 10px between staff lines, so
// STEP = 5px per staff position) with (0, 0) at the primitive's own anchor point (p.x, p.y)
// -- callers translate() to that point and draw with no extra scaling. These are simplified
// original shapes built from lines and Bezier curves only, not traced from any font file.

// Clefs anchor on the staff's bottom line (y = 0, matching layout.js's `staffBottomY`); the
// staff's five lines run from y = 0 (bottom) to y = -40 (top), 10px apart.
export const CLEF_PATHS = {
  // The G-clef loop curls around the G line at y = -10.
  treble: 'M 1 -46 C 8 -46 8 -34 1 -30 C -7 -25 -7 -14 2 -13 C 9 -12 10 -21 3 -20 L 3 5 C 3 11 -6 11 -6 5 C -6 0 1 0 1 5 L 1 -30 C -4 -34 -4 -41 1 -46 Z',
  // The two F-clef dots straddle the F line at y = -30.
  bass: 'M -5 -34 C -5 -40 4 -40 4 -34 C 4 -28 -5 -28 -5 -34 Z M 6 -33 C 7.2 -33 7.2 -31.5 6 -31.5 C 4.8 -31.5 4.8 -33 6 -33 Z M 6 -28 C 7.2 -28 7.2 -26.5 6 -26.5 C 4.8 -26.5 4.8 -28 6 -28 Z',
  // The C-clef (shared, undifferentiated, by alto and tenor): two vertical strokes pinched
  // together by two back-to-back curves at the clef line.
  alto: 'M -6 -40 L -6 0 M -1 -40 L -1 0 M -6 -34 C 0 -34 0 -24 -4 -24 C 0 -24 0 -14 -6 -14 M -6 -6 C 0 -6 0 4 -6 4',
  // Two plain bars: the traditional percussion-clef mark.
  percussion: 'M -3 -32 L -3 -8 M 3 -32 L 3 -8',
};
CLEF_PATHS.tenor = CLEF_PATHS.alto; // Same C-clef shape; layout.js only distinguishes them by staff position.

// Accidentals anchor on the altered note's own y (its notehead center), sized to roughly a
// staff space (10px) tall on either side.
export const ACCIDENTAL_PATHS = {
  '#': 'M -3 -9 L -3 9 M 3 -9 L 3 9 M -5 -3 L 5 -5 M -5 5 L 5 3',
  b: 'M -3 -10 L -3 8 C 1 8 5 5 5 1 C 5 -3 1 -4 -3 -1 Z',
  '': 'M -3 -8 L -3 8 M 3 -8 L 3 8 M -3 -3 L 3 1 M -3 3 L 3 7',
};

// Rests anchor on the y position layout.js gives the 'rest' primitive (usually the middle
// staff line). Keyed by the rest's undotted duration in whole notes, same as layout.js's
// durationInfo `base` and the old REST_GLYPH/REST_LETTER_FALLBACK tables.
export const REST_PATHS = {
  // Whole rest: a filled block hanging below a line.
  4: 'M -5 -4 L 5 -4 L 5 0 L -5 0 Z',
  // Half rest: a filled block sitting above a line (mirrors the whole rest).
  2: 'M -5 0 L 5 0 L 5 4 L -5 4 Z',
  // Quarter rest: a simple zigzag squiggle.
  1: 'M -3 -9 C 1 -9 -3 -4 1 -2 C -2 -1 -4 2 0 4 C -3 6 3 9 1 12 M 1 -2 C -1 0 2 3 -1 5',
  // Eighth rest: a stem with one flag loop.
  0.5: 'M -1 -9 L 2 9 M -1 -9 C 4 -9 5 -3 0 -2 C 4 -1 5 3 1 5',
  // Sixteenth rest: a stem with two flag loops.
  0.25: 'M -1 -9 L 3 12 M -1 -9 C 4 -9 5 -3 0 -2 C 4 -1 5 3 1 5 M -1 -3 C 4 -3 5 3 0 4 C 4 5 5 9 1 11',
  // Thirty-second rest: a stem with three flag loops.
  0.125: 'M -1 -12 L 4 15 M -1 -12 C 4 -12 5 -6 0 -5 C 4 -4 5 0 1 2 M -1 -5 C 4 -5 5 1 0 2 C 4 3 5 7 1 9 M -1 2 C 4 2 5 8 0 9 C 4 10 5 14 1 16',
};

// Rest durations whose path is a solid block (fill, not stroke) -- the whole and half rests.
export const FILLED_RESTS = new Set([4, 2]);
