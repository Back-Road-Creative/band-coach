// Pure tuner state machine: median smoothing so a single octave-error
// reading cannot move the display, hysteresis so the selected string does
// not thrash on a wobbly pitch, and an in-tune hold that DECAYS through a
// dropped frame instead of being wiped by it. No DOM, no AudioContext: the
// caller polls once per pitch-detector tick (or with a null frame on a miss)
// and owns dt. See src/core/groove.js for the house style this follows.

function num(x, d) {
  return typeof x === 'number' && isFinite(x) ? x : d;
}

// Median of the last n midi readings (default 5). A single octave-error
// reading lands at one end of the sorted window; the median ignores it the
// way a mean never would.
export function smoothMidi(history, n = 5) {
  const h = (Array.isArray(history) ? history : []).filter((x) => typeof x === 'number' && isFinite(x)).slice(-n);
  if (!h.length) return null;
  const sorted = h.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Decides which index into `targets` is selected. `state.selIdx` (previous
// selection), `state.candidateIdx`/`state.candidateN` (a challenger index and
// how many CONSECUTIVE calls it has been the nearest one) carry hysteresis
// across calls. A challenger only takes over once it has been nearest for
// `opts.confirmTicks` (default 3) calls in a row AND is nearer than the
// current selection by at least `opts.marginCents` (default 20) -- so a
// reading that wobbles between two adjacent strings does not flip the
// selection every tick. `opts.lockedIdx`, when not null/undefined, bypasses
// all of this and is returned verbatim (a learner tapped a row to lock it).
export function selectTarget(state, midi, targets, opts = {}) {
  if (opts.lockedIdx !== null && opts.lockedIdx !== undefined) {
    return { selIdx: opts.lockedIdx, candidateIdx: null, candidateN: 0 };
  }
  if (!Array.isArray(targets) || !targets.length || typeof midi !== 'number' || !isFinite(midi)) {
    return { selIdx: null, candidateIdx: null, candidateN: 0 };
  }
  const confirmTicks = Math.max(1, Math.floor(num(opts.confirmTicks, 3)));
  const marginCents = Math.max(0, num(opts.marginCents, 20));
  let nearestIdx = 0, nearestDiff = Infinity;
  targets.forEach((m, i) => { const d = Math.abs(midi - m); if (d < nearestDiff) { nearestDiff = d; nearestIdx = i; } });
  const prevSel = state && typeof state.selIdx === 'number' ? state.selIdx : null;
  if (prevSel === null || prevSel >= targets.length) return { selIdx: nearestIdx, candidateIdx: null, candidateN: 0 };
  if (nearestIdx === prevSel) return { selIdx: prevSel, candidateIdx: null, candidateN: 0 };
  const marginOk = (Math.abs(midi - targets[prevSel]) - nearestDiff) * 100 >= marginCents;
  if (!marginOk) return { selIdx: prevSel, candidateIdx: null, candidateN: 0 };
  const prevN = state && state.candidateIdx === nearestIdx ? num(state.candidateN, 0) : 0;
  const n = prevN + 1;
  if (n >= confirmTicks) return { selIdx: nearestIdx, candidateIdx: null, candidateN: 0 };
  return { selIdx: prevSel, candidateIdx: nearestIdx, candidateN: n };
}

const EMPTY_STATE = Object.freeze({
  phase: 'idle', history: [], midi: null, targetMidi: null, cents: null,
  selIdx: null, candidateIdx: null, candidateN: 0, holdMs: 0, ageMs: 0, silenceMs: 0,
});

// Advances the tuner one tick. `frame` is `{ freq, midi }` (a pitch-detector
// reading) or null/`{ freq: 0 }` for a tick with nothing heard. Returns a NEW
// state object; never mutates `state`. Phases: idle (never locked on since
// the last reset) -> tracking (a confident reading, cents not yet held long
// enough) -> holding (in tune for confirmMs) -> back to idle only after
// holdWindowMs of CONTINUOUS silence. A null frame keeps the last midi/cents
// visible with a growing `ageMs` and DECAYS (never zeroes) the in-tune
// progress, so one dropped poll cannot blank the readout or restart the hold.
// Empty `targets` means chromatic: the target is the nearest semitone to the
// smoothed reading, same confirm logic.
export function stepTuner(state, frame, dtMs, opts = {}) {
  const s = state || EMPTY_STATE;
  const dt = Math.max(0, num(dtMs, 0));
  const holdWindowMs = Math.max(0, num(opts.holdWindowMs, 1500));
  const confirmMs = Math.max(1, num(opts.confirmMs, 600));
  const toleranceCents = Math.max(0, num(opts.toleranceCents, 5));
  const historyN = Math.max(1, Math.floor(num(opts.historyN, 5)));
  const targets = Array.isArray(opts.targets) ? opts.targets : [];
  const heard = frame && typeof frame.freq === 'number' && frame.freq > 0 && typeof frame.midi === 'number' && isFinite(frame.midi);

  if (!heard) {
    const silenceMs = num(s.silenceMs, 0) + dt;
    if (silenceMs >= holdWindowMs || s.midi === null) {
      return { ...EMPTY_STATE, history: [] };
    }
    return {
      ...s,
      phase: s.phase === 'holding' ? 'holding' : 'tracking',
      silenceMs,
      ageMs: num(s.ageMs, 0) + dt,
      holdMs: Math.max(0, num(s.holdMs, 0) - dt),
    };
  }

  const history = [...(Array.isArray(s.history) ? s.history : []), frame.midi].slice(-historyN);
  const smoothed = smoothMidi(history, historyN);
  let selIdx = null, candidateIdx = null, candidateN = 0, targetMidi;
  if (targets.length) {
    const sel = selectTarget(s, smoothed, targets, opts);
    selIdx = sel.selIdx; candidateIdx = sel.candidateIdx; candidateN = sel.candidateN;
    targetMidi = targets[selIdx];
  } else {
    // Chromatic: no fixed targets, lock bypass still applies via opts.lockedIdx
    // being meaningless here (there is nothing to index), so lockedIdx is
    // ignored and the target simply tracks the nearest semitone.
    targetMidi = Math.round(smoothed);
  }
  const cents = (smoothed - targetMidi) * 100;
  const inTune = Math.abs(cents) <= toleranceCents;
  const sameTarget = s.targetMidi === targetMidi;
  const holdMs = inTune ? (sameTarget ? num(s.holdMs, 0) : 0) + dt : 0;
  return {
    phase: holdMs >= confirmMs ? 'holding' : 'tracking',
    history, midi: smoothed, targetMidi, cents,
    selIdx, candidateIdx, candidateN,
    holdMs, ageMs: 0, silenceMs: 0,
  };
}
