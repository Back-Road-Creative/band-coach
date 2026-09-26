// Turns a measure of notes into plain drawing primitives (no beaming and no
// tab in this module — see tab.js for tab, and the module doc for beaming).

import { spellMidi } from './spell.js';
import { staffPosition, ledgerLines, needsAccidental } from './staff.js';
import { keyAccidentals } from './spell.js';

const LINE_GAP = 10;
const STEP = LINE_GAP / 2; // pixels per staffPosition unit
const STEM_LENGTH = 7 * STEP;
const MIDDLE_LINE_POSITION = 4;

const DURATION_STEPS = [4, 2, 1, 0.5, 0.25, 0.125];

function durationInfo(dur) {
  let matched = DURATION_STEPS.find((p) => Math.abs(p - dur) < 1e-9);
  let dotted = false;
  if (matched === undefined) {
    matched = DURATION_STEPS.find((p) => Math.abs(p * 1.5 - dur) < 1e-9);
    if (matched !== undefined) dotted = true;
  }
  const base = matched === undefined ? dur : matched;
  return {
    filled: base < 2,
    hasStem: base < 4,
    flags: base < 1 ? Math.round(Math.log2(1 / base)) : 0,
    dotted,
    base, // undotted duration (4/2/1/0.5/0.25/0.125): picks which rest glyph a 'rest' primitive draws
  };
}

function positionToY(staffBottomY, position) {
  return staffBottomY - position * STEP;
}

function staffLines(primitives, x0, x1, bottomY) {
  for (let i = 0; i < 5; i++) {
    primitives.push({ type: 'line', x: x0, y: positionToY(bottomY, i * 2), length: x1 - x0 });
  }
}

