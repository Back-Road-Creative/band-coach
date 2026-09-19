// Thin Canvas 2D renderer for the primitives layout.js / tab.js produce.
// Uses only Canvas 2D calls; music glyphs come from a Unicode music font
// (theme.glyphFont) with a plain-letter fallback when none is set.

const CLEF_GLYPH = { treble: '\u{1D11E}', bass: '\u{1D122}', alto: '\u{1D121}', tenor: '\u{1D121}' };
const CLEF_FALLBACK = { treble: 'G', bass: 'F', alto: 'C', tenor: 'C' };
const ACCIDENTAL_GLYPH = { '#': '♯', b: '♭', '': '♮' };
const ACCIDENTAL_FALLBACK = { '#': '#', b: 'b', '': 'n' };
const REST_FALLBACK = 'z';

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

  notehead: (ctx, p) => {
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

  clef: (ctx, p, theme) => drawText(ctx, glyphOrFallback(theme, CLEF_GLYPH[p.clef], CLEF_FALLBACK[p.clef]), p.x, p.y, theme && theme.glyphFont),

  keyAccidental: (ctx, p, theme) => drawText(ctx, glyphOrFallback(theme, ACCIDENTAL_GLYPH[p.accidental], ACCIDENTAL_FALLBACK[p.accidental]), p.x, p.y, theme && theme.glyphFont),

  accidental: (ctx, p, theme) => drawText(ctx, glyphOrFallback(theme, ACCIDENTAL_GLYPH[p.accidental], ACCIDENTAL_FALLBACK[p.accidental]), p.x, p.y, theme && theme.glyphFont),

  timeSig: (ctx, p) => {
    ctx.fillText(String(p.top), p.x, p.y - 10);
    ctx.fillText(String(p.bottom), p.x, p.y + 2);
  },

  rest: (ctx, p, theme) => drawText(ctx, glyphOrFallback(theme, REST_FALLBACK, REST_FALLBACK), p.x, p.y, theme && theme.glyphFont),

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
