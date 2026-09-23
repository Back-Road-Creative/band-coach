// Two-hand split and finger-choice for keyboard instruments (family 'keys',
// see src/instruments/kbd.js). Pure: no DOM, no AudioContext, caller owns
// the clock. Reuses the same shape as the fretted/bowed arrangers (a flat
// array of { start, dur, midi } notes in, every note accounted for out --
// never silently dropped).
//
// Wiring-pass API:
//   splitHands(notes, { splitMidi = 60, hysteresis = 2 }) -> { rh, lh }
//     One note (or, for a chord, each note in the chord) goes to whichever
//     hand its pitch belongs on. A monophonic line hovering right around
//     the split point does not ping-pong note to note: once a hand is
//     "current", the line stays on it until the pitch clears the split by
//     more than `hysteresis` semitones the other way (a Schmitt trigger).
//     A chord (more than one note sharing a `start`) is always split
//     strictly by pitch against `splitMidi`, since a stacked note is a
//     voicing decision, not a wandering melody line.
//   fingerHand(notes, hand) -> notes (same length, each with a `finger`
//     1-5 added)
//     A small Viterbi DP over finger 1-5 per note, minimising a running
//     cost: a stretch beyond the roughly-a-whole-step spacing a five-
//     finger position assumes between adjacent fingers; a thumb crossing
//     (finger 1 taking over from, or handing off to, another finger) is
//     only cheap when it happens on a step (an adjacent scale degree),
//     matching how method books teach the thumb-under/thumb-over scale
//     technique; and re-using the same finger for a different pitch (you
//     cannot put one finger on two different keys without moving the
//     whole hand) is costly in proportion to how far it has to reach.
//     `hand` only changes which direction is "toward the thumb": for the
//     right hand pitch rises toward the pinky (finger number rises with
//     pitch); for the left hand it is mirrored -- pitch rises toward the
//     thumb (finger number falls with pitch), matching the standard
//     "right hand 1-2-3-4-5 / left hand 5-4-3-2-1" five-finger convention
//     (see src/core/hands-together.js).
//   arrangeKeys(notes, instrument) -> { rh, lh, unplayable }
//     Range-checks every note against `instrument.range` first (anything
//     outside it is reported in `unplayable` with a plain reason, never
//     dropped and never invented), then runs the rest through splitHands
//     and fingerHand per hand.

const DEFAULT_SPLIT_MIDI = 60; // middle C
const DEFAULT_HYSTERESIS = 2; // a whole tone either side of the split point

function groupByStart(notes) {
  const byStart = new Map();
  notes.forEach((note, index) => {
    const list = byStart.get(note.start) || [];
    list.push({ note, index });
    byStart.set(note.start, list);
  });
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([start, entries]) => ({ start, entries }));
}

// splitHands ---------------------------------------------------------------

export function splitHands(notes, opts = {}) {
  const splitMidi = Number.isFinite(opts.splitMidi) ? opts.splitMidi : DEFAULT_SPLIT_MIDI;
  const hysteresis = Number.isFinite(opts.hysteresis) ? opts.hysteresis : DEFAULT_HYSTERESIS;
  const hi = splitMidi + hysteresis;
  const lo = splitMidi - hysteresis;

  const rh = [];
  const lh = [];
  let hand = null; // 'rh' | 'lh', persists across single notes for the hysteresis band

  for (const { entries } of groupByStart(notes)) {
    if (entries.length > 1) {
      // A chord: split strictly by pitch, no hysteresis -- a voicing
      // decision, not a wandering melody line.
      entries.forEach(({ note }) => (note.midi >= splitMidi ? rh : lh).push(note));
      const maxMidi = Math.max(...entries.map(({ note }) => note.midi));
      hand = maxMidi >= splitMidi ? 'rh' : 'lh';
      continue;
    }
    const note = entries[0].note;
    let target;
    if (hand === null) target = note.midi >= splitMidi ? 'rh' : 'lh';
    else if (hand === 'rh') target = note.midi >= lo ? 'rh' : 'lh';
    else target = note.midi <= hi ? 'lh' : 'rh';
    hand = target;
    (target === 'rh' ? rh : lh).push(note);
  }

  return { rh, lh };
}

// fingerHand -----------------------------------------------------------

