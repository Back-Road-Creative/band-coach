// Renders the same primitive list draw-canvas.js draws to a standalone SVG string.
// Pure string building only -- no DOM, no canvas, so this runs anywhere (main thread,
// worker, a save/print path with no <canvas> in reach). Geometry mirrors draw-canvas.js
// primitive-for-primitive; keep the two in sync by hand when either changes.

import { CLEF_PATHS, ACCIDENTAL_PATHS, REST_PATHS, FILLED_RESTS } from './glyphs.js';

const CLEF_GLYPH = { treble: '\u{1D11E}', bass: '\u{1D122}', alto: '\u{1D121}', tenor: '\u{1D121}', percussion: '\u{1D125}' };
const CLEF_FALLBACK = { treble: 'G', bass: 'F', alto: 'C', tenor: 'C', percussion: '||' };
const ACCIDENTAL_GLYPH = { '#': '♯', b: '♭', '': '♮' };
const ACCIDENTAL_FALLBACK = { '#': '#', b: 'b', '': 'n' };
// Keyed by the rest's undotted duration in whole notes (layout.js's durationInfo `base`).
// Glyphs are the Unicode musical-symbol rests; fallbacks are one-letter mnemonics
// (W)hole/(H)alf/(Q)uarter/(E)ighth/(S)ixteenth/(T)hirty-second so a no-glyph-font,
// no-vector-path rest still reads as "how long", not just "silence". An unrecognized/missing
// base falls back to quarter.
const REST_GLYPH = { 4: '\u{1D13B}', 2: '\u{1D13C}', 1: '\u{1D13D}', 0.5: '\u{1D13E}', 0.25: '\u{1D13F}', 0.125: '\u{1D140}' };
const REST_LETTER_FALLBACK = { 4: 'W', 2: 'H', 1: 'Q', 0.5: 'E', 0.25: 'S', 0.125: 'T' };

// Escapes the five characters XML text content and quoted attribute values reserve.
export function escapeXML(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Draws a glyphs.js vector path as a <g><path>, translated to (x, y): filled for a solid
// shape (the whole/half rest blocks), stroked otherwise. Falls back to a Unicode music-font
// glyph when theme.glyphFont is set (the font path stays available for anyone who wants
// it), or to a plain letter when there is no path data at all -- a string builder has no
// Path2D-availability question the way Canvas 2D does, so the vector path is what everyone
// gets by default.
function svgGlyphPath(theme, glyph, x, y, d, filled, fallback) {
  if (theme && theme.glyphFont) return svgText(glyph, x, y);
  if (!d) return svgText(fallback, x, y);
  const attrs = filled ? 'fill="black" stroke="none"' : 'fill="none" stroke="black"';
  return `<g transform="translate(${x} ${y})"><path d="${d}" ${attrs}/></g>`;
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

  // Mirrors draw-canvas.js's notehead shapes: 'x' for cymbals/hi-hat/ride,
  // 'circle' for the small open-hi-hat ring, else the usual oval.
  notehead: (p) => {
    if (p.shape === 'x') {
      return svgLine(p.x - 4, p.y - 4, p.x + 4, p.y + 4) + svgLine(p.x - 4, p.y + 4, p.x + 4, p.y - 4);
    }
    if (p.shape === 'circle') {
      return `<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="none" stroke="black"/>`;
    }
    const fill = p.filled ? 'black' : 'none';
    const stroke = p.filled ? 'none' : 'black';
    return `<ellipse cx="${p.x}" cy="${p.y}" rx="5" ry="4" fill="${fill}" stroke="${stroke}" transform="rotate(${(-0.4 * 180) / Math.PI} ${p.x} ${p.y})"/>`;
  },

  dot: (p) => `<circle cx="${p.x}" cy="${p.y}" r="1.5" fill="black"/>`,

  // Mirrors draw-canvas.js's tie arc, marking a note continued from the
  // previous bar.
  tie: (p) => `<path d="M ${p.x - 9} ${p.y} A 6 6 0 0 0 ${p.x + 3} ${p.y}" fill="none" stroke="black"/>`,

  clef: (p, theme) => svgGlyphPath(theme, CLEF_GLYPH[p.clef], p.x, p.y, CLEF_PATHS[p.clef], false, CLEF_FALLBACK[p.clef]),

  keyAccidental: (p, theme) => svgGlyphPath(theme, ACCIDENTAL_GLYPH[p.accidental], p.x, p.y, ACCIDENTAL_PATHS[p.accidental], false, ACCIDENTAL_FALLBACK[p.accidental]),

  accidental: (p, theme) => svgGlyphPath(theme, ACCIDENTAL_GLYPH[p.accidental], p.x, p.y, ACCIDENTAL_PATHS[p.accidental], false, ACCIDENTAL_FALLBACK[p.accidental]),

  timeSig: (p) => svgText(String(p.top), p.x, p.y - 10) + svgText(String(p.bottom), p.x, p.y + 2),

  rest: (p, theme) => {
    const base = REST_PATHS[p.base] ? p.base : 1;
    return svgGlyphPath(theme, REST_GLYPH[base], p.x, p.y, REST_PATHS[base], FILLED_RESTS.has(base), REST_LETTER_FALLBACK[base]);
  },

  flag: (p) => svgLine(p.x, p.y, p.x + 6, p.y + (p.up ? 8 : -8)),

  beam: (p) => svgLine(p.x1, p.y1, p.x2, p.y2),

  fretNumber: (p) => svgText(String(p.fret), p.x, p.string * 10),
};

function svgBody(primitives, theme) {
  return primitives.map((p) => {
    const draw = DRAWERS[p.type];
    return draw ? draw(p, theme) : '';
  }).join('');
}

// Accessible name/description for the whole document: <title>/<desc> plus role="img" and
// aria-labelledby, only for the parts opts supplies (no empty elements, no dangling ids).
function svgA11y(opts) {
  const ids = [];
  let inner = '';
  if (opts.title) { ids.push('svg-title'); inner += `<title id="svg-title">${escapeXML(opts.title)}</title>`; }
  if (opts.desc) { ids.push('svg-desc'); inner += `<desc id="svg-desc">${escapeXML(opts.desc)}</desc>`; }
  return { attrs: ids.length ? ` role="img" aria-labelledby="${ids.join(' ')}"` : '', inner };
}

function svgDoc(width, height, opts, body) {
  const a = svgA11y(opts);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"${a.attrs}>${a.inner}${body}</svg>`;
}

// Renders `primitives` (the same list drawPrimitives() consumes) as a standalone,
// self-contained SVG document string. `opts.width`/`opts.height` size the viewport;
// `opts.title`/`opts.desc` (optional) become an escaped <title>/<desc> for screen readers;
// unknown primitive types are skipped, matching drawPrimitives()'s own behavior.
export function drawSVG(primitives, theme, opts = {}) {
  return svgDoc(opts.width || 400, opts.height || 200, opts, svgBody(primitives, theme));
}

// Renders a whole sheet: `rows` are layoutSong()'s rows ({ y0, primitives }), each drawn in
// its own <g class="row"> translated down by y0 -- the same offset the canvas print path
// applies with ctx.translate -- so the file stacks rows exactly as the screen does.
export function drawSVGRows(rows, theme, opts = {}) {
  const body = rows.map((row) => `<g class="row" transform="translate(0 ${row.y0 || 0})">${svgBody(row.primitives, theme)}</g>`).join('');
  return svgDoc(opts.width || 400, opts.height || 200, opts, body);
}
