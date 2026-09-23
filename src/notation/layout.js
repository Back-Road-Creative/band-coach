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
export function layoutMeasure({ clef, key, time, notes, width }) {
  const [num, den] = time;
  const grand = clef === 'grand';
  const staves = grand ? ['treble', 'bass'] : [clef];
  const altered = keyAccidentals(key);

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
  const totalBeats = notes.reduce((sum, n) => sum + n.dur, 0) || 1;

  const barState = { treble: {}, bass: {} };
  let onset = 0;
  for (const note of notes) {
    const info = durationInfo(note.dur);
    const nx = notesStartX + (onset / totalBeats) * (notesEndX - notesStartX);
    onset += note.dur;

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
