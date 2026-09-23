// Pure RMS level reading for the "Learn this" panel's mic door level meter
// (src/ui/learn.js, plan §11.5.7, unit G1b). A plain Float32Array of
// time-domain samples (`analysers().time.getFloatTimeDomainData(buf)`) in, a
// number clamped to 0..1 out -- no AnalyserNode, no DOM, so the meter's own
// arithmetic is testable with a synthetic buffer.
export function rmsLevel(buf) {
  if (!buf || !buf.length) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  return Math.min(1, Math.max(0, rms));
}
