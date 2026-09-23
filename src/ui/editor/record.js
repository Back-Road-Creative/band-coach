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
import { rangeForInstrument, FALLBACK_RANGE } from '../../audio/range.js';

// Falls back to the app's generic search band (src/audio/range.js) when
// createRecorder cannot resolve an instrument (see resolveRange below).
const DEFAULT_FMIN = FALLBACK_RANGE.fmin;
const DEFAULT_FMAX = FALLBACK_RANGE.fmax;

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
// matches the app's own generic-pitch polling cadence (app.js's tool-pitch
// interval) so the sample rate a learner records at is consistent with the
// rest of the app.
//
// fmin/fmax: an explicit override always wins (mainly for tests). Absent
// one, start() resolves the search range from `api.instrument()` -- the
// instrument the learner has picked in the main trainer, if any -- via
// rangeForInstrument. This panel has no instrument picker of its own (it can
// record a hum, a whistle or any instrument played into the mic), so when
// `api.instrument()` cannot resolve one (an unmapped mod, or none at all) it
// falls back to the app's generic search band, same as before.
export function createRecorder(api, { intervalMs = 50, fmin, fmax } = {}) {
  let frames = [];
  let timer = null;
  let startedAt = 0;
  let activeFmin = fmin;
  let activeFmax = fmax;
  // editor.js disables Listen before awaiting start(), but this recorder must
  // not depend on its caller for that: a double start() while openMic() is
  // still pending must not be allowed to run twice. `starting` holds the one in-flight start() promise; a second
  // call while it is set reuses it instead of opening a second mic and
  // creating a second, un-clearable setInterval. `stopRequested` covers the
  // narrower case where stop() lands while openMic() is still pending: the
  // interval must never start once that resolves.
  let starting = null;
  let stopRequested = false;

  async function doStart() {
    stopRequested = false;
    await api.openMic();
    if (stopRequested) { stopRequested = false; return; }
    resolveRange();
    frames = [];
    startedAt = api.now();
    timer = setInterval(tick, intervalMs);
  }

  function resolveRange() {
    if (activeFmin !== undefined && activeFmax !== undefined) return;
    const rec = typeof api.instrument === 'function' ? api.instrument() : null;
    const resolved = rangeForInstrument(rec);
    if (activeFmin === undefined) activeFmin = resolved.fmin;
    if (activeFmax === undefined) activeFmax = resolved.fmax;
  }

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
      fmin: activeFmin,
      fmax: activeFmax,
      gate: api.gates().pitch,
      t: api.now() - startedAt,
    });
    if (frame) frames.push(frame);
  }

  return {
    start() {
      if (timer) return Promise.resolve(); // already listening -- nothing to do
      if (starting) return starting; // already opening the mic for an earlier tap -- reuse it, never open a second one
      starting = doStart().finally(() => { starting = null; });
      return starting;
    },
    // Stops sampling and returns the captured frames (a copy). Also cancels
    // any start() still awaiting openMic, so it cannot start the interval
    // once it resolves.
    stop() {
      stopRequested = true;
      if (timer) clearInterval(timer);
      timer = null;
      return frames.slice();
    },
    get listening() {
      return timer !== null;
    },
    // The fmin/fmax this recorder is actually sampling with, once start()
    // has resolved it (undefined before that).
    get range() {
      return { fmin: activeFmin, fmax: activeFmax };
    },
  };
}
