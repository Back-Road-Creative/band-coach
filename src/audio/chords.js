// Chroma extraction and chord judging for the chord-listening mode.
//
// Flaw fixed here (plan F6, L207/L489): a single harmonically rich note's
// own 2nd..6th harmonics land close to the octave, the fifth, a second
// octave and the major third of its own root. Under the old rule (score =
// how much of the target chord's own pitch classes are present in the
// chroma, each pc must clear >6%, ok = score>72% and every pc clears the
// floor) that harmonic spray alone was enough for a single note to be
// scored as a full major triad, with no penalty for a wrong extra note and
// only a weak ability to tell a major triad from its parallel minor.
// chords.test.mjs synthesises the case (see "CURRENT BEHAVIOUR (flaw F6)")
// and keeps the captured red output in the unit's report.
//
// Two independent fixes:
//   1. chroma() peels each strong peak's own 2nd..5th harmonic energy out
//      of the spectrum before folding to pitch classes, so a single note's
//      own harmonics stop masquerading as other notes' fundamentals.
//   2. judgeChord() requires every chord tone to be individually present
//      above a floor (catches a note or a power chord missing the third)
//      AND scores energy sitting on chord tones minus energy sitting
//      elsewhere (catches an added wrong note), instead of only scoring
//      how much of the target rang. TONE_FLOOR and SCORE_THRESHOLD were
//      picked from the measured score table in chords.test.mjs, not
//      guessed in advance.

const pc = m => ((Math.round(m) % 12) + 12) % 12;
const fmidi = f => 69 + 12 * Math.log2(f / 440);

// A genuine chord tone measured >=0.199 of total chroma energy across the
// fixture set (C..Dm triads, plain and octave-spread); a note's own stray
// harmonic (root alone, a power chord's missing third) measured <=0.146.
// 0.17 sits with margin on both sides.
const TONE_FLOOR = 0.17;
// (energy on chord tones) - (energy elsewhere): genuine triads measured
// >=0.586; a triad with one loud wrong note added measured <=0.436.
const SCORE_THRESHOLD = 0.5;

// db: per-bin magnitude spectrum in dB, e.g. from AnalyserNode.getFloatFrequencyData.
// sampleRate: audio context sample rate. FFT size is inferred as db.length * 2,
// matching AnalyserNode.frequencyBinCount = fftSize / 2.
export function chroma(db, sampleRate) {
  const n = db.length, fft = n * 2, hz = sampleRate / fft;
  const lo = Math.ceil(75 / hz), hi = Math.min(n, Math.floor(2100 / hz));

  const power = new Float64Array(n);
  for (let i = lo; i < hi; i++) {
    if (db[i] < -75) continue;
    power[i] = Math.pow(10, db[i] / 10);
  }

  // Harmonic suppression: scan bins low to high. A bin still holding energy
  // that is a local peak is treated as a fundamental, and the expected
  // power of its 2nd..5th harmonics (falling off as 1/h) is subtracted
  // from the bins nearest those harmonic frequencies, clamped so a bin
  // never goes negative. Bins already zeroed out by a lower fundamental
  // are skipped by the `p <= 0` guard, so a real harmonic never gets
  // mistaken for a second fundamental in its own right (which would
  // otherwise cascade into over-suppressing an unrelated higher note).
  const suppressed = power.slice();
  for (let i = lo; i < hi; i++) {
    const p = suppressed[i];
    if (p <= 0) continue;
    const isPeak = p > (suppressed[i - 1] || 0) && p >= (suppressed[i + 1] || 0);
    if (!isPeak) continue;
    const f0 = i * hz;
    for (let h = 2; h <= 5; h++) {
      const hIdx = Math.round((f0 * h) / hz);
      if (hIdx <= i || hIdx >= hi) continue;
      suppressed[hIdx] = Math.max(0, suppressed[hIdx] - p / h);
    }
  }

  const out = new Array(12).fill(0);
  let tot = 0;
  for (let i = lo; i < hi; i++) {
    const p = suppressed[i];
    if (p <= 0) continue;
    const k = pc(fmidi(i * hz));
    out[k] += p;
    tot += p;
  }
  return tot ? out.map(x => x / tot) : out;
}

// { chroma, targetPcs } -> { ok, score, missing, extra }
// ok requires every chord tone individually present (> TONE_FLOOR) AND the
// energy sitting on chord tones, minus energy sitting outside them, to
// clear SCORE_THRESHOLD.
export function judgeChord({ chroma, targetPcs }) {
  const wanted = new Set(targetPcs.map(pc));
  let inside = 0, outside = 0;
  const extra = [];
  for (let k = 0; k < 12; k++) {
    const e = chroma[k] || 0;
    if (wanted.has(k)) inside += e;
    else { outside += e; if (e > TONE_FLOOR) extra.push(k); }
  }
  const missing = targetPcs.filter(t => !((chroma[t] || 0) > TONE_FLOOR));
  const score = inside - outside;
  return { ok: missing.length === 0 && score > SCORE_THRESHOLD, score, missing, extra };
}
