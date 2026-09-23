// Bowed-string fingering (plan unit D4, "bowed positions"). Turns a fitted
// melody (src/song/lesson.js's fitToInstrument output, or any array of
// {start, dur, midi} notes) into a per-note string/finger/position, for a
// violin/viola/cello/double-bass record (src/instruments/violin.js etc --
// family 'bowed', tuning = low-to-high open-string MIDI pitches, both in the
// SAME pitch space as instrument.range: double bass's tuning/range are
// already "sounding pitch" per its own header comment, so this module never
// applies the -12 transposition itself -- that convention belongs to
// whichever module owns transposing a Song into an instrument's written
// pitch, not to this one).
//
// Pure module: no DOM, no AudioContext, no clock. Caller owns everything
// ambiguous (there is nothing ambiguous here besides the notes themselves).
//
// Fingering model (a deliberate beginner-method simplification, not a full
// chromatic fretless model): first position (position 1) plays the string's
// own diatonic (natural, unaltered) scale degrees --
//   finger 0 = open string           (offset 0)
//   finger 1 = a whole tone up       (offset 2)
//   finger 2 = a major third up      (offset 4)
//   finger 3 = a perfect fourth up   (offset 5)
//   finger 4 = a perfect fifth up    (offset 7, the open pitch of the next
//              string up -- so this finger is always an *alternative* to
//              crossing strings, never the only way to reach that pitch)
// Each higher position (2, 3, ...) shifts this same finger pattern up by one
// further whole tone (2 semitones) per position, which is the standard
// "whole-step" position-change most method books teach for the first few
// shifts up the fingerboard:
//   offset(position, finger) = (position - 1) * 2 + [_, 2, 4, 5, 7][finger]   (finger 1-4)
//   offset(1, 0) = 0                                                          (open string only exists in first position)
// A note whose pitch class is chromatically altered from every reachable
// string's diatonic pattern (e.g. a "low 1st finger" half-step above an open
// string) falls outside this simplified lattice and is reported in
// `unplayable` with reason 'no-fingering' rather than invented or dropped --
// exactly the wiring pass's contract for a real device limitation.
//
// DP objective (plan: "minimising shifts and string crossings"): for each
// note, in order, choose among every {string, position, finger} combination
// that reaches its pitch, minimising the running total of string crossings
// and position shifts from the previous PLACED note; unplayable notes are
// skipped without breaking that chain. Ties are broken, in order, by (a)
// preferring not to cross strings over shifting position when both would
// cost the same, then (b) preferring first position, then (c) preferring an
// open string/lower finger number -- all three tie-break weights are kept
// far smaller than 1 (the true cost of a single crossing or shift) so they
// can never outweigh the actual minimisation, however long the melody.
const FINGER_INTERVAL = [null, 2, 4, 5, 7]; // index 1-4; finger 0 (open) handled separately

export function semitoneOffset(position, finger) {
  if (finger === 0) {
    if (position !== 1) throw new Error('bowed: open string (finger 0) only exists in first position, got position ' + position);
    return 0;
  }
  if (finger < 1 || finger > 4) throw new Error('bowed: finger must be 0-4, got ' + finger);
  return (position - 1) * 2 + FINGER_INTERVAL[finger];
}

// Every {string, position, finger} combination that lands exactly on `midi`,
// given this instrument's tuning (low-to-high open-string pitches) and a
// position ceiling.
function candidatesForNote(midi, tuning, maxPosition) {
  const out = [];
  for (let string = 0; string < tuning.length; string++) {
    const open = tuning[string];
    const rel = midi - open;
    if (rel < 0) continue; // a bow can't reach below its own open string
    if (rel === 0) out.push({ string, position: 1, finger: 0 });
    for (let position = 1; position <= maxPosition; position++) {
      for (let finger = 1; finger <= 4; finger++) {
        if (semitoneOffset(position, finger) === rel) out.push({ string, position, finger });
      }
    }
  }
  return out;
}

const CROSSING_COST = 1 + 1e-3; // marginally pricier than a shift, so a tie prefers shifting in place
const SHIFT_COST = 1;
const POSITION_TIE_BREAK = 1e-6; // prefer first position -- always << 1, never outweighs a real crossing/shift
const FINGER_TIE_BREAK = 1e-7; // prefer an open string / lower finger number

function transitionCost(prev, cand) {
  let cost = 0;
  if (prev.string !== cand.string) cost += CROSSING_COST;
  if (prev.position !== cand.position) cost += SHIFT_COST;
  return cost;
}

function tieBreak(cand) {
  return (cand.position - 1) * POSITION_TIE_BREAK + cand.finger * FINGER_TIE_BREAK;
}

// Viterbi-style shortest path: every placeable note keeps ALL of its
// candidates (with the best cumulative cost and a backpointer into the
// previous note's candidate list), and only the very last note's overall
// cheapest candidate is picked -- then the whole path is recovered by
// backtracking. A note-by-note greedy pick (take the cheapest candidate as
// soon as it's computed) is NOT the same thing: an early note's second-best
// choice can turn out cheaper once later notes are taken into account, so
// the path is only correct once every note has been seen.
export function arrangeBowed(notes, instrument, opts = {}) {
  const maxPosition = opts.maxPosition || 3;
  const tuning = instrument.tuning;
  const { range } = instrument;

  const unplayable = [];
  const steps = []; // { note, scored: [{ cand, cost, back }] }, one per placeable note, in original order

  notes.forEach(note => {
    if (note.midi < range.low || note.midi > range.high) {
      unplayable.push({ ...note, reason: 'out-of-range' });
      return;
    }
    const cands = candidatesForNote(note.midi, tuning, maxPosition);
    if (cands.length === 0) {
      unplayable.push({ ...note, reason: 'no-fingering' });
      return;
    }
    const prevScored = steps.length ? steps[steps.length - 1].scored : null;
    const scored = cands.map(cand => {
      if (!prevScored) return { cand, cost: tieBreak(cand), back: -1 };
      let bestCost = Infinity;
      let bestBack = -1;
      prevScored.forEach((prev, i) => {
        const cost = prev.cost + transitionCost(prev.cand, cand) + tieBreak(cand);
        if (cost < bestCost) { bestCost = cost; bestBack = i; }
      });
      return { cand, cost: bestCost, back: bestBack };
    });
    steps.push({ note, scored });
  });

  const placed = [];
  if (steps.length > 0) {
    const last = steps[steps.length - 1].scored;
    let idx = last.reduce((bestI, s, i) => (s.cost < last[bestI].cost ? i : bestI), 0);
    const chain = new Array(steps.length);
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i].scored[idx];
      chain[i] = s.cand;
      idx = s.back;
    }
    chain.forEach((cand, i) => {
      const { note } = steps[i];
      placed.push({ ...note, string: cand.string, position: cand.position, finger: cand.finger });
    });
  }

  return { placed, unplayable };
}
