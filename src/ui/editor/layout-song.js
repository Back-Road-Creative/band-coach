// Turns one part of a Song (the shared shape, src/song/model.js) into staff
// notation using the existing pure notation engine (src/notation/layout.js),
// one bar per row so a phone-width screen only ever scrolls vertically, plus
// a parallel list of hit boxes mapping each drawn notehead/rest back to its
// index into `song.parts[partIndex].notes` -- feed those straight into
// `hitTest` from src/song/edit.js.
//
// Pure: no DOM, no canvas context, nothing but arrays and numbers in and out
// (drawing them is draw-canvas.js's job, given the `primitives` this
// produces).
import { layoutMeasure } from '../../notation/layout.js';

const DEFAULT_BAR_WIDTH = 260;
const ROW_HEIGHT_SINGLE = 100;
const ROW_HEIGHT_GRAND = 200;
const HIT_BOX_SIZE = 16;

function ticksPerBar(song) {
  return song.metre.num * (4 / song.metre.den) * song.ticksPerQuarter;
}

// One bar's worth of {midi, dur} entries (dur in quarter-note units, what
// layoutMeasure expects) for notes starting in [barStart, barEnd), with a
// rest inserted for every gap. `indexMap` parallels `out` 1:1, giving the
// original note index for each entry (null for an inserted rest).
//
// A note that runs past the barline is clipped to the bar for this display
// only -- the note itself is untouched. That keeps the picture sane; making
// it read correctly (a tied pair) is what `splitNote` (src/song/edit.js) is
// for, and this module does not call it on the caller's behalf.
function barNotes(notes, barStart, barEnd, tpq) {
  const out = [];
  const indexMap = [];
  let cursor = barStart;
  notes.forEach((n, i) => {
    if (n.start < barStart || n.start >= barEnd) return;
    if (n.start > cursor) {
      out.push({ midi: null, dur: (n.start - cursor) / tpq });
      indexMap.push(null);
    }
    const end = Math.min(n.start + n.dur, barEnd);
    if (end > n.start) {
      out.push({ midi: n.midi, dur: (end - n.start) / tpq });
      indexMap.push(i);
      cursor = end;
    }
  });
  if (cursor < barEnd) {
    out.push({ midi: null, dur: (barEnd - cursor) / tpq });
    indexMap.push(null);
  }
  return { out, indexMap };
}

/**
 * song, partIndex -> { rows: [{ primitives, y0, barIndex }], barCount,
 * rowHeight, hitboxes: [{ noteIndex, x, y, w, h }] }.
 * `opts.clef` ('treble'|'bass'|'alto'|'tenor'|'grand'), `opts.key` (a key
 * name layoutMeasure/spellMidi understand, e.g. 'C', 'F#', 'Bbm') and
 * `opts.width` (pixels per bar) default to a plain treble staff in C.
 */
export function layoutSong(song, partIndex, opts = {}) {
  const clef = opts.clef || 'treble';
  const key = opts.key || 'C';
  const width = opts.width || DEFAULT_BAR_WIDTH;
  const part = song.parts[partIndex];
  const notes = (part && part.notes) || [];
  const tpq = song.ticksPerQuarter;
  const barTicks = ticksPerBar(song);
  const lastEnd = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  const barCount = Math.max(1, Math.ceil(lastEnd / barTicks));
  const rowHeight = clef === 'grand' ? ROW_HEIGHT_GRAND : ROW_HEIGHT_SINGLE;
  const emptyBarDur = song.metre.num * (4 / song.metre.den);

  const rows = [];
  const hitboxes = [];

  for (let b = 0; b < barCount; b++) {
    const barStart = b * barTicks;
    const barEnd = barStart + barTicks;
    const { out, indexMap } = barNotes(notes, barStart, barEnd, tpq);
    const barNoteList = out.length ? out : [{ midi: null, dur: emptyBarDur }];
    const { primitives } = layoutMeasure({
      clef,
      key,
      time: [song.metre.num, song.metre.den],
      width,
      notes: barNoteList,
    });
    const y0 = b * rowHeight;
    rows.push({ primitives, y0, barIndex: b });

    // layoutMeasure emits exactly one 'notehead' or 'rest' primitive per
    // input note, in the same order (see layout.js's main notes loop) -- so
    // walking those primitives in order lines up 1:1 with `indexMap`.
    let cursor = 0;
    primitives.forEach((p) => {
      if (p.type !== 'notehead' && p.type !== 'rest') return;
      const noteIndex = indexMap[cursor];
      cursor++;
      if (noteIndex === null) return;
      hitboxes.push({
        noteIndex,
        x: p.x - HIT_BOX_SIZE / 2,
        y: y0 + p.y - HIT_BOX_SIZE / 2,
        w: HIT_BOX_SIZE,
        h: HIT_BOX_SIZE,
      });
    });
  }

  return { rows, barCount, rowHeight, hitboxes };
}
