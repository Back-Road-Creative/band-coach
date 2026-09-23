// Renders the same primitive list draw-canvas.js draws to a standalone SVG string.
// Pure string building only -- no DOM, no canvas, so this runs anywhere (main thread,
// worker, a save/print path with no <canvas> in reach). Geometry mirrors draw-canvas.js
// primitive-for-primitive; keep the two in sync by hand when either changes.

const CLEF_GLYPH = { treble: '\u{1D11E}', bass: '\u{1D122}', alto: '\u{1D121}', tenor: '\u{1D121}' };
const CLEF_FALLBACK = { treble: 'G', bass: 'F', alto: 'C', tenor: 'C' };
const ACCIDENTAL_GLYPH = { '#': '♯', b: '♭', '': '♮' };
const ACCIDENTAL_FALLBACK = { '#': '#', b: 'b', '': 'n' };
// Keyed by the rest's undotted duration in whole notes (layout.js's durationInfo `base`).
// Glyphs are the Unicode musical-symbol rests; fallbacks are one-letter mnemonics
// (W)hole/(H)alf/(Q)uarter/(E)ighth/(S)ixteenth so a no-glyph-font rest still reads
// as "how long", not just "silence". An unrecognized/missing base falls back to quarter.
const REST_GLYPH = { 4: '\u{1D13B}', 2: '\u{1D13C}', 1: '\u{1D13D}', 0.5: '\u{1D13E}', 0.25: '\u{1D13F}' };
const REST_LETTER_FALLBACK = { 4: 'W', 2: 'H', 1: 'Q', 0.5: 'E', 0.25: 'S' };

// Escapes the five characters XML text content and quoted attribute values reserve.
export function escapeXML(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function glyphOrFallback(theme, glyph, fallback) {
  return theme && theme.glyphFont ? glyph : fallback;
}

function svgLine(x1, y1, x2, y2) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="black"/>`;
}

function svgText(text, x, y) {
  return `<text x="${x}" y="${y}" fill="black">${escapeXML(text)}</text>`;
}

const DRAWERS = {
  line: (p) => svgLine(p.x, p.y, p.x + p.length, p.y),
  ledger: (p) => svgLine(p.x - p.length / 2, p.y, p.x + p.length / 2, p.y),
  barline: (p) => svgLine(p.x, p.y1, p.x, p.y2),
  stem: (p) => svgLine(p.x, p.y1, p.x, p.y2),

  notehead: (p) => {
    const fill = p.filled ? 'black' : 'none';
    const stroke = p.filled ? 'none' : 'black';
    return `<ellipse cx="${p.x}" cy="${p.y}" rx="5" ry="4" fill="${fill}" stroke="${stroke}" transform="rotate(${(-0.4 * 180) / Math.PI} ${p.x} ${p.y})"/>`;
  },

  dot: (p) => `<circle cx="${p.x}" cy="${p.y}" r="1.5" fill="black"/>`,

  clef: (p, theme) => svgText(glyphOrFallback(theme, CLEF_GLYPH[p.clef], CLEF_FALLBACK[p.clef]), p.x, p.y),

  keyAccidental: (p, theme) => svgText(glyphOrFallback(theme, ACCIDENTAL_GLYPH[p.accidental], ACCIDENTAL_FALLBACK[p.accidental]), p.x, p.y),

  accidental: (p, theme) => svgText(glyphOrFallback(theme, ACCIDENTAL_GLYPH[p.accidental], ACCIDENTAL_FALLBACK[p.accidental]), p.x, p.y),

  timeSig: (p) => svgText(String(p.top), p.x, p.y - 10) + svgText(String(p.bottom), p.x, p.y + 2),

  rest: (p, theme) => svgText(glyphOrFallback(theme, REST_GLYPH[p.base] || REST_GLYPH[1], REST_LETTER_FALLBACK[p.base] || REST_LETTER_FALLBACK[1]), p.x, p.y),

  flag: (p) => svgLine(p.x, p.y, p.x + 6, p.y + (p.up ? 8 : -8)),

  beam: (p) => svgLine(p.x1, p.y1, p.x2, p.y2),

  fretNumber: (p) => svgText(String(p.fret), p.x, p.string * 10),
};

// Renders `primitives` (the same list drawPrimitives() consumes) as a standalone,
// self-contained SVG document string. `opts.width`/`opts.height` size the viewport;
// unknown primitive types are skipped, matching drawPrimitives()'s own behavior.
export function drawSVG(primitives, theme, opts = {}) {
  const width = opts.width || 400;
  const height = opts.height || 200;
  const body = primitives.map((p) => {
    const draw = DRAWERS[p.type];
    return draw ? draw(p, theme) : '';
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}
