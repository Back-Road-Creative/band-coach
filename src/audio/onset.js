// Onset detection for plucked/struck notes (F8: a same-note repeat on a
// ringing string is missed because the pitch loop only re-fires after RMS
// falls under 0.006 or the pitch changes — there is no attack detector).
//
// This is an ENERGY-flux detector, not a spectral-flux one: a plucked string
// (guitar/bass/ukulele) produces a sharp amplitude transient at the attack
// regardless of pitch, and the app already treats "same pitch, ringing" as
// the exact case a spectral comparison would be needed for — but two plucks
// of the SAME pitch look identical in the frequency domain, so spectral flux
// buys nothing here. What changes at the attack is amplitude: energy jumps
// up sharply, then decays. A full FFT per frame would cost O(frameSize log
// frameSize) for no extra discriminating power in this use case, so a plain
// RMS-energy flux with an adaptive threshold is the right tool.
//
// Zero allocation per push() after construction: the sliding-window mean and
// variance used for the adaptive threshold are tracked incrementally over a
// pre-allocated ring buffer (add the new value, subtract the one it evicts),
// never by re-summing an array.
export function createOnsetDetector({
  sampleRate,
  frameSize,
  hop,
  historyFrames = 43, // ~1s of history at a 512-sample hop @44.1kHz
  thresholdMult = 2.2,
  minFlux = 0.02,
  refractoryMs = 90,
} = {}) {
  if (!sampleRate || !frameSize) throw new Error('createOnsetDetector requires sampleRate and frameSize');
  const hopSize = hop || frameSize;

  const history = new Float32Array(historyFrames);
  let histIdx = 0;
  let histCount = 0;
  let histSum = 0;
  let histSumSq = 0;

  let prevEnergy = 0;
  const refractoryFrames = Math.max(1, Math.round((refractoryMs / 1000) * (sampleRate / hopSize)));
  let refractoryLeft = 0;

  return {
    // frame: a Float32Array (or typed-array view) of consecutive audio
    // samples — either the whole analysis window or just the newest hop's
    // worth. Returns { onset, strength } where strength is the raw
    // (unthresholded) energy flux, useful for debugging/visualisation.
    push(frame) {
      let sumSq = 0;
      for (let i = 0; i < frame.length; i++) sumSq += frame[i] * frame[i];
      const energy = Math.sqrt(sumSq / frame.length);

      const flux = Math.max(0, energy - prevEnergy);
      prevEnergy = energy;

      const mean = histCount ? histSum / histCount : 0;
      const variance = histCount ? Math.max(0, histSumSq / histCount - mean * mean) : 0;
      const threshold = mean + thresholdMult * Math.sqrt(variance) + minFlux;

      let onset = false;
      if (refractoryLeft > 0) {
        refractoryLeft--;
      } else if (flux > threshold) {
        onset = true;
        refractoryLeft = refractoryFrames;
      }

      // Update the sliding window AFTER judging this frame, so a genuine
      // attack never gets diluted into its own baseline.
      const evicted = history[histIdx];
      if (histCount < historyFrames) {
        histCount++;
      } else {
        histSum -= evicted;
        histSumSq -= evicted * evicted;
      }
      history[histIdx] = flux;
      histSum += flux;
      histSumSq += flux * flux;
      histIdx = (histIdx + 1) % historyFrames;

      return { onset, strength: flux };
    },
  };
}
