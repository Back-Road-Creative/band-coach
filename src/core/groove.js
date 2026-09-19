// Pure rhythm-scoring math for "play in time" exercises: nothing on a
// pitched instrument was ever judged for rhythm (F7) — note tasks scored
// reaction time only, and rhythm existed only as tapping a key or pad. This
// module builds the beat grid a metronome plays to, scores a take of played
// notes against it, and adapts the tempo. No DOM, no AudioContext, no
// Math.random: callers own the clock and the sound.

function num(x, d) {
  return typeof x === 'number' && isFinite(x) ? x : d;
}

// A flat list of beat times, in the caller's clock units (seconds), evenly
// spaced by subdivision within each beat. subdivision: 1 = quarter notes,
// 2 = eighth notes, etc. beatsPerBar/bars/subdivision are all clamped to
// sane positive integers so a bad caller gets an empty-ish grid, not NaNs.
export function makeGrid({ bpm, beatsPerBar = 4, bars = 1, subdivision = 1, startTime = 0 } = {}) {
  const b = num(bpm, 0);
  const bpb = Math.max(1, Math.floor(num(beatsPerBar, 4)));
  const nb = Math.max(1, Math.floor(num(bars, 1)));
  const sub = Math.max(1, Math.floor(num(subdivision, 1)));
  const t0 = num(startTime, 0);
  if (!(b > 0)) return [];
  const spacing = 60 / b / sub;
  const total = bpb * nb * sub;
  const out = [];
  for (let i = 0; i < total; i++) out.push(t0 + i * spacing);
  return out;
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const stdev = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) * (x - m))));
};

// Judges one take: expected = [{ beat, midi? }], beat is an index into
// grid. onsets = [{ t, midi? }], t on the same clock grid is built on,
// latencyMs already NOT subtracted (this function subtracts it once).
// Greedy nearest-neighbour matching, one onset per expected note, closest
// unclaimed onset within windowMs wins; leftover onsets are "extra".
export function scoreTake({ onsets, grid, expected, latencyMs = 0, windowMs = 150 } = {}) {
  const g = Array.isArray(grid) ? grid : [];
  const exp = Array.isArray(expected) ? expected : [];
  const lat = num(latencyMs, 0) / 1000;
  const win = Math.max(0, num(windowMs, 150)) / 1000;
  const adjusted = (Array.isArray(onsets) ? onsets : [])
    .filter((o) => o && typeof o.t === 'number' && isFinite(o.t))
    .map((o) => ({ t: o.t - lat, midi: o.midi, used: false }));

  const notes = exp.map((e) => {
    const beatT = g[e.beat];
    if (typeof beatT !== 'number') return { beat: e.beat, expectedT: null, ok: false, errorMs: null, early: false, late: false, pitchOk: null, missed: true };
    let best = -1, bestDiff = Infinity;
    for (let i = 0; i < adjusted.length; i++) {
      const o = adjusted[i];
      if (o.used) continue;
      const diff = Math.abs(o.t - beatT);
      if (diff <= win && diff < bestDiff) { bestDiff = diff; best = i; }
    }
    if (best < 0) return { beat: e.beat, expectedT: beatT, ok: false, errorMs: null, early: false, late: false, pitchOk: null, missed: true };
    const o = adjusted[best];
    o.used = true;
    const errorMs = (o.t - beatT) * 1000;
    const pitchOk = e.midi === undefined || e.midi === null ? true : (o.midi === undefined || o.midi === null ? null : o.midi === e.midi);
    return { beat: e.beat, expectedT: beatT, ok: pitchOk !== false, errorMs, early: errorMs < 0, late: errorMs > 0, pitchOk, missed: false };
  });

  const extra = adjusted.filter((o) => !o.used).length;
  const hits = notes.filter((n) => n.ok && !n.missed);
  const errors = notes.filter((n) => n.errorMs !== null).map((n) => n.errorMs);
  const hitRate = exp.length ? hits.length / exp.length : 0;
  const meanErrorMs = errors.length ? mean(errors) : null;
  const consistencyMs = errors.length ? stdev(errors) : null;
  let tendency = 'unknown';
  if (meanErrorMs !== null) {
    tendency = Math.abs(meanErrorMs) < 15 ? 'steady' : meanErrorMs < 0 ? 'rushing' : 'dragging';
  }
  return {
    notes,
    summary: {
      total: exp.length,
      hitCount: hits.length,
      missedCount: notes.filter((n) => n.missed).length,
      extraCount: extra,
      hitRate,
      meanErrorMs,
      consistencyMs,
      tendency,
    },
  };
}

// Adapts tempo one step at a time: up after a clean take, down after a
// missed one, clamped to [min, max]. `step` is in bpm.
export function tempoLadder({ bpm, passed, step = 6, min = 50, max = 168 } = {}) {
  const b = num(bpm, min);
  const s = Math.max(1, num(step, 6));
  const lo = num(min, 50), hi = num(max, 168);
  const next = passed ? b + s : b - s;
  return Math.round(Math.min(hi, Math.max(lo, next)));
}
