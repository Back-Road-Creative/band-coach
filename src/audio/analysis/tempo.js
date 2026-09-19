// Wiring: estimateTempo(envelope, hopSeconds) -> {bpm, confidence, candidates} from
// onset-envelope.js's output. trackBeats(envelope, bpm, hopSeconds) -> array of beat times
// in seconds (Ellis-style dynamic-programming beat tracker). downbeats(beats, chroma) is
// best-effort and works with chroma === null/undefined (falls back to "every Nth beat").

// Autocorrelation-based tempo estimate with a log-normal prior centred on priorBpm, so a
// short, ambiguous excerpt is nudged toward plausible song tempos instead of picking an
// arbitrary harmonic/subharmonic of the true beat period.
export function estimateTempo(envelope, hopSeconds, opts = {}) {
  const minBpm = opts.minBpm ?? 60;
  const maxBpm = opts.maxBpm ?? 200;
  const priorBpm = opts.priorBpm ?? 110;
  const priorSigmaOctaves = opts.priorSigmaOctaves ?? 0.7;

  const n = envelope.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += envelope[i];
  mean /= Math.max(1, n);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = envelope[i] - mean;

  const minLag = Math.max(1, Math.round(60 / (maxBpm * hopSeconds)));
  const maxLag = Math.max(minLag + 1, Math.round(60 / (minBpm * hopSeconds)));
  const harmonics = opts.harmonics ?? 4;
  const rawLagLimit = Math.min(n - 1, maxLag * harmonics);

  // Raw (unweighted) autocorrelation at every lag we might need, either as a candidate or
  // as a harmonic of a candidate.
  const raw = new Float64Array(rawLagLimit + 1);
  for (let lag = minLag; lag <= rawLagLimit; lag++) {
    const count = n - lag;
    if (count <= 0) break;
    let sum = 0;
    for (let i = 0; i < count; i++) sum += x[i] * x[i + lag];
    raw[lag] = sum / count;
  }

  // Harmonic-sum scoring (comb-filter style): a true beat period shows autocorrelation
  // peaks at every integer multiple of its lag, so summing raw[lag], raw[2*lag], raw[3*lag]
  // (decreasingly weighted) favours the fundamental over half/double-tempo octave errors,
  // which only inherit every-other harmonic of the true period.
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
    scored.push({ lag, bpm, raw: raw[lag], score: harmonicSum * prior });
  }

  if (scored.length === 0) {
    return { bpm: priorBpm, confidence: 0, candidates: [] };
  }

  const byScore = scored.slice().sort((a, b) => b.score - a.score);
  const best = byScore[0];
  const second = byScore[1] ?? { score: 0 };
  const confidence = best.score > 0 ? Math.max(0, Math.min(1, 1 - second.score / best.score)) : 0;
  const candidates = byScore.slice(0, 5).map((s) => ({ bpm: s.bpm, score: s.score }));

  // Parabolic interpolation across the winning lag's integer neighbours refines the whole-
  // frame lag grid to sub-frame precision — otherwise bpm accuracy is capped by hopSeconds
  // (e.g. an 11ms hop alone caps precision at ~3% around 150bpm, worse than the 2% target).
  const byLag = scored; // already ordered by ascending lag
  const bestIdx = byLag.findIndex((s) => s.lag === best.lag);
  let refinedLag = best.lag;
  if (bestIdx > 0 && bestIdx < byLag.length - 1) {
    const yMinus = byLag[bestIdx - 1].score;
    const yZero = byLag[bestIdx].score;
    const yPlus = byLag[bestIdx + 1].score;
    const denom = yMinus - 2 * yZero + yPlus;
    if (denom !== 0) {
      const delta = (0.5 * (yMinus - yPlus)) / denom;
      if (Math.abs(delta) < 1) refinedLag = best.lag + delta;
    }
  }
  const refinedBpm = 60 / (refinedLag * hopSeconds);

  return { bpm: refinedBpm, confidence, candidates };
}

// Ellis-style (2007) dynamic-programming beat tracker: maximises a cumulative score that
// rewards high onset-envelope value at each beat and a transition cost penalising deviation
// from the target period (log-domain Gaussian around `period`), then backtraces from the
// best-scoring endpoint. Returns beat times in seconds.
export function trackBeats(envelope, bpm, hopSeconds, opts = {}) {
  const n = envelope.length;
  if (n === 0 || !(bpm > 0)) return [];

  const period = 60 / bpm / hopSeconds; // in frames
  const tightness = opts.tightness ?? 400;

  const cumScore = new Float64Array(n);
  const backlink = new Int32Array(n).fill(-1);

  const searchStart = Math.max(1, Math.round(period * 0.5));
  const searchEnd = Math.max(searchStart + 1, Math.round(period * 2));

  for (let i = 0; i < n; i++) {
    let best = 0;
    let bestLoc = -1;
    for (let tau = searchStart; tau <= searchEnd; tau++) {
      const loc = i - tau;
      if (loc < 0) break;
      const logRatio = Math.log(tau / period);
      const txScore = -tightness * logRatio * logRatio;
      const score = cumScore[loc] + txScore;
      if (score > best) {
        best = score;
        bestLoc = loc;
      }
    }
    cumScore[i] = envelope[i] + best;
    backlink[i] = bestLoc;
  }

  // Backtrace from the highest-scoring frame in the final period-or-so of the signal (the
  // last beat is not necessarily the very last frame).
  let last = 0;
  let lastScore = -Infinity;
  const tailStart = Math.max(0, n - Math.round(period));
  for (let i = tailStart; i < n; i++) {
    if (cumScore[i] > lastScore) {
      lastScore = cumScore[i];
      last = i;
    }
  }
  // Guard: if the tail window happened to be quiet, fall back to the global max.
  for (let i = 0; i < n; i++) {
    if (cumScore[i] > lastScore) {
      lastScore = cumScore[i];
      last = i;
    }
  }

  const beatFrames = [];
  let cur = last;
  while (cur >= 0) {
    beatFrames.push(cur);
    cur = backlink[cur];
  }
  beatFrames.reverse();

  return beatFrames.map((f) => f * hopSeconds);
}

function chromaDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// Best-effort downbeat detection: with beat-synchronous chroma available, pick the phase
// (mod beatsPerBar) whose beat-to-beat chroma change is largest on average — chord/harmony
// changes tend to land on bar lines. Without chroma, falls back to "every beatsPerBar-th
// beat starting at 0" with low confidence.
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

  let bestPhase = 0;
  let bestVal = -Infinity;
  for (let p = 0; p < beatsPerBar; p++) {
    if (avg[p] > bestVal) {
      bestVal = avg[p];
      bestPhase = p;
    }
  }

  const total = avg.reduce((a, b) => a + b, 0);
  const confidence = total > 0 ? Math.max(0, Math.min(1, bestVal / total)) : 0;

  const idx = [];
  for (let i = bestPhase; i < beats.length; i += beatsPerBar) idx.push(i);

  return { downbeats: idx.map((i) => beats[i]), confidence };
}
