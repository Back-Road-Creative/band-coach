// Pure PCM accumulation for the "Record a take" control in the play-along
// panel (src/ui/playalong.js's "duet with yourself" — record a take, then
// use it as backing). Turns a stream of small mono PCM chunks — however the
// caller captured them (this app polls an AnalyserNode on a timer for its
// mic reads elsewhere; see src/ui/editor/record.js and playalong.js's
// startRecordingCapture for that pattern) — into one contiguous
// Float32Array, capped at a maximum duration so a learner who forgets to
// press "stop" cannot grow a take without bound.
//
// No DOM, no AudioContext: push() takes plain typed arrays, so this is
// unit-testable with synthetic chunks (tests/unit/take-recorder.test.mjs).
// The caller owns the clock (when to push, when to stop) — same division of
// labour as src/core/groove.js.

export const DEFAULT_MAX_DURATION_SEC = 300; // 5 minutes

export function createTakeAccumulator(sampleRate, { maxDurationSec = DEFAULT_MAX_DURATION_SEC } = {}) {
  if (!(sampleRate > 0)) throw new Error('createTakeAccumulator needs a positive sampleRate');
  if (!(maxDurationSec > 0)) throw new Error('createTakeAccumulator needs a positive maxDurationSec');
  const maxSamples = Math.max(1, Math.round(maxDurationSec * sampleRate));
  const chunks = [];
  let total = 0;
  let full = false;

  return {
    // Appends one chunk of mono PCM (a Float32Array, or any array-like of
    // numbers). Returns false once the cap has been reached — nothing more
    // is kept from that point on — so a caller polling on a timer knows to
    // stop pushing (and can stop its own timer) without tracking the cap
    // itself.
    push(chunk) {
      if (full || !chunk || !chunk.length) return !full;
      const room = maxSamples - total;
      if (room <= 0) {
        full = true;
        return false;
      }
      const n = Math.min(chunk.length, room);
      const slice = new Float32Array(n);
      for (let i = 0; i < n; i++) slice[i] = chunk[i];
      chunks.push(slice);
      total += n;
      if (total >= maxSamples) full = true;
      return !full;
    },
    get durationSec() {
      return total / sampleRate;
    },
    get sampleCount() {
      return total;
    },
    get isFull() {
      return full;
    },
    // Concatenates every pushed chunk into one Float32Array. Safe to call
    // more than once (does not clear state, does not stop accepting pushes).
    finish() {
      const pcm = new Float32Array(total);
      let offset = 0;
      for (const c of chunks) {
        pcm.set(c, offset);
        offset += c.length;
      }
      return { pcm, sampleRate, duration: total / sampleRate };
    },
  };
}