const AVG_STEP = 2; // assumed semitones per finger in a five-finger position (a whole tone)
const STRETCH_WEIGHT = 0.3; // soft cost per semitone a step deviates from AVG_STEP
const CROSS_STEP_LIMIT = 3; // a thumb crossing is only "on a step" up to a minor third
const CROSS_WEIGHT = 1; // cheap, deliberate cost for a proper on-a-step thumb crossing
const CROSS_LEAP_WEIGHT = 4; // steep cost for crossing the thumb over/under a leap
const REPEAT_FINGER_WEIGHT = 0.6; // cost per semitone of reusing one finger on a different key
const CONTRARY_WEIGHT = 6; // fingers and pitch disagreeing on direction, no thumb crossing to explain it

function transitionCost(hand, prevFinger, prevMidi, curFinger, curMidi) {
  const dir = hand === 'lh' ? -1 : 1; // for the left hand, "toward the thumb" is ascending pitch
  const interval = (curMidi - prevMidi) * dir;
  const fingerDiff = curFinger - prevFinger;

  if (fingerDiff === 0) {
    if (interval === 0) return 0; // the same key again: free
    return REPEAT_FINGER_WEIGHT * Math.abs(interval);
  }

  const isThumbUnder = prevFinger > 1 && curFinger === 1 && interval > 0;
  const isThumbOver = prevFinger === 1 && curFinger > 1 && interval < 0;
  if (isThumbUnder || isThumbOver) {
    const step = Math.abs(interval);
    return step <= CROSS_STEP_LIMIT ? CROSS_WEIGHT : CROSS_LEAP_WEIGHT * step;
  }

  if ((fingerDiff > 0) !== (interval > 0)) {
    // fingers and pitch moving in disagreeing directions, and it is not a
    // thumb crossing -- not a physically sensible five-finger-position move
    return CONTRARY_WEIGHT;
  }

  const expected = fingerDiff * AVG_STEP;
  return STRETCH_WEIGHT * Math.abs(interval - expected);
}

export function fingerHand(notes, hand) {
  if (notes.length === 0) return [];
  const FINGERS = [1, 2, 3, 4, 5];

  // Viterbi: each note keeps a cost/backpointer per candidate finger; only
  // the last note's cheapest overall finger is picked, then the whole path
  // is recovered by backtracking -- an early note's second-best finger can
  // turn out cheaper once later notes are known, so a note-by-note greedy
  // pick is not equivalent.
  const layers = [];
  notes.forEach((note, i) => {
    if (i === 0) {
      layers.push(FINGERS.map(f => ({ finger: f, cost: 0, back: -1 })));
      return;
    }
    const prevLayer = layers[i - 1];
    const prevNote = notes[i - 1];
    const layer = FINGERS.map(f => {
      let bestCost = Infinity;
      let bestBack = -1;
      prevLayer.forEach((prev, k) => {
        const cost = prev.cost + transitionCost(hand, prev.finger, prevNote.midi, f, note.midi);
        if (cost < bestCost) { bestCost = cost; bestBack = k; }
      });
      return { finger: f, cost: bestCost, back: bestBack };
    });
    layers.push(layer);
  });

  const last = layers[layers.length - 1];
  let idx = last.reduce((bestI, s, i) => (s.cost < last[bestI].cost ? i : bestI), 0);
  const fingers = new Array(notes.length);
  for (let i = layers.length - 1; i >= 0; i--) {
    fingers[i] = layers[i][idx].finger;
    idx = layers[i][idx].back;
  }

  return notes.map((note, i) => ({ ...note, finger: fingers[i] }));
}

// arrangeKeys ------------------------------------------------------------

export function arrangeKeys(notes, instrument) {
  const range = instrument && instrument.range;
  if (!range) throw new Error('arrangeKeys requires an instrument record with a range');

  const playable = [];
  const unplayable = [];
  notes.forEach((note, index) => {
    if (note.midi < range.low || note.midi > range.high) {
      unplayable.push({ index, start: note.start, dur: note.dur, midi: note.midi, reason: 'out-of-range' });
    } else {
      playable.push(note);
    }
  });

  const { rh, lh } = splitHands(playable);
  return {
    rh: fingerHand(rh, 'rh'),
    lh: fingerHand(lh, 'lh'),
    unplayable
  };
}
