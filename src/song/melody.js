// Contour tracking: turn a flat, possibly-overlapping list of detected
// notes (what a multipitch tracker emits -- [{midi, start, dur, salience?}])
// into monophonic melodic lines ("contours") by pitch proximity and time
// continuity, then pick which contour is most likely the melody. Pure: no
// DOM, no AudioContext, no randomness -- start/dur are just numbers, the
// caller owns the clock and its units (ticks, seconds, whatever).
//
// Wiring pass (B5): feed live/transcribed notes through trackContours then
// pickMelody; nothing here is wired into transcribe.js or the UI yet.

// A contour's next expected pitch is extrapolated from its last TWO notes
// (simple linear "velocity"), not just its last note. This is what keeps a
// contour's identity stable when two voices cross in pitch: at the crossing
// frame both voices can sit at almost the same MIDI number, but only one of
// them is *moving toward* that number the way its own trend predicts.
function expectedPitch(contour) {
  const n = contour.notes;
  const last = n[n.length - 1];
  if (n.length < 2) return last.midi;
  const prev = n[n.length - 2];
  return last.midi + (last.midi - prev.midi);
}

// Group notes into onset batches: notes whose start falls within `eps` of
// the batch's first note are treated as sounding together (a chord/attack
// across voices), and are matched against contours as one unit so voices
// crossing pitch at the same instant don't get resolved one at a time.
function clusterOnsets(notes, eps) {
  const ordered = notes.map((n, i) => ({ n, i })).sort((a, b) => (a.n.start - b.n.start) || (a.i - b.i));
  const batches = [];
  let current = null;
  for (const { n } of ordered) {
    if (current && n.start - current.start <= eps) current.notes.push(n);
    else { current = { start: n.start, notes: [n] }; batches.push(current); }
  }
  return batches;
}

// trackContours(notes, opts) -> [{ id, notes: [note, ...] }]
// opts.onsetEpsilon: ticks within which two notes count as "the same
// moment" (default 1). opts.maxJump: largest pitch distance (semitones)
// a contour is allowed to jump to continue; beyond that a new contour
// starts instead of forcing a bad continuation (default 12, an octave).
export function trackContours(notes, opts = {}) {
  const eps = opts.onsetEpsilon ?? 1;
  const maxJump = opts.maxJump ?? 12;
  const batches = clusterOnsets(notes, eps);
  const contours = [];
  let nextId = 0;
  for (const batch of batches) {
    const available = contours.slice();
    const pairs = [];
    for (const note of batch.notes) {
      for (const c of available) pairs.push({ note, c, cost: Math.abs(note.midi - expectedPitch(c)) });
    }
    pairs.sort((a, b) => a.cost - b.cost);
    const usedNotes = new Set();
    const usedContours = new Set();
    for (const p of pairs) {
      if (usedNotes.has(p.note) || usedContours.has(p.c) || p.cost > maxJump) continue;
      usedNotes.add(p.note);
      usedContours.add(p.c);
      p.c.notes.push(p.note);
    }
    for (const note of batch.notes) {
      if (!usedNotes.has(note)) contours.push({ id: nextId++, notes: [note] });
    }
  }
  return contours;
}

// Average pitch and note count of a contour -- the two ingredients used to
// judge "which line is the melody" and "which line is stable enough to be
// the bass" without needing anything beyond what trackContours produced.
export function contourStats(contour) {
  const notes = contour.notes;
  const avg = notes.reduce((s, n) => s + n.midi, 0) / notes.length;
  return { avg, count: notes.length };
}

const DEFAULT_HYSTERESIS = 2;
const DEFAULT_MIN_COVERAGE = 0.3;

// pickMelody(contours, opts) -> contour id, or null if there are no
// contours. Candidate contours must cover at least `opts.minCoverage`
// (default 0.3) of the busiest contour's note count -- a single stray high
// note shouldn't outrank a fully-played line just because its average
// pitch is highest. Among candidates the highest average pitch wins.
//
// opts.previousId + opts.hysteresis: if the previously-picked contour is
// still within `hysteresis` semitones (default 2) of the best score, keep
// it instead of switching -- callers that re-run this across overlapping
// windows of the same contours won't see the melody pick jump around on
// every near-tie.
export function pickMelody(contours, opts = {}) {
  if (!contours.length) return null;
  const maxCount = Math.max(...contours.map((c) => c.notes.length));
  const floor = maxCount * (opts.minCoverage ?? DEFAULT_MIN_COVERAGE);
  const candidates = contours.filter((c) => c.notes.length >= floor);
  const scored = candidates.map((c) => ({ c, avg: contourStats(c).avg })).sort((a, b) => b.avg - a.avg);
  let best = scored[0];
  if (opts.previousId != null) {
    const prev = scored.find((s) => s.c.id === opts.previousId);
    if (prev && (best.avg - prev.avg) <= (opts.hysteresis ?? DEFAULT_HYSTERESIS)) best = prev;
  }
  return best.c.id;
}
