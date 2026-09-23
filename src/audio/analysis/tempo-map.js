// Piecewise tempo map from a beat track (trackBeats()'s output, seconds) and a swing-ratio
// estimate from onset times relative to those beats. Pure math: no DOM, no AudioContext, caller
// owns the clock. Produced maps use the Song model's `tempoMap` shape (src/song/model.js):
// a tick-sorted [{tick, bpm}] list, tick a non-negative integer, bpm > 0. `ppq` here matches
// the Song model's fixed ticksPerQuarter (480) unless the caller overrides it — beat i is
// defined to land on tick i*ppq (beats are quarter notes), so tick positions are exact by
// construction; only the per-segment bpm is estimated from the beat spacing.

// Turns a beat track into a small number of constant-tempo segments: walk the per-beat
// instantaneous bpm and keep extending the current segment while it stays within
// `bpmTolerance` of the segment's starting bpm; once it drifts past tolerance AND the segment
// has run at least `minSegmentBeats` beats, close it and start a new one at the exact bpm
// implied by (beats in segment / seconds spanned) so segment boundaries reproduce the source
// beat times, not just the instantaneous estimate. A steady ritardando (bpm drifting a couple
// of bpm per beat) blows through a tight tolerance almost every beat, so it naturally comes out
// as many short segments that track the curve; a constant-tempo track never drifts, so it comes
// out as one segment. A final pass merges adjacent segments whose bpm is within
// `mergeBpmTolerance` (tighter than the split tolerance) to collapse near-duplicate segments
// left over from floating-point noise.
export function tempoMapFromBeats(beatTimesSec, opts = {}) {
  const ppq = opts.ppq ?? 480;
  const fallbackBpm = opts.fallbackBpm ?? 120;
  const bpmTolerance = opts.bpmTolerance ?? 1.5;
  const minSegmentBeats = Math.max(1, Math.floor(opts.minSegmentBeats ?? 4));
  const mergeBpmTolerance = opts.mergeBpmTolerance ?? bpmTolerance / 3;
  const times = (Array.isArray(beatTimesSec) ? beatTimesSec : []).filter((t) => typeof t === 'number' && isFinite(t));
  if (times.length < 2) return [{ tick: 0, bpm: fallbackBpm }];

  const instBpm = [];
  for (let i = 0; i < times.length - 1; i++) {
    const dt = times[i + 1] - times[i];
    instBpm.push(dt > 0 ? 60 / dt : fallbackBpm);
  }

  const spans = [];
  let segStart = 0;
  let refBpm = instBpm[0];
  for (let i = 1; i < instBpm.length; i++) {
    const segLen = i - segStart;
    if (Math.abs(instBpm[i] - refBpm) > bpmTolerance && segLen >= minSegmentBeats) {
      spans.push({ startBeat: segStart, endBeat: i });
      segStart = i;
      refBpm = instBpm[i];
    }
  }
  spans.push({ startBeat: segStart, endBeat: instBpm.length });

  const map = spans.map(({ startBeat, endBeat }) => {
    const segSeconds = times[endBeat] - times[startBeat];
    const segBeats = endBeat - startBeat;
    const bpm = segSeconds > 0 ? (60 * segBeats) / segSeconds : instBpm[startBeat];
    return { tick: Math.round(startBeat * ppq), bpm };
  });

  const merged = [];
  for (const entry of map) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.bpm - entry.bpm) <= mergeBpmTolerance) continue;
    merged.push(entry);
  }
  return merged;
}

// Precomputes, for each tempo-map entry, the seconds elapsed at its tick (integrating forward
// segment by segment: each entry's bpm holds until the next entry's tick). Shared by
// secondsToTick/tickToSeconds so both invert the same piecewise-linear tick<->seconds curve.
function segmentStarts(tempoMap, ppq) {
  const map = Array.isArray(tempoMap) && tempoMap.length ? tempoMap : [{ tick: 0, bpm: 120 }];
  const starts = [{ tick: map[0].tick, bpm: map[0].bpm, sec: 0 }];
  for (let i = 1; i < map.length; i++) {
    const prev = starts[i - 1];
    const deltaBeats = (map[i].tick - prev.tick) / ppq;
    const sec = prev.sec + (deltaBeats * 60) / prev.bpm;
    starts.push({ tick: map[i].tick, bpm: map[i].bpm, sec });
  }
  return starts;
}

// Converts a tick position to seconds under `tempoMap` (Song model shape, sorted by tick).
// Ticks before the first entry or after the last extrapolate at that entry's bpm.
export function tickToSeconds(tempoMap, tick, ppq = 480) {
  const starts = segmentStarts(tempoMap, ppq);
  let idx = 0;
  for (let i = 0; i < starts.length; i++) if (starts[i].tick <= tick) idx = i;
  const seg = starts[idx];
  const deltaBeats = (tick - seg.tick) / ppq;
  return seg.sec + (deltaBeats * 60) / seg.bpm;
}

// Converts a seconds position to a tick under `tempoMap` — the inverse of tickToSeconds.
export function secondsToTick(tempoMap, sec, ppq = 480) {
  const starts = segmentStarts(tempoMap, ppq);
  let idx = 0;
  for (let i = 0; i < starts.length; i++) if (starts[i].sec <= sec) idx = i;
  const seg = starts[idx];
  const deltaSeconds = sec - seg.sec;
  return seg.tick + (deltaSeconds * seg.bpm * ppq) / 60;
}

// Estimates the swing ratio from onset times against a beat track: for each beat interval,
// finds the "and" onset (an onset strictly between the two beats, away from either) closest to
// the expected swung position, and reads off where it actually falls as a fraction of the
// interval. frac = 0.5 (onset exactly midway) is straight time (ratio 1.0); frac = 2/3 (long-
// short triplet feel) is ratio 2.0. Returns the median ratio across intervals that had a
// usable "and" onset, or 1.0 (straight) when none did — silence is never reported as swing.
export function estimateSwing(onsetTimesSec, beatTimesSec, opts = {}) {
  const onsets = Array.isArray(onsetTimesSec) ? onsetTimesSec : [];
  const beats = Array.isArray(beatTimesSec) ? beatTimesSec : [];
  const edgeGuardFrac = opts.edgeGuardFrac ?? 0.1;
  const expectedFrac = opts.expectedFrac ?? 0.58; // midway between straight (0.5) and swing (0.667)
  const ratios = [];
  for (let i = 0; i < beats.length - 1; i++) {
    const b0 = beats[i], b1 = beats[i + 1];
    const dur = b1 - b0;
    if (!(dur > 0)) continue;
    let bestFrac = null, bestDist = Infinity;
    for (const t of onsets) {
      const frac = (t - b0) / dur;
      if (frac <= edgeGuardFrac || frac >= 1 - edgeGuardFrac) continue;
      const dist = Math.abs(frac - expectedFrac);
      if (dist < bestDist) { bestDist = dist; bestFrac = frac; }
    }
    if (bestFrac !== null) ratios.push(bestFrac / (1 - bestFrac));
  }
  if (ratios.length === 0) return 1.0;
  ratios.sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  return ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
}