// One measure on a single clef, or a grand staff (clef: 'grand').
//
// Each note is normally placed by a single cumulative walk (`onset` starts at
// 0 and advances by each note's own `dur` in turn), which only ever produces
// one voice's worth of x positions -- fine for a plain melody but wrong for
// a chord (two notes starting together must share an x) or a held note under
// a moving line (its x must stay where it started, not drift with every
// later note). A caller that already knows each note's own onset (beats from
// the bar start -- src/ui/songs/step-view.js does, via its barNoteList()) may
// pass it directly as `note.onset`, alongside `barBeats` (the bar's total
// length in beats, since with overlapping notes the notes' own durations no
// longer sum to it). Neither is required: omitting both keeps the original
// cumulative walk byte-for-byte, so every other caller (src/ui/editor/layout-song.js,
// src/notation/percussion.js, src/notation/for-instrument.js, src/ui/theory.js)
// needs no change.
export function layoutMeasure({ clef, key, time, notes, width, barBeats }) {
  const [num, den] = time;
  const grand = clef === 'grand';
  const staves = grand ? ['treble', 'bass'] : [clef];
  // Percussion has no pitch, so no key signature and no accidentals.
  const altered = clef === 'percussion' ? [] : keyAccidentals(key);

  const primitives = [];

  const staffBottomY = {};
  const TOP_MARGIN = 30;
  const STAFF_HEIGHT = 8 * STEP; // bottom line to top line
  const STAFF_GAP = 60;
  if (grand) {
    staffBottomY.treble = TOP_MARGIN + STAFF_HEIGHT;
    staffBottomY.bass = staffBottomY.treble + STAFF_GAP + STAFF_HEIGHT;
  } else {
    staffBottomY[clef] = TOP_MARGIN + STAFF_HEIGHT;
  }

  const x0 = 10;
  const x1 = width - 10;

  for (const s of staves) staffLines(primitives, x0, x1, staffBottomY[s]);

  // Clef, key signature and time signature reserve left-hand space per staff.
  let cursorX = x0 + 6;
  for (const s of staves) {
    primitives.push({ type: 'clef', x: cursorX, y: staffBottomY[s], clef: s });
  }
  cursorX += 24;

  const keySigStartX = cursorX;
  for (const s of staves) {
    let ax = keySigStartX;
    for (const a of altered) {
      const pos = staffPosition({ letter: a.letter, octave: s === 'bass' ? 3 : 4 }, s);
      primitives.push({
        type: 'keyAccidental', x: ax, y: positionToY(staffBottomY[s], pos),
        accidental: a.accidental, letter: a.letter,
      });
      ax += 8;
    }
  }
  cursorX = keySigStartX + altered.length * 8 + (altered.length ? 6 : 0);

  const timeSigX = cursorX;
  for (const s of staves) {
    primitives.push({ type: 'timeSig', x: timeSigX, y: staffBottomY[s], top: num, bottom: den });
  }
  cursorX += 22;

  const notesStartX = cursorX + 10;
  const notesEndX = x1 - 12;
  const totalBeats = barBeats || (notes.reduce((sum, n) => sum + n.dur, 0) || 1);

  const barState = { treble: {}, bass: {} };
  let onset = 0;
  for (const note of notes) {
    const info = durationInfo(note.dur);
    const noteOnset = note.onset !== undefined ? note.onset : onset;
    const nx = notesStartX + (noteOnset / totalBeats) * (notesEndX - notesStartX);
    onset += note.dur;

    // A percussion hit (or a stacked chord of hits, e.g. kick + hi-hat on the
    // same beat): note.perc.hits carries one { position, notehead, stem, mark }
    // per piece sounding at this onset (from src/notation/percussion.js).
    // Simplification: a chord shares one stem rather than a per-voice stem.
    if (note.perc) {
      const s = clef; // percussion measures are never a grand staff
      for (const hit of note.perc.hits) {
        const position = staffPosition(hit, 'percussion');
        const y = positionToY(staffBottomY[s], position);
        primitives.push({ type: 'notehead', x: nx, y, filled: info.filled, shape: hit.notehead });
        if (hit.mark === 'open') primitives.push({ type: 'notehead', x: nx, y: y - 10, filled: false, shape: 'circle' });
        for (const ledgerPos of ledgerLines(position)) {
          primitives.push({ type: 'ledger', x: nx, y: positionToY(staffBottomY[s], ledgerPos), length: LINE_GAP * 1.6 });
        }
      }
      if (info.hasStem) {
        const up = note.perc.stem !== 'down';
        const positions = note.perc.hits.map((hit) => staffPosition(hit, 'percussion'));
        const stemPosition = up ? Math.min(...positions) : Math.max(...positions);
        const y = positionToY(staffBottomY[s], stemPosition);
        const y2 = up ? y - STEM_LENGTH : y + STEM_LENGTH;
        primitives.push({ type: 'stem', x: nx, y1: y, y2, up });
        for (let f = 0; f < info.flags; f++) {
          primitives.push({ type: 'flag', x: nx, y: y2 + (up ? f * STEP : -f * STEP), up });
        }
      }
      continue;
    }

    if (note.midi === null) {
      const s = grand ? 'treble' : clef;
      const y = staffBottomY[s] - MIDDLE_LINE_POSITION * STEP;
      primitives.push({ type: 'rest', x: nx, y, dur: note.dur, base: info.base });
      if (info.dotted) primitives.push({ type: 'dot', x: nx + 8, y });
      continue;
    }

    const s = grand ? (note.midi >= 60 ? 'treble' : 'bass') : clef;
    const spelled = spellMidi(note.midi, key);
    const position = staffPosition(spelled, s);
    const y = positionToY(staffBottomY[s], position);

    primitives.push({ type: 'notehead', x: nx, y, filled: info.filled });

    // A note already sounding when this bar started (step-view.js's
    // barNoteList() marks it `tied`) draws a small continuation arc to its
    // left instead of being drawn as a fresh attack -- the note is not
    // dropped, but it must not read as a new onset either.
    if (note.tied) primitives.push({ type: 'tie', x: nx, y });

    for (const ledgerPos of ledgerLines(position)) {
      primitives.push({ type: 'ledger', x: nx, y: positionToY(staffBottomY[s], ledgerPos), length: LINE_GAP * 1.6 });
    }

    if (needsAccidental(spelled, key, barState[s])) {
      primitives.push({ type: 'accidental', x: nx - 10, y, accidental: spelled.accidental });
    }

    if (info.hasStem) {
      const up = position < MIDDLE_LINE_POSITION;
      const y2 = up ? y - STEM_LENGTH : y + STEM_LENGTH;
      primitives.push({ type: 'stem', x: nx, y1: y, y2, up });
      for (let f = 0; f < info.flags; f++) {
        primitives.push({ type: 'flag', x: nx, y: y2 + (up ? f * STEP : -f * STEP), up });
      }
    }

    if (info.dotted) {
      const dotPosition = position % 2 === 0 ? position + 1 : position;
      primitives.push({ type: 'dot', x: nx + 8, y: positionToY(staffBottomY[s], dotPosition) });
    }
  }

  const barlineY1 = grand ? TOP_MARGIN : TOP_MARGIN;
  const barlineY2 = grand ? staffBottomY.bass : staffBottomY[clef];
  primitives.push({ type: 'barline', x: x1, y1: barlineY1, y2: barlineY2 });

  return { primitives };
}
