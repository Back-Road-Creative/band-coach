// Thin Canvas 2D renderer for the primitives layout.js / tab.js produce.
// Uses only Canvas 2D calls; music glyphs come from a Unicode music font
// (theme.glyphFont) with a plain-letter fallback when none is set.

const CLEF_GLYPH = { treble: '\u{1D11E}', bass: '\u{1D122}', alto: '\u{1D121}', tenor: '\u{1D121}', percussion: '\u{1D125}' };
const CLEF_FALLBACK = { treble: 'G', bass: 'F', alto: 'C', tenor: 'C', percussion: '||' };
const ACCIDENTAL_GLYPH = { '#': '♯', b: '♭', '': '♮' };
const ACCIDENTAL_FALLBACK = { '#': '#', b: 'b', '': 'n' };
// Keyed by the rest's undotted duration in whole notes (layout.js's durationInfo `base`).
// Glyphs are the Unicode musical-symbol rests; fallbacks are one-letter mnemonics
// (W)hole/(H)alf/(Q)uarter/(E)ighth/(S)ixteenth/(T)hirty-second so a no-glyph-font rest still reads
// as "how long", not just "silence". An unrecognized/missing base falls back to quarter.
const REST_GLYPH = { 4: '\u{1D13B}', 2: '\u{1D13C}', 1: '\u{1D13D}', 0.5: '\u{1D13E}', 0.25: '\u{1D13F}', 0.125: '\u{1D140}' };
const REST_LETTER_FALLBACK = { 4: 'W', 2: 'H', 1: 'Q', 0.5: 'E', 0.25: 'S', 0.125: 'T' };

function glyphOrFallback(theme, glyph, fallback) {
  return theme && theme.glyphFont ? glyph : fallback;
}

function drawLine(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawText(ctx, text, x, y, font) {
  if (font) ctx.font = font;
  ctx.fillText(text, x, y);
}

const DRAWERS = {
  line: (ctx, p) => drawLine(ctx, p.x, p.y, p.x + p.length, p.y),
  ledger: (ctx, p) => drawLine(ctx, p.x - p.length / 2, p.y, p.x + p.length / 2, p.y),
  barline: (ctx, p) => drawLine(ctx, p.x, p.y1, p.x, p.y2),
  stem: (ctx, p) => drawLine(ctx, p.x, p.y1, p.x, p.y2),

  // Percussion noteheads: 'x' (cymbals/hi-hat/ride) is two crossed strokes,
  // 'circle' is the small hollow ring drawn above an 'x' for an open hi-hat.
  // Anything else (including undefined, for pitched notes) is the usual oval.
  notehead: (ctx, p) => {
    if (p.shape === 'x') {
      ctx.beginPath();
      ctx.moveTo(p.x - 4, p.y - 4);
      ctx.lineTo(p.x + 4, p.y + 4);
      ctx.moveTo(p.x - 4, p.y + 4);
      ctx.lineTo(p.x + 4, p.y - 4);
      ctx.stroke();
      return;
    }
    if (p.shape === 'circle') {
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 2.5, 2.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 5, 4, -0.4, 0, Math.PI * 2);
    if (p.filled) ctx.fill();
    else ctx.stroke();
  },

  dot: (ctx, p) => {
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 1.5, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
  },

  // A small arc to a note's left marking it as a continuation of a note held
  // from the previous bar (layout.js only emits this for `note.tied`).
  tie: (ctx, p) => {
    ctx.beginPath();
    ctx.arc(p.x - 3, p.y, 6, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  },

  clef: (ctx, p, theme) => drawText(ctx, glyphOrFallback(theme, CLEF_GLYPH[p.clef], CLEF_FALLBACK[p.clef]), p.x, p.y, theme && theme.glyphFont),

  keyAccidental: (ctx, p, theme) => drawText(ctx, glyphOrFallback(theme, ACCIDENTAL_GLYPH[p.accidental], ACCIDENTAL_FALLBACK[p.accidental]), p.x, p.y, theme && theme.glyphFont),

  accidental: (ctx, p, theme) => drawText(ctx, glyphOrFallback(theme, ACCIDENTAL_GLYPH[p.accidental], ACCIDENTAL_FALLBACK[p.accidental]), p.x, p.y, theme && theme.glyphFont),

  timeSig: (ctx, p) => {
    ctx.fillText(String(p.top), p.x, p.y - 10);
    ctx.fillText(String(p.bottom), p.x, p.y + 2);
  },

  rest: (ctx, p, theme) => drawText(ctx, glyphOrFallback(theme, REST_GLYPH[p.base] || REST_GLYPH[1], REST_LETTER_FALLBACK[p.base] || REST_LETTER_FALLBACK[1]), p.x, p.y, theme && theme.glyphFont),

  flag: (ctx, p) => {
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 6, p.y + (p.up ? 8 : -8));
    ctx.stroke();
  },

  beam: (ctx, p) => drawLine(ctx, p.x1, p.y1, p.x2, p.y2),

  fretNumber: (ctx, p) => {
    ctx.fillText(String(p.fret), p.x, p.string * 10);
  },
};

// Draws every primitive in order using only Canvas 2D calls.
export function drawPrimitives(ctx, primitives, theme) {
  for (const p of primitives) {
    const draw = DRAWERS[p.type];
    if (!draw) continue; // unknown primitive: skip rather than throw
    draw(ctx, p, theme);
  }
}
