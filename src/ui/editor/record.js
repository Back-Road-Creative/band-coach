// Raw pitch-frame sampling for the "Record a tune" panel. Turns one read of
// the app's existing mic + analyser + YIN pipeline (src/audio/yin.js) into a
// plain frame `{ t, midi, rms, confidence }` -- exactly the shape
// src/song/transcribe.js's `transcribe(frames, opts)` expects as raw input
// (see that module's header: it wants continuous per-frame pitch-tracker
// output, not a merged note list).
//
// `sampleFrame` is pure (a Float32Array buffer, a sample rate and the other
// numbers in, one frame or null out) so it can be unit-tested with a
// synthetic sine wave, with no AudioContext or microphone involved.
// `createRecorder` is the thin, non-pure wiring around it: it drives
// `sampleFrame` on a timer against the Wave-W `panelApi`
// (openMic/analysers/gates/audio/now — see src/ui/panels.js and the
// "Wiring wave W" section of the author brief for what each one is).
import { yin } from '../../audio/yin.js';

// A generic vocal/instrumental register. panelApi does not expose a
// per-instrument fmin/fmax (those live only in the original app.js MODS
// table, e.g. app.js:229-238, never passed through panelApi), so recording
// uses the same wide default the app's own generic pitch tool falls back to
// (app.js:980's fmin/fmax literals).
const DEFAULT_FMIN = 60;
const DEFAULT_FMAX = 1600;

// One analyser read -> one raw frame, or null when nothing was heard clearly
// enough. `buf` must already be filled from the time-domain analyser
// (`analyser.getFloatTimeDomainData(buf)`). `confidence` is YIN's own
// clarity score, unchanged, so it means the same thing here as it does
// everywhere else in the app.
export function sampleFrame({ buf, sampleRate, fmin = DEFAULT_FMIN, fmax = DEFAULT_FMAX, gate, t }) {
  const r = yin(buf, sampleRate, fmin, fmax, gate);
  if (!r.freq) return null;
  const midi = 69 + 12 * Math.log2(r.freq / 440);
  const confidence = typeof r.clarity === 'number' ? Math.max(0, Math.min(1, r.clarity)) : 1;
  return { t, midi, rms: r.rms, confidence };
}

// Drives `sampleFrame` on a timer against the mic pipeline already open on
// the main app (openMic/analysers/gates come from panelApi). intervalMs
// matches the app's own generic-pitch polling cadence (app.js:980) so the
// sample rate a learner records at is consistent with the rest of the app.
export function createRecorder(api, { intervalMs = 50, fmin, fmax } = {}) {
  let frames = [];
  let timer = null;
  let startedAt = 0;

  function tick() {
    const analysers = api.analysers();
    const time = analysers && analysers.time;
    if (!time) return;
    const buf = new Float32Array(time.fftSize);
    time.getFloatTimeDomainData(buf);
    const actx = api.audio();
    if (!actx) return;
    const frame = sampleFrame({
      buf,
      sampleRate: actx.sampleRate,
      fmin,
      fmax,
      gate: api.gates().pitch,
      t: api.now() - startedAt,
    });
    if (frame) frames.push(frame);
  }

  return {
    async start() {
      await api.openMic();
      frames = [];
      startedAt = api.now();
      timer = setInterval(tick, intervalMs);
    },
    // Stops sampling and returns the captured frames (a copy).
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      return frames.slice();
    },
    get listening() {
      return timer !== null;
    },
  };
}
