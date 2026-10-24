// Keyboard geometry, pure (no DOM, no canvas): the ONE place a two-row piano
// layout is worked out, called by src/app.js's drawKeys (the practice canvas)
// and by src/ui/fingerings.js's keyboard diagram, so the two never drift.
// Black keys are 0.64 of a white key wide, 0.62 of its height tall, starting
// 0.68 of the way across the white key below them. A white key's note-name
// label sits in the band under the black keys and is sized to fit that band.
export const isWhiteKey = m => [0, 2, 4, 5, 7, 9, 11].includes(((m % 12) + 12) % 12);

// `textScale` is the page's text zoom (rootK in app.js): labels grow with it, capped to the band.
export function keyLayout(x0, y0, w, h, lo, hi, textScale = 1) {
  const whiteMidis = []; for (let m = lo; m <= hi; m++) if (isWhiteKey(m)) whiteMidis.push(m);
  const kw = w / whiteMidis.length, band = 0.38 * h, blackBottom = y0 + 0.62 * h;
  const labelPx = Math.min(kw * 0.34 * textScale, band * 0.8), labelY = y0 + h - band * 0.1;
  const whites = whiteMidis.map((m, i) => ({ m, x: x0 + i * kw, y: y0, w: kw, h, labelX: x0 + i * kw + kw / 2, labelY }));
  const blacks = [];
  for (let m = lo; m <= hi; m++) { const below = !isWhiteKey(m) && whites.find(k => k.m === m - 1); if (below) blacks.push({ m, x: below.x + 0.68 * kw, y: y0, w: 0.64 * kw, h: 0.62 * h }); }
  return { kw, blackBottom, labelPx, whites, blacks };
}

// Middle C splits the hands: the left-hand row ends at 59, the right-hand row starts at 60.
export function keyboardRows(range) {
  return [{ lo: range.low, hi: 59, hand: 'lh' }, { lo: 60, hi: range.high, hand: 'rh' }];
}
