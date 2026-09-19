// Pitch estimator (YIN algorithm), extracted verbatim from its original
// inline definition in src/app.js (E3). This is now the ONE implementation:
// the main thread imports it directly, and src/audio/pitch-worklet.js reads
// this function's own source text (via Function.prototype.toString()) to
// build the AudioWorkletProcessor string, so the two paths can never drift
// apart — there is nowhere else this maths is written down.
//
// Deliberately unchanged from the original: same thresholds (the rms floor
// defaults to 0.008 and takes the calibrated quiet-room gate as `rmsGate`;
// 0.15 / 0.3 clarity cutoffs), same O(window * lag) autocorrelation.
//
// Fully self-contained on purpose (the +/-1 clamp is inlined rather than
// calling a shared `clamp` helper): src/audio/pitch-worklet.js embeds this
// function's own source text, via Function.prototype.toString(), directly
// into the AudioWorkletProcessor string it builds, and a worklet's global
// scope has no access to any binding from this module other than what
// toString() captures. A free variable here would be a ReferenceError
// inside the worklet only, invisible to every test that calls yin()
// directly on the main thread — so it stands alone.
export function yin(buf, sr, fmin, fmax, rmsGate = 0.008) {
  const n = buf.length; let rms = 0; for (let i = 0; i < n; i++) rms += buf[i] * buf[i]; rms = Math.sqrt(rms / n); if (rms < rmsGate) return { rms: rms, freq: 0 };
  const tauMax = Math.min(Math.floor(sr / fmin), (n >> 1) - 1), tauMin = Math.max(2, Math.floor(sr / fmax)), W = n - tauMax, d = new Float32Array(tauMax + 2);
  for (let tau = 1; tau <= tauMax + 1; tau++) { let s = 0; for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x; } d[tau] = s; }
  let run = 0; const c = new Float32Array(tauMax + 2); c[0] = 1; for (let tau = 1; tau <= tauMax + 1; tau++) { run += d[tau]; c[tau] = run ? d[tau] * tau / run : 1; }
  let best = -1; for (let tau = tauMin; tau <= tauMax; tau++) { if (c[tau] < 0.15) { while (tau + 1 <= tauMax && c[tau + 1] < c[tau]) tau++; best = tau; break; } }
  if (best < 0) { let mn = 1, at = -1; for (let tau = tauMin; tau <= tauMax; tau++) if (c[tau] < mn) { mn = c[tau]; at = tau; } if (mn > 0.3) return { rms: rms, freq: 0 }; best = at; }
  const a = c[best - 1], b = c[best], e = c[best + 1], den = a - 2 * b + e, shift = den ? 0.5 * (a - e) / den : 0;
  const clampedShift = Math.max(-1, Math.min(1, shift));
  return { rms: rms, freq: sr / (best + clampedShift), clarity: 1 - c[best] };
}
