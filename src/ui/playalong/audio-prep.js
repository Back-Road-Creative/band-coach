// Pure helpers for the "play along with a recording" panel: turning a
// decoded multi-channel AudioBuffer into the plain mono Float32Array that
// src/audio/analysis/analyse.js expects, and formatting seconds for display.
// No DOM, no AudioContext — the wiring pass in src/ui/playalong.js reads
// channel data out of the decoded AudioBuffer and passes plain arrays here.

export function mixToMono(channels) {
  if (!channels || channels.length === 0) {
    throw new Error('mixToMono needs at least one channel');
  }
  const length = channels[0].length;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let c = 0; c < channels.length; c++) sum += channels[c][i];
    out[i] = sum / channels.length;
  }
  return out;
}

// "m:ss", zero-padded seconds. Defensive against NaN/negative input so a
// stray computation never renders "NaN:NaN" in the UI.
export function formatTime(seconds) {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const whole = Math.floor(s);
  const m = Math.floor(whole / 60);
  const sec = whole % 60;
  return m + ':' + String(sec).padStart(2, '0');
}

// Lets a long-running analyse() call be interrupted by a learner's Cancel
// click. `isCancelled` is read fresh on every progress tick (analyse.js's
// own yields between chunks are the interruption points); throwing from
// inside onProgress is analyse()'s only exit hatch, since it takes no
// separate cancel token.
export class AnalysisCancelledError extends Error {
  constructor(message = 'analysis cancelled') {
    super(message);
    this.name = 'AnalysisCancelledError';
  }
}

export function makeCancellableProgress(onProgress, isCancelled) {
  return (p) => {
    if (isCancelled()) throw new AnalysisCancelledError();
    onProgress(p);
  };
}
