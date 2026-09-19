// Wiring: estimateChords(beatChroma, opts) takes one 12-bin chroma vector per beat (e.g.
// chroma.js's beatSynchronousChroma output) and returns one entry per beat:
// [{ startBeat: index, symbol, confidence }]. symbol is a letter chord name ('C', 'Am',
// 'G7') or 'N' for no-chord (silence/noise). Per-beat major/minor/dominant-7th template
// matching (cosine similarity vs. a binary chord-tone template) plus Viterbi smoothing with
// a self-transition bias, so one noisy beat doesn't flicker away from its neighbours.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CHORD_TYPES = [
  { suffix: '', intervals: [0, 4, 7] }, // major
  { suffix: 'm', intervals: [0, 3, 7] }, // minor
  { suffix: '7', intervals: [0, 4, 7, 10] }, // dominant 7th
];

function buildTemplates() {
  const templates = [];
  for (const { suffix, intervals } of CHORD_TYPES) {
    for (let root = 0; root < 12; root++) {
      const vector = new Float32Array(12);
      for (const iv of intervals) vector[(root + iv) % 12] = 1;
      const norm = Math.sqrt(intervals.length);
      for (let i = 0; i < 12; i++) vector[i] /= norm;
      templates.push({ symbol: NOTE_NAMES[root] + suffix, vector });
    }
  }
  return templates;
}

const TEMPLATES = buildTemplates();
const NO_CHORD_INDEX = TEMPLATES.length, NUM_STATES = TEMPLATES.length + 1; // extra state for 'N'

const dot = (a, b) => { let s = 0; for (let i = 0; i < 12; i++) s += a[i] * b[i]; return s; };
const vectorNorm = (v) => Math.sqrt(dot(v, v));

// Per-beat emission score for every chord state plus 'N'. Chord states score by cosine
// similarity to their template; 'N' scores high only when the beat has near-zero energy
// (silence/unpitched noise), independent of shape.
function computeEmissions(chroma, opts) {
  const silenceThreshold = opts.silenceThreshold ?? 1e-4;
  const energy = chroma.reduce((a, v) => a + v, 0);
  const norm = vectorNorm(chroma);
  const out = new Float32Array(NUM_STATES);
  for (let t = 0; t < TEMPLATES.length; t++) out[t] = norm > 0 ? dot(chroma, TEMPLATES[t].vector) / norm : 0;
  out[NO_CHORD_INDEX] = energy < silenceThreshold ? 2 : -2;
  return out;
}

// Viterbi decode with an additive self-transition bias: staying in the same chord state
// from one beat to the next is rewarded by `selfBias` (same units as cosine similarity, so
// ~0.1-0.3 is a mild nudge, not an override of strong evidence).
export function estimateChords(beatChroma, opts = {}) {
  const selfBias = opts.selfBias ?? 0.15;
  const n = beatChroma.length;
  if (n === 0) return [];
  const emissions = beatChroma.map((c) => computeEmissions(c, opts));
  const dp = [emissions[0].slice()];
  const back = [new Int32Array(NUM_STATES).fill(-1)];
  for (let i = 1; i < n; i++) {
    const prev = dp[i - 1];
    const row = new Float32Array(NUM_STATES);
    const backRow = new Int32Array(NUM_STATES);
    for (let s = 0; s < NUM_STATES; s++) {
      let best = -Infinity, bestPrev = 0;
      for (let p = 0; p < NUM_STATES; p++) {
        const score = prev[p] + (p === s ? selfBias : 0);
        if (score > best) { best = score; bestPrev = p; }
      }
      row[s] = best + emissions[i][s];
      backRow[s] = bestPrev;
    }
    dp.push(row);
    back.push(backRow);
  }
  let bestLast = 0, bestVal = -Infinity;
  const lastRow = dp[n - 1];
  for (let s = 0; s < NUM_STATES; s++) if (lastRow[s] > bestVal) { bestVal = lastRow[s]; bestLast = s; }
  const path = new Array(n);
  path[n - 1] = bestLast;
  for (let i = n - 1; i > 0; i--) path[i - 1] = back[i][path[i]];
  return path.map((state, i) => {
    const symbol = state === NO_CHORD_INDEX ? 'N' : TEMPLATES[state].symbol;
    const row = emissions[i];
    const maxScore = Math.max(...row);
    const minScore = Math.min(...row);
    const range = maxScore - minScore;
    const confidence = range > 0 ? Math.max(0, Math.min(1, (row[state] - minScore) / range)) : 0.5;
    return { startBeat: i, symbol, confidence };
  });
}
