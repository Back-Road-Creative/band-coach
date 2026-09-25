// Staff view of the current practice step (P4-8, plan §4 P4-8): between the
// step title and "Play it", the step's own bars drawn on the instrument's
// own clef (grand for keyboard), in written pitch and written key. `staffView`
// is pure -- it reads the step's bars and notes plus the arranged song's
// metre/key/metreChanges/keyChanges, and hands each bar to the shared
// notation engine (src/notation/layout.js) the same way
// src/ui/editor/layout-song.js does for the editor's own staff. Drawing is
// draw-canvas.js's job (renderStepView() below only owns the canvas element
// and translating each row into place); a transposing instrument's own
// "written a tone higher" caption is already shown above the step title by
// renderPractice()'s existing arrangementLine (P4-7) -- this view's own text
// alternative is its canvas's aria-label, read out by staffView()'s `label`.
//
// `arrangement` is accepted (matching the practice screen's own wiring,
// P4-7) but not read here: every pitch/clef fact this view needs comes
// straight from `instrument` and the (possibly voice-moved) `song.key` --
// see writtenMidi/writtenKeyName below.
import { barsOf } from '../../song/model.js';
import { layoutMeasure } from '../../notation/layout.js';
import { spellMidi } from '../../notation/spell.js';
import { drawPrimitives } from '../../notation/draw-canvas.js';
import { writtenMidi, writtenKeyName } from '../../song/arrange/transposing.js';

const MAX_BARS = 16;
const ROW_HEIGHT_SINGLE = 100;
const ROW_HEIGHT_GRAND = 200;
const CANVAS_WIDTH = 340;

const CLEF_NAME = {
  treble: 'treble staff', bass: 'bass staff', alto: 'alto staff', tenor: 'tenor staff',
  grand: 'grand staff', percussion: 'percussion staff',
};

function clefFor(instrument) {
  return instrument.clefs.indexOf('grand') >= 0 ? 'grand' : instrument.clefs[0];
}

// The metre/key in force at bar boundaries[i] -- same "last change at or
// before this bar's start wins" convention as src/song/export-musicxml.js's
// own (private) metreAt/keyAt, kept here too since neither is exported.
function metreAt(song, boundaries, i) {
  const mStart = boundaries[i];
  let metre = song.metre;
  for (const c of song.metreChanges || []) { if (c.tick <= mStart) metre = { num: c.num, den: c.den }; }
  return metre;
}
function keyAt(song, boundaries, i) {
  const mStart = boundaries[i];
  let key = song.key || { tonic: 0, mode: 'major' };
  for (const c of song.keyChanges || []) { if (c.tick <= mStart) key = { tonic: c.tonic, mode: c.mode }; }
  return key;
}

// 'D' -> 'D major', 'Bbm' -> 'B♭ minor' -- the same names spell.js's key
// names always use, in the plain sharp/flat glyphs a screen reader announces
// clearly (spell.js's own accidental letters are ASCII, kept ASCII there so
// they double as object-key lookups).
function humanKeyName(name) {
  const minor = name.endsWith('m');
  const core = minor ? name.slice(0, -1) : name;
  return core.replace('#', '♯').replace('b', '♭') + (minor ? ' minor' : ' major');
}

function prettyLetter(spelled) {
  return spelled.letter + (spelled.accidental === '#' ? '♯' : spelled.accidental === 'b' ? '♭' : '');
}

// One bar's {midi, dur} list (dur in quarter-note units, what layoutMeasure
// expects), rests filling every gap and a note crossing the barline clipped
// to it for this display only -- same convention as
// src/ui/editor/layout-song.js's own barNotes(), but built from the step's
// own already-arranged notes rather than a whole song part.
function barNoteList(notes, barStart, barEnd, tpq) {
  const out = [];
  let cursor = barStart;
  const inBar = notes.filter((n) => n.start >= barStart && n.start < barEnd).sort((a, b) => a.start - b.start);
  for (const n of inBar) {
    if (n.start > cursor) out.push({ midi: null, dur: (n.start - cursor) / tpq });
    const end = Math.min(n.start + n.dur, barEnd);
    if (end > n.start) { out.push({ midi: n.midi, dur: (end - n.start) / tpq }); cursor = end; }
  }
  if (cursor < barEnd) out.push({ midi: null, dur: (barEnd - cursor) / tpq });
  return out;
}

