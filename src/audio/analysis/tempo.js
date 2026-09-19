// Wiring: estimateTempo(envelope, hopSeconds) -> {bpm, confidence, candidates}. trackBeats
// (envelope, bpm, hopSeconds) -> beat times in seconds (Ellis-style DP beat tracker).
// downbeats(beats, chroma) is best-effort; chroma may be null/undefined (falls back to
// "every beatsPerBar-th beat").

// Autocorrelation tempo estimate with a log-normal prior centred on priorBpm, plus
// harmonic-sum (comb-filter) scoring, which favours the true period over half/double-tempo
// octave errors.
export function estimateTempo(envelope, hopSeconds, opts = {}) {
  const minBpm = opts.minBpm ?? 60, maxBpm = opts.maxBpm ?? 200, priorBpm = opts.priorBpm ?? 110;
  const priorSigmaOctaves = opts.priorSigmaOctaves ?? 0.7, harmonics = opts.harmonics ?? 4;
  const n = envelope.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += envelope[i];
  mean /= Math.max(1, n);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = envelope[i] - mean;
  const minLag = Math.max(1, Math.round(60 / (maxBpm * hopSeconds)));
  const maxLag = Math.max(minLag + 1, Math.round(60 / (minBpm * hopSeconds)));
  const rawLagLimit = Math.min(n - 1, maxLag * harmonics);
  const raw = new Float64Array(rawLagLimit + 1);
  for (let lag = minLag; lag <= rawLagLimit; lag++) {
    const count = n - lag;
    if (count <= 0) break;
    let sum = 0;
    for (let i = 0; i < count; i++) sum += x[i] * x[i + lag];
    raw[lag] = sum / count;
  }
  const scored = [];
  for (let lag = minLag; lag <= maxLag && lag <= rawLagLimit; lag++) {
    let harmonicSum = 0;
    for (let h = 1; h <= harmonics; h++) {
      const l = lag * h;
      if (l > rawLagLimit) break;
      harmonicSum += raw[l] / h;
    }
    const bpm = 60 / (lag * hopSeconds);
    const logRatio = Math.log2(bpm / priorBpm);
    const prior = Math.exp(-(logRatio * logRatio) / (2 * priorSigmaOctaves * priorSigmaOctaves));
    scored.push({ lag, bpm, score: harmonicSum * prior });
  }
  if (scored.length === 0) return { bpm: priorBpm, confidence: 0, candidates: [] };
  const byScore = scored.slice().sort((a, b) => b.score - a.score);
  const best = byScore[0];
  const second = byScore[1] ?? { score: 0 };
  const confidence = best.score > 0 ? Math.max(0, Math.min(1, 1 - second.score / best.score)) : 0;
  const candidates = byScore.slice(0, 5).map((s) => ({ bpm: s.bpm, score: s.score }));
  return { bpm: best.bpm, confidence, candidates };
}

// Ellis-style (2007) dynamic-programming beat tracker: maximises a cumulative score
// (onset-envelope value plus a transition cost penalising deviation from the target period
// in log space), then backtraces from the best-scoring frame near the end of the signal.
export function trackBeats(envelope, bpm, hopSeconds, opts = {}) {
  const n = envelope.length;
  if (n === 0 || !(bpm > 0)) return [];
  const period = 60 / bpm / hopSeconds; // target period, in frames
  const tightness = opts.tightness ?? 400;
  const cumScore = new Float64Array(n);
  const backlink = new Int32Array(n).fill(-1);
  const searchStart = Math.max(1, Math.round(period * 0.5));
  const searchEnd = Math.max(searchStart + 1, Math.round(period * 2));
  for (let i = 0; i < n; i++) {
    let best = 0, bestLoc = -1;
    for (let tau = searchStart; tau <= searchEnd; tau++) {
      const loc = i - tau;
      if (loc < 0) break;
      const logRatio = Math.log(tau / period);
      const score = cumScore[loc] - tightness * logRatio * logRatio;
      if (score > best) { best = score; bestLoc = loc; }
    }
    cumScore[i] = envelope[i] + best;
    backlink[i] = bestLoc;
  }
  // Last beat isn't necessarily the final frame: search the tail window first, then fall
  // back to the global max if the tail happened to be quiet.
  let last = 0, lastScore = -Infinity;
  const tailStart = Math.max(0, n - Math.round(period));
  for (let i = tailStart; i < n; i++) if (cumScore[i] > lastScore) { lastScore = cumScore[i]; last = i; }
  for (let i = 0; i < n; i++) if (cumScore[i] > lastScore) { lastScore = cumScore[i]; last = i; }
  const beatFrames = [];
  for (let cur = last; cur >= 0; cur = backlink[cur]) beatFrames.push(cur);
  beatFrames.reverse();
  return beatFrames.map((f) => f * hopSeconds);
}

function chromaDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < 12; i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); sum += d * d; }
  return Math.sqrt(sum);
}

// Best-effort downbeat detection: with beat-synchronous chroma, pick the phase (mod
// beatsPerBar) whose beat-to-beat chroma change is largest on average — harmony changes
// tend to land on bar lines. Without chroma, falls back to "every beatsPerBar-th beat from
// beat 0" at zero confidence.
export function downbeats(beats, chroma, opts = {}) {
  const beatsPerBar = opts.beatsPerBar ?? 4;
  if (!beats || beats.length === 0) return { downbeats: [], confidence: 0 };
  if (!chroma || chroma.length !== beats.length) {
    const idx = [];
    for (let i = 0; i < beats.length; i += beatsPerBar) idx.push(i);
    return { downbeats: idx.map((i) => beats[i]), confidence: 0 };
  }
  const scores = new Array(beatsPerBar).fill(0);
  const counts = new Array(beatsPerBar).fill(0);
  for (let i = 1; i < beats.length; i++) {
    const phase = i % beatsPerBar;
    scores[phase] += chromaDistance(chroma[i], chroma[i - 1]);
    counts[phase] += 1;
  }
  const avg = scores.map((s, p) => (counts[p] > 0 ? s / counts[p] : 0));
  let bestPhase = 0, bestVal = -Infinity;
  for (let p = 0; p < beatsPerBar; p++) if (avg[p] > bestVal) { bestVal = avg[p]; bestPhase = p; }
  const total = avg.reduce((a, b) => a + b, 0);
  const confidence = total > 0 ? Math.max(0, Math.min(1, bestVal / total)) : 0;
  const idx = [];
  for (let i = bestPhase; i < beats.length; i += beatsPerBar) idx.push(i);
  return { downbeats: idx.map((i) => beats[i]), confidence };
}
