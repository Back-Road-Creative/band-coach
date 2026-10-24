// Mallet-bar geometry, pure (no DOM, no canvas): the ONE place a bell/xylophone bar row is worked
// out, called by src/app.js's drawBars (the practice canvas) and by src/ui/fingerings.js's mallet
// diagram, so the two never drift. Naturals sit in the front row; each sharp/flat is a shorter bar
// raised behind and centred on the seam between the two naturals it sits between. Bar length
// shrinks from the lowest bar to the highest, as it does on a real set. No sticking marks: no data.
import { isWhiteKey } from './keyboard.js';

export const isNaturalBar = isWhiteKey;

// Length factor 1 -> 0.62, lowest bar to highest of the whole instrument range.
export const barLengthFactor = (m, lo, hi) => 1 - 0.38 * (m - lo) / Math.max(1, hi - lo);

// A phone-width canvas gets two rows (C4-B4 over C5-C6) so every bar keeps a tappable width.
export function barRows(range, narrow) {
  const split = 72;
  return narrow && range.low < split && range.high >= split
    ? [{ lo: range.low, hi: split - 1 }, { lo: split, hi: range.high }]
    : [{ lo: range.low, hi: range.high }];
}

// `span` is the whole instrument's [lo, hi] so a second row keeps shrinking. `textScale`: page text zoom.
export function barLayout(x0, y0, w, h, lo, hi, textScale = 1, span = [lo, hi]) {
  const nat = []; for (let m = lo; m <= hi; m++) if (isNaturalBar(m)) nat.push(m);
  const slot = w / nat.length, f = m => barLengthFactor(m, span[0], span[1]);
  const natCy = y0 + 0.7 * h, accCy = y0 + 0.28 * h;
  const bars = nat.map((m, i) => { const len = 0.56 * h * f(m); return { m, black: false, x: x0 + i * slot + slot * 0.07, y: natCy - len / 2, w: slot * 0.86, h: len, labelX: x0 + i * slot + slot / 2, labelY: natCy + len / 2 - 0.05 * h }; });
  const raised = [];
  for (let m = lo; m <= hi; m++) { const below = !isNaturalBar(m) && bars.find(b => b.m === m - 1); if (below) { const len = 0.4 * h * f(m), bw = slot * 0.6; raised.push({ m, black: true, x: below.labelX + slot / 2 - bw / 2, y: accCy - len / 2, w: bw, h: len }); } }
  const labelPx = Math.min(slot * 0.4 * textScale, 0.22 * h);
  return { slot, labelPx, bars, raised };
}
