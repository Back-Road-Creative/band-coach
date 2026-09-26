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
import { layoutPercussionMeasure } from '../../notation/percussion.js';

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

// One bar's {midi, dur, onset, id, tied} list (dur/onset in quarter-note
// units, what layoutMeasure expects -- onset is beats from this bar's own
// start). Unlike a single-voice cursor walk, this keeps every note that
// sounds during the bar at its OWN onset, so two notes sharing an onset (a
// chord) both survive at the same onset and a held note under a moving line
// keeps its own position rather than being displaced by later notes. A note
// that began in an EARLIER bar (crosses the barline) is kept too, clipped to
// this bar's start, at onset 0, `tied: true` -- a continuation, not a fresh
// attack, and never silently dropped. A note running past this bar's end is
// clipped to it for this display only, same convention as
// src/ui/editor/layout-song.js's own barNotes() -- but that module's own
// notes/indexMap are a DIFFERENT (whole-song-part) shape and are not shared
// with this one. Rests fill only the gaps left uncovered by every note
// together (found by merging their [start, end) ranges), not gaps in any one
// voice, so a beat already sounding from a held note gets no rest under it.
export function barNoteList(notes, barStart, barEnd, tpq) {
  const overlapping = notes
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => n.start < barEnd && n.start + n.dur > barStart);

  const events = overlapping.map(({ n, i }) => {
    const tied = n.start < barStart;
    const clipStart = tied ? barStart : n.start;
    const clipEnd = Math.min(n.start + n.dur, barEnd);
    return {
      midi: n.midi, dur: (clipEnd - clipStart) / tpq, onset: (clipStart - barStart) / tpq,
      id: n.id !== undefined ? n.id : i, tied, _start: clipStart, _end: clipEnd,
    };
  });

  // Merge covered tick ranges (they may overlap -- a chord, or a held note
  // under moving ones) to find the real silences to fill with rests.
  const ranges = events.map((e) => [e._start, e._end]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  const rests = [];
  let cursor = barStart;
  for (const [s, e] of merged) {
    if (s > cursor) rests.push({ midi: null, dur: (s - cursor) / tpq, onset: (cursor - barStart) / tpq });
    cursor = Math.max(cursor, e);
  }
  if (cursor < barEnd) rests.push({ midi: null, dur: (barEnd - cursor) / tpq, onset: (cursor - barStart) / tpq });

  return events.concat(rests)
    .map(({ _start, _end, ...rest }) => rest)
    .sort((a, b) => a.onset - b.onset);
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
    const barBeats = metre.num * (4 / metre.den);
    const barNotes = barNoteList(step.notes, barStart, barEnd, tpq)
      .map((n) => (n.midi === null ? n : { ...n, midi: writtenMidi(instrument, n.midi) }));
    const { primitives } = layoutMeasure({
      clef, key: writtenKey, time: [metre.num, metre.den], width: CANVAS_WIDTH, barBeats,
      notes: barNotes.length ? barNotes : [{ midi: null, dur: barBeats, onset: 0 }],
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

// Plain-words name for a percussion piece id -- 'hihat-closed' -> 'hi-hat
// closed' -- read out by the canvas's aria-label the same way staffView's
// note letters are.
function piecePrettyName(pieceId) {
  return pieceId.replace('hihat', 'hi-hat').replace(/-/g, ' ');
}

// kitView(song, step) -> { kind: 'kit', rows: [{ primitives, y0 }], height,
// label }. A percussion step's own drum-kit staff, one row per bar, drawn
// via the shared percussion notation layer (src/notation/percussion.js) the
// same way staffView() above uses the pitched one -- unlike staffView, there
// is no clef/key/transposition to resolve (a drum piece is not a pitch), so
// this reads only step.notes' own `.piece`. Capped at MAX_BARS bars for the
// same reason staffView is.
export function kitView(song, step) {
  const tpq = song.ticksPerQuarter;
  const boundaries = barsOf(song);
  const [from, rawTo] = step.bars;
  const lastBar = Math.min(rawTo, boundaries.length - 2);
  const capped = lastBar - from + 1 > MAX_BARS;
  const to = capped ? from + MAX_BARS - 1 : lastBar;

  const rowHeight = ROW_HEIGHT_SINGLE;
  const rows = [];
  const barLabels = [];

  for (let bar = from; bar <= to; bar++) {
    const barStart = boundaries[bar];
    const barEnd = boundaries[bar + 1];
    const metre = metreAt(song, boundaries, bar);
    const barHits = step.notes
      .filter((n) => n.piece && n.start >= barStart && n.start < barEnd)
      .sort((a, b) => a.start - b.start)
      .map((n) => ({ piece: n.piece, start: (n.start - barStart) / tpq }));
    const { primitives } = layoutPercussionMeasure({ hits: barHits, time: [metre.num, metre.den], width: CANVAS_WIDTH });
    rows.push({ primitives, y0: (bar - from) * rowHeight });
    barLabels.push(barHits.map((h) => piecePrettyName(h.piece)).join(' '));
  }

  const label = 'Bars ' + (from + 1) + '-' + (to + 1) + ', percussion staff: '
    + barLabels.join(', ') + (capped ? ' (first 16 bars shown)' : '');

  return { kind: 'kit', rows, height: rows.length * rowHeight, label };
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
  // Tab views (P4-9) carry a saved capo alongside the kind, so a test (or a
  // learner's own inspection) can see which capo the diagram it is looking
  // at was drawn for without re-parsing the label text.
  if (view.capo !== undefined) wrap.setAttribute('data-capo', String(view.capo));
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

// P4-9 -- tab and fingering row: drawn from the arrangement's `placements`
// (src/song/arrange/index.js), one per note, keyed by that note's position
// in `fitNotes` (practice.plan.fit.notes, the WHOLE fitted part). A step's
// own `notes` is a time slice of that same array built by lesson.js's
// segment()/buildLessonPlan() with `.filter()` alone (never `.map()`), so a
// step note is the SAME object reference as its element of `fitNotes` --
// matching by identity here is exact and robust to two notes sharing both
// start and pitch, which the plan's fallback (matching by start+midi) is
// not.
function placementFor(note, fitNotes, arrangement) {
  const index = fitNotes.indexOf(note);
  return index === -1 ? null : arrangement.placements.get(index);
}

const TAB_STRING_GAP = 10;
const TAB_MARGIN_X = 20;
const TAB_NOTE_SPACING = 26;
const TAB_ROW_MARGIN_X = 10; // right-hand margin so a fret number's own glyph width stays inside the canvas
// How many notes fit on one row before the next one's fret number would run
// past the canvas's right edge -- a dense bar (or a long multibar phrase)
// wraps into extra rows rather than overrunning it (A6).
const TAB_NOTES_PER_ROW = Math.floor((CANVAS_WIDTH - TAB_MARGIN_X - TAB_ROW_MARGIN_X) / TAB_NOTE_SPACING) + 1;

// tabView(step, arrangement, instrument, fitNotes) -> { kind: 'tab', rows,
// height, label, capo, blankCount }. Each row draws its own string lines (one
// `line` primitive per string) plus one `fretNumber` primitive per placed
// note -- NOT tab.js's layoutTab(), which picks its own frets from a raw
// tuning and knows nothing of a saved capo or alternate tuning. Strings are
// numbered 1 = highest (the standard tab-staff convention, the OPPOSITE of
// fretboard.js's own stringIndex, which counts 0 = lowest, and of the
// fingerings panel's "string N" in src/ui/fingerings/how.js, which is
// stringIndex + 1 = 1 = lowest) -- P4-9's own convention, chosen to match
// how a guitarist reads a tab on paper, not how.js's device-facing one. A bar
// with more than TAB_NOTES_PER_ROW notes wraps into extra rows (each its own
// full set of string lines) rather than letting fret numbers run off the
// fixed-width canvas (A6) -- renderStepView() already draws every row in
// turn, so a wrapped tab needs no change there.
export function tabView(step, arrangement, instrument, fitNotes) {
  const stringCount = instrument.tuning.length;
  const rowHeight = (stringCount + 1) * TAB_STRING_GAP;
  const labelParts = [];
  let blankCount = 0;
  let maxRow = 0;
  const byRow = [];
  step.notes.forEach((note, i) => {
    const placement = placementFor(note, fitNotes, arrangement);
    if (!placement) { blankCount++; return; }
    const displayString = stringCount - placement.string;
    const row = Math.floor(i / TAB_NOTES_PER_ROW);
    const col = i % TAB_NOTES_PER_ROW;
    maxRow = Math.max(maxRow, row);
    (byRow[row] || (byRow[row] = [])).push({ type: 'fretNumber', x: TAB_MARGIN_X + col * TAB_NOTE_SPACING, string: displayString, fret: placement.fret });
    labelParts.push('string ' + displayString + ' fret ' + placement.fret);
  });
  const rows = [];
  for (let r = 0; r <= maxRow; r++) {
    const primitives = [];
    for (let s = 1; s <= stringCount; s++) primitives.push({ type: 'line', x: 0, y: s * TAB_STRING_GAP, length: CANVAS_WIDTH });
    for (const p of byRow[r] || []) primitives.push(p);
    rows.push({ primitives, y0: r * rowHeight });
  }
  const capo = arrangement.capo || 0;
  let label = 'Tab' + (capo ? ', capo ' + capo : '') + ': ' + labelParts.join(', ');
  if (blankCount) label += ' (' + blankCount + ' note' + (blankCount === 1 ? '' : 's') + ' with no comfortable fingering)';
  return { kind: 'tab', rows, height: rows.length * rowHeight, label, capo, blankCount };
}

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return n + 'th';
  const mod10 = n % 10;
  if (mod10 === 1) return n + 'st';
  if (mod10 === 2) return n + 'nd';
  if (mod10 === 3) return n + 'rd';
  return n + 'th';
}

// Bowed strings (violin/viola/cello/double-bass) have no fret diagram to
// draw, so this is a plain-words line grouped by string+position runs (a
// beginner phrase rarely shifts position note-to-note): "A string, 1st
// position: 1 2 0". The string's own name is spelled off its open pitch
// (instrument.tuning) rather than kept as separate data -- every bowed
// instrument's open strings are natural notes, so a plain 'C' key spelling
// is always the right letter with no accidental.
function bowedLine(step, arrangement, instrument, fitNotes) {
  const tuning = instrument.tuning;
  const segments = [];
  let blankCount = 0;
  step.notes.forEach((note) => {
    const placement = placementFor(note, fitNotes, arrangement);
    if (!placement) { blankCount++; return; }
    const last = segments[segments.length - 1];
    if (last && last.string === placement.string && last.position === placement.position) last.fingers.push(placement.finger);
    else segments.push({ string: placement.string, position: placement.position, fingers: [placement.finger] });
  });
  if (!segments.length) return null;
  const text = segments.map((seg) => {
    const name = prettyLetter(spellMidi(tuning[seg.string], 'C'));
    return name + ' string, ' + ordinal(seg.position) + ' position: ' + seg.fingers.join(' ');
  }).join('; ');
  return { text, blankCount };
}

// Keyboard: right- and left-hand finger numbers, in playing order, one
// clause per hand actually used in this step.
function keysLine(step, arrangement, fitNotes) {
  const rh = [];
  const lh = [];
  let blankCount = 0;
  step.notes.forEach((note) => {
    const placement = placementFor(note, fitNotes, arrangement);
    if (!placement) { blankCount++; return; }
    (placement.hand === 'lh' ? lh : rh).push(placement.finger);
  });
  const parts = [];
  if (rh.length) parts.push('Right hand: ' + rh.join(' '));
  if (lh.length) parts.push('Left hand: ' + lh.join(' '));
  if (!parts.length) return null;
  return { text: parts.join('. ') + '.', blankCount };
}

// Harmonica: "Blow 4, Draw 4, Blow 4 …" -- a bent note's own action is
// already named 'bend' by arrangeHarmonica (src/song/arrange/harmonica.js),
// so it reads e.g. "Bend 4" with no separate wording needed here.
function harmonicaLine(step, arrangement, fitNotes) {
  const parts = [];
  let blankCount = 0;
  step.notes.forEach((note) => {
    const placement = placementFor(note, fitNotes, arrangement);
    if (!placement) { blankCount++; return; }
    parts.push(placement.action.charAt(0).toUpperCase() + placement.action.slice(1) + ' ' + placement.hole);
  });
  if (!parts.length) return null;
  return { text: parts.join(', '), blankCount };
}

// fingeringLine(step, arrangement, instrument, fitNotes) -> { text,
// blankCount } | null. Only the three families with a placement but no
// fret diagram of their own have anything to say here; fretted uses
// tabView() above instead, and wind/brass/percussion/voice have neither
// (their arrangementText() summary line, songs.js, already covers them).
export function fingeringLine(step, arrangement, instrument, fitNotes) {
  if (arrangement.family === 'bowed') return bowedLine(step, arrangement, instrument, fitNotes);
  if (arrangement.family === 'keys') return keysLine(step, arrangement, fitNotes);
  if (arrangement.family === 'free-reed') return harmonicaLine(step, arrangement, fitNotes);
  return null;
}
