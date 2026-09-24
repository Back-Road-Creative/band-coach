// Pure percussion-staff layer: turns drum-kit piece ids into notes layout.js's
// layoutMeasure() can draw on the 'percussion' clef. No DOM, no AudioContext --
// a later drum-kit trainer unit calls layoutPercussionMeasure() and hands the
// resulting primitives to draw-canvas.js / draw-svg.js exactly like any other
// measure.

import { layoutMeasure } from './layout.js';

// Standard 5-line drum-key staff placement. `position` is in staff.js's own
// step units (staffPosition()'s return value: 0/2/4/6/8 = the five lines,
// bottom to top; odd numbers are the spaces between/around them; negative or
// >8 is below/above the staff). These numbers were derived once by computing
// staffPosition({letter, octave}, 'treble') for the named landmark pitch next
// to each slot below, then hard-coded here -- a drum piece isn't a real pitch,
// so there's nothing to spell or key-signature at draw time.
export const PERCUSSION_SLOTS = {
  'hihat-pedal': { position: -1, notehead: 'oval', stem: 'down' }, // space below the staff (D4)
  kick: { position: 1, notehead: 'oval', stem: 'down' }, // first space (F4)
  'tom-floor': { position: 3, notehead: 'oval', stem: 'up' }, // second space (A4)
  snare: { position: 5, notehead: 'oval', stem: 'up' }, // third space (C5)
  'tom-mid': { position: 6, notehead: 'oval', stem: 'up' }, // fourth line (D5)
  'tom-high': { position: 7, notehead: 'oval', stem: 'up' }, // fourth space (E5)
  ride: { position: 8, notehead: 'x', stem: 'up' }, // fifth line (F5)
  'hihat-closed': { position: 9, notehead: 'x', stem: 'up' }, // space above the staff (G5)
  'hihat-open': { position: 9, notehead: 'x', stem: 'up', mark: 'open' }, // same slot as closed, plus an open marker
  crash: { position: 10, notehead: 'x', stem: 'up' }, // first ledger line above the staff (A5)
};

// The contract's canonical piece-id order (do not rename these ids -- a
// sibling drum-kit trainer unit codes directly against them).
export const PIECE_IDS = [
  'kick', 'snare', 'hihat-closed', 'hihat-pedal', 'hihat-open',
  'tom-floor', 'tom-mid', 'tom-high', 'crash', 'ride',
];

function slotOrThrow(pieceId) {
  const slot = PERCUSSION_SLOTS[pieceId];
  if (!slot) throw new Error(`unknown percussion piece: ${pieceId}`);
  return slot;
}

// A chord (several pieces sounding at the same onset, e.g. kick + closed
// hi-hat on beat 1) is rendered stacked on a single shared stem -- the
// simpler of the two options; independent per-voice stems (hands vs. feet)
// are out of scope here. The shared stem points down only when every piece
// in the chord is itself stem-down (kick and/or hihat-pedal alone); any hand
// piece present pulls the stem up.
function stemForHits(hits) {
  return hits.every((h) => h.stem === 'down') ? 'down' : 'up';
}

// One percussion hit as a layoutMeasure() note: { midi: null, dur, perc }.
// `perc.hits` is always an array (length 1 here) so layout.js has one shape
// to handle whether a note is a single hit or a stacked chord.
export function percussionNote(pieceId, dur) {
  const slot = slotOrThrow(pieceId);
  const hit = { piece: pieceId, ...slot };
  return { midi: null, dur, perc: { hits: [hit], stem: stemForHits([hit]) } };
}

// hits: [{ piece, start (beats from bar start), duration }]. Several hits
// sharing a `start` become one stacked chord (see stemForHits above). Beats
// are in the same units layoutMeasure() already uses for `dur` (a quarter
// note is 1, matching tests/unit/notation/layout.test.mjs's existing notes).
// `time` is the measure's [numerator, denominator] (denominator 4 assumed,
// matching every other caller of layoutMeasure in this codebase).
export function layoutPercussionMeasure({ hits, time, width }) {
  const byStart = new Map();
  for (const hit of hits) {
    if (!byStart.has(hit.start)) byStart.set(hit.start, []);
    byStart.get(hit.start).push(hit);
  }
  const starts = [...byStart.keys()].sort((a, b) => a - b);
  const barEndBeats = time[0];

  const notes = starts.map((start, i) => {
    const group = byStart.get(start);
    const nextStart = i + 1 < starts.length ? starts[i + 1] : barEndBeats;
    const hitsInfo = group.map((h) => ({ piece: h.piece, ...slotOrThrow(h.piece) }));
    return { midi: null, dur: nextStart - start, perc: { hits: hitsInfo, stem: stemForHits(hitsInfo) } };
  });

  return layoutMeasure({ clef: 'percussion', key: 'C', time, width, notes });
}
