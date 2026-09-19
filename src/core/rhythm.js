// Pure rhythm vocabulary. No DOM, no AudioContext, no Math.random.
//
// Durations are exact integer ticks (TPQ ticks per quarter note), so triplets
// and swing are exact fractions rather than floating-point beat offsets.
//
// An "event" is { dur, rest, tied }:
//   dur  — length in ticks.
//   rest — true if this event is silence (no onset).
//   tied — true if this event continues the PREVIOUS sounding event: it gets
//          no onset of its own, but still occupies `dur` ticks. A tie across
//          a barline is written as the last cell of one bar ending on a
//          plain note, and the first cell of the next bar being one of the
//          `*~` "tied continuation" cells below.

export const TPQ = 480; // ticks per quarter note

const Q = TPQ; // 480 — quarter
const E = TPQ / 2; // 240 — eighth
const S16 = TPQ / 4; // 120 — sixteenth
const DE = (TPQ * 3) / 4; // 360 — dotted eighth
const DQ = (TPQ * 3) / 2; // 720 — dotted quarter
const H = TPQ * 2; // 960 — half
const DH = TPQ * 3; // 1440 — dotted half / 3-beat bar
const W = TPQ * 4; // 1920 — whole / 4-beat bar
const ET3 = Math.round(TPQ / 3); // 160 — eighth-note triplet (3 in the space of 2 eighths)
const QT3 = Math.round((TPQ * 2) / 3); // 320 — quarter-note triplet (3 in the space of 2 quarters)

export const METRES = {
  '4/4': { ticksPerBar: W, beats: 4, beatUnit: Q },
  '3/4': { ticksPerBar: DH, beats: 3, beatUnit: Q },
  '6/8': { ticksPerBar: DH, beats: 2, beatUnit: DQ },
};

// The rhythm-cell vocabulary. Each cell is a fixed sequence of events.
// The first ten (q, ee, h, qr, ssss, dqe, ree, ess, sse, eqe) are the
// original ten 4/4 cells from src/app.js CELLS (line 45 there), re-expressed
// in ticks. tests/unit/rhythm.test.mjs pins their onset times against the
// numbers the old beat-fraction math produces, so this list must keep
// producing the same durations for those ten ids.
export const CELLS = {
  // --- original ten (4/4) ---
  q: [{ dur: Q }],
  ee: [{ dur: E }, { dur: E }],
  h: [{ dur: H }],
  qr: [{ dur: Q, rest: true }],
  ssss: [{ dur: S16 }, { dur: S16 }, { dur: S16 }, { dur: S16 }],
  dqe: [{ dur: DQ }, { dur: E }],
  ree: [{ dur: E, rest: true }, { dur: E }],
  ess: [{ dur: E }, { dur: S16 }, { dur: S16 }],
  sse: [{ dur: S16 }, { dur: S16 }, { dur: E }],
  eqe: [{ dur: E }, { dur: Q }, { dur: E }],

  // --- rests ---
  hr: [{ dur: H, rest: true }],
  wr: [{ dur: W, rest: true }],
  dqr: [{ dur: DQ, rest: true }], // 6/8 dotted-quarter rest

  // --- ties ---
  tqq: [{ dur: Q }, { dur: Q, tied: true }], // tie across a beat, one bar
  'q~': [{ dur: Q, tied: true }], // tied continuation: opens a bar tied from the previous one
  th: [{ dur: H }, { dur: Q, tied: true }], // half tied into a quarter (3-beat tie)

  // --- dotted-eighth + sixteenth ---
  des: [{ dur: DE }, { dur: S16 }],

  // --- triplets --- (`triplet: true` on every event of the group, for drawing brackets)
  et3: [{ dur: ET3, triplet: true }, { dur: ET3, triplet: true }, { dur: TPQ - 2 * ET3, triplet: true }], // eighth-note triplet, one beat
  qt3: [{ dur: QT3, triplet: true }, { dur: QT3, triplet: true }, { dur: TPQ * 2 - 2 * QT3, triplet: true }], // quarter-note triplet, two beats

  // --- 3/4 ---
  hq: [{ dur: H }, { dur: Q }],
  qqq: [{ dur: Q }, { dur: Q }, { dur: Q }],
  'dh.': [{ dur: DH }],

  // --- 6/8 ---
  dq: [{ dur: DQ }],
  e3: [{ dur: E }, { dur: E }, { dur: E }], // three eighths, one dotted-quarter beat
};

/**
 * buildPhrase({ metre, cells }) -> { events, bars }
 * `cells` is either a flat array of cell ids (a single bar) or an array of
 * such arrays (one per bar, for multi-bar phrases). `bars`, if given and
 * `cells` is a flat array, repeats that one-bar pattern that many times.
 */
export function buildPhrase({ metre, cells, bars }) {
  if (!METRES[metre]) throw new Error('unknown metre: ' + metre);
  const isMultiBar = Array.isArray(cells) && Array.isArray(cells[0]);
  const barPatterns = isMultiBar ? cells : Array(bars && bars > 0 ? bars : 1).fill(cells);
  const events = [];
  const barRanges = [];
  barPatterns.forEach((pattern, barIndex) => {
    const start = events.length;
    pattern.forEach((id) => {
      const cell = CELLS[id];
      if (!cell) throw new Error('unknown cell: ' + id);
      cell.forEach((ev) => events.push(Object.assign({}, ev, { rest: !!ev.rest, tied: !!ev.tied, bar: barIndex })));
    });
    barRanges.push({ start, end: events.length });
  });
  return { events, bars: barRanges, metre };
}

/**
 * onsetsOf(events, { bpm, swing }) -> onset times in seconds.
 * A rest produces no onset. A tied event produces no new onset (it extends
 * the previous sounding note). `swing` (0..1, default 0) delays the
 * off-beat eighth of any on-beat/off-beat eighth pair: at swing=0 the pair
 * is even (straight eighths); at swing=1 the off-beat eighth lands exactly
 * on the last third of the beat (full triplet swing, 2:1). 0.33 is a light
 * shuffle feel, well short of full triplet swing.
 */
export function onsetsOf(events, { bpm, swing = 0 } = {}) {
  if (!bpm || bpm <= 0) throw new Error('bpm required');
  const secPerTick = 60 / bpm / TPQ;
  const onsets = [];
  let cursor = 0;
  events.forEach((ev) => {
    const startTick = cursor;
    if (!ev.rest && !ev.tied) {
      let tick = startTick;
      const beatStart = Math.floor(startTick / TPQ) * TPQ;
      const offsetInBeat = startTick - beatStart;
      if (swing && ev.dur === E && offsetInBeat === E) {
        tick = beatStart + TPQ * (0.5 + (swing * (2 / 3 - 0.5)));
      }
      onsets.push(tick * secPerTick);
    }
    cursor += ev.dur;
  });
  return onsets;
}

/** validateBar(events, metre) -> true iff the events sum exactly to one bar of `metre`. */
export function validateBar(events, metre) {
  if (!METRES[metre]) throw new Error('unknown metre: ' + metre);
  const total = events.reduce((s, e) => s + e.dur, 0);
  return total === METRES[metre].ticksPerBar;
}

/** Total duration of a list of events, in ticks. */
export function totalTicks(events) {
  return events.reduce((s, e) => s + e.dur, 0);
}
