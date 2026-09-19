// Wiring: estimateKey(chromaVector) takes ONE aggregated 12-bin chroma vector (sum or
// average of beat-synchronous chroma across the whole piece, or a section of it) and
// returns { tonic: 0-11, mode: 'major'|'minor', confidence: 0..1 }. Krumhansl-Schmuckler
// key-finding: correlate the input against the classic tonal-hierarchy profiles for all 24
// keys, and take the best match. Pitch class 0 = C.

// Krumhansl & Kessler (1982) tonal hierarchy ratings, tonic-relative (index 0 = tonic).
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function rotate(profile, tonic) {
  const out = new Array(12);
  for (let pc = 0; pc < 12; pc++) {
    out[pc] = profile[(pc - tonic + 12) % 12];
  }
  return out;
}

function pearson(x, y) {
  const n = x.length;
  let meanX = 0, meanY = 0;
  for (let i = 0; i < n; i++) { meanX += x[i]; meanY += y[i]; }
  meanX /= n; meanY /= n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

export function estimateKey(chromaVector) {
  const candidates = [];
  for (const [mode, profile] of [['major', MAJOR_PROFILE], ['minor', MINOR_PROFILE]]) {
    for (let tonic = 0; tonic < 12; tonic++) {
      const rotated = rotate(profile, tonic);
      const r = pearson(chromaVector, rotated);
      candidates.push({ tonic, mode, r });
    }
  }
  candidates.sort((a, b) => b.r - a.r);
  const best = candidates[0];
  const second = candidates[1] ?? { r: 0 };
  // Margin between best and runner-up correlation, scaled into 0..1 — a decisive winner
  // (margin near the theoretical max ~2.0 for r in [-1,1]) gets confidence near 1; a near
  // tie (flat/ambiguous chroma) gets confidence near 0.
  const margin = best.r - second.r;
  const confidence = Math.max(0, Math.min(1, margin / 0.3));

  return { tonic: best.tonic, mode: best.mode, confidence };
}