// staffView(song, step, instrument, arrangement) -> { kind: 'staff', rows:
// [{ primitives, y0 }], height, label }. `song` is the ARRANGED song
// (practice.song), `step` one of practice.plan.steps (its bars are
// zero-based, step.bars = [first, last], both inclusive). Capped at
// MAX_BARS bars so a whole-piece step never draws an unbounded canvas.
export function staffView(song, step, instrument, arrangement) {
  void arrangement;
  const tpq = song.ticksPerQuarter;
  const boundaries = barsOf(song);
  const clef = clefFor(instrument);
  const [from, rawTo] = step.bars;
  const lastBar = Math.min(rawTo, boundaries.length - 2);
  const capped = lastBar - from + 1 > MAX_BARS;
  const to = capped ? from + MAX_BARS - 1 : lastBar;

  const rowHeight = clef === 'grand' ? ROW_HEIGHT_GRAND : ROW_HEIGHT_SINGLE;
  const rows = [];
  const barLabels = [];

  for (let bar = from; bar <= to; bar++) {
    const barStart = boundaries[bar];
    const barEnd = boundaries[bar + 1];
    const metre = metreAt(song, boundaries, bar);
    const key = keyAt(song, boundaries, bar);
    const writtenKey = writtenKeyName(instrument, key);
    const barNotes = barNoteList(step.notes, barStart, barEnd, tpq)
      .map((n) => (n.midi === null ? n : { ...n, midi: writtenMidi(instrument, n.midi) }));
    const { primitives } = layoutMeasure({
      clef, key: writtenKey, time: [metre.num, metre.den], width: CANVAS_WIDTH,
      notes: barNotes.length ? barNotes : [{ midi: null, dur: metre.num * (4 / metre.den) }],
    });
    rows.push({ primitives, y0: (bar - from) * rowHeight });
    const names = barNotes.filter((n) => n.midi !== null).map((n) => prettyLetter(spellMidi(n.midi, writtenKey)));
    barLabels.push(names.join(' '));
  }

  const firstWrittenKey = writtenKeyName(instrument, keyAt(song, boundaries, from));
  const label = 'Bars ' + (from + 1) + '-' + (to + 1) + ', ' + (CLEF_NAME[clef] || clef) + ', '
    + humanKeyName(firstWrittenKey) + ': ' + barLabels.join(', ') + (capped ? ' (first 16 bars shown)' : '');

  return { kind: 'staff', rows, height: rows.length * rowHeight, label };
}

// Draws `view` (staffView()'s result) onto one canvas inside a fresh
// div.panel-songs-view, appended to `container`. The canvas keeps a fixed
// internal pixel width -- styles.css scales it down to fit (canvas { width:
// 100% }) so layoutMeasure's own pixel maths stay simple regardless of
// screen size, per styles.css's "no horizontal scroll at 390px" rule.
export function renderStepView(container, view) {
  const wrap = document.createElement('div');
  wrap.className = 'panel-songs-view';
  wrap.setAttribute('data-view', view.kind);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', view.label);
  canvas.width = CANVAS_WIDTH;
  canvas.height = view.height;
  const ctx = canvas.getContext('2d');
  view.rows.forEach((row) => {
    ctx.save();
    ctx.translate(0, row.y0);
    drawPrimitives(ctx, row.primitives, {});
    ctx.restore();
  });
  wrap.appendChild(canvas);
  container.appendChild(wrap);
  return wrap;
}
