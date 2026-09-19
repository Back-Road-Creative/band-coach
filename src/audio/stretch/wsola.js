// WSOLA (waveform-similarity overlap-add) time-stretcher.
//
// Stretches or compresses PCM audio in time WITHOUT changing its pitch, by
// re-reading the source at a similarity-matched offset near the "natural"
// (rate-scaled) analysis position and cross-fading (Hann overlap-add) into
// the output. Pure module: no DOM, no AudioContext, no timers, no randomness.
//
// Wiring notes for a later pass (do not need to read the internals below):
//   - createStretcher({ sampleRate, channels, rate }) returns a streaming engine:
//       .process(inputChunk: Float32Array) -> Float32Array   (may be length 0)
//       .flush() -> Float32Array                             (final tail; resets state)
//       .setRate(rate) -> number                             (clamped to [0.5, 1.25])
//       .getRate() -> number
//       .reset()  -> void                                    (clears buffered state, keeps rate)
//     Feed consecutive chunks of the learner's audio to .process(), call
//     .flush() once at end-of-stream to get the trailing samples. Only mono
//     (channels: 1) is implemented; run one engine per channel for stereo.
//   - stretch(pcm: Float32Array, rate, { sampleRate }) is the one-shot
//     convenience wrapper (whole buffer in, whole buffer out).
//   - processorSource() returns self-contained JS source text (the exact
//     stretch engine, via Function.prototype.toString, so it cannot drift
//     from this module) suitable for use inside an AudioWorkletProcessor:
//       const src = processorSource() + 'this.__createStretcherEngine = createStretcherEngine;';
//       // eval/new Function that text inside the worklet's registerProcessor module.
//     It references nothing outside Math and the typed-array constructors,
//     which are both available in AudioWorkletGlobalScope.

const RATE_MIN = 0.5;
const RATE_MAX = 1.25;

// IMPORTANT: createStretcherEngine must stay fully self-contained. Its source
// text (via .toString()) is shipped verbatim into an AudioWorklet by
// processorSource(), so it must not reference anything at module scope
// (only Math and typed-array globals, which exist in both places). Keep all
// constants and helpers declared *inside* this function.
function createStretcherEngine(options) {
  const opts = options || {};
  const sampleRate = opts.sampleRate || 44100;

  const RATE_MIN = 0.5;
  const RATE_MAX = 1.25;
  const FRAME = 1024;
  const HOP = 512;
  const DECIMATION = 4;
  const RADIUS = Math.max(64, Math.round(sampleRate * 0.01)); // +-10ms search window

  let rate = opts.rate != null ? opts.rate : 1;
  rate = rate < RATE_MIN ? RATE_MIN : rate > RATE_MAX ? RATE_MAX : rate;

  const hann = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  }

  let inBuf = new Float32Array(Math.max(FRAME * 8, (FRAME + RADIUS) * 4));
  let inLen = 0;
  let naturalPos = 0;
  const prevTail = new Float32Array(HOP);
  const frameScratch = new Float32Array(FRAME);
  const ola = new Float32Array(FRAME);

  let outBuf = new Float32Array(FRAME * 16);
  let outWritePos = 0;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function ensureInCapacity(extra) {
    if (inLen + extra <= inBuf.length) return;
    const grown = new Float32Array(Math.max(inLen + extra, inBuf.length * 2));
    grown.set(inBuf.subarray(0, inLen));
    inBuf = grown;
  }

  function ensureOutCapacity(need) {
    if (need <= outBuf.length) return;
    const grown = new Float32Array(Math.max(need, outBuf.length * 2));
    grown.set(outBuf.subarray(0, outWritePos));
    outBuf = grown;
  }

  function appendInput(chunk) {
    if (!chunk || !chunk.length) return;
    ensureInCapacity(chunk.length);
    inBuf.set(chunk, inLen);
    inLen += chunk.length;
  }

  function correlationScore(off, stride) {
    let score = 0;
    for (let i = 0; i < HOP; i += stride) {
      score += inBuf[off + i] * prevTail[i];
    }
    return score;
  }

  // Finds the offset in [minOffset, maxOffset] whose head (HOP samples)
  // best matches prevTail (the tail of the previously emitted frame),
  // preferring the offset closest to `center` on any tie/no-signal case
  // (this is what keeps rate===1 near-identity and silent regions stable
  // instead of drifting to one edge of the search window).
  function findBestOffset(minOffset, maxOffset, center) {
    const c = clamp(center, minOffset, maxOffset);
    let bestOffset = c;
    let bestScore = correlationScore(c, DECIMATION);
    const maxDelta = Math.max(maxOffset - c, c - minOffset);
    for (let d = DECIMATION; d <= maxDelta; d += DECIMATION) {
      const hi = c + d;
      if (hi <= maxOffset) {
        const s = correlationScore(hi, DECIMATION);
        if (s > bestScore) {
          bestScore = s;
          bestOffset = hi;
        }
      }
      const lo = c - d;
      if (lo >= minOffset) {
        const s = correlationScore(lo, DECIMATION);
        if (s > bestScore) {
          bestScore = s;
          bestOffset = lo;
        }
      }
    }

    // Full-resolution refine near the coarse winner.
    const rMin = Math.max(minOffset, bestOffset - DECIMATION + 1);
    const rMax = Math.min(maxOffset, bestOffset + DECIMATION - 1);
    let fineOffset = bestOffset;
    let fineScore = correlationScore(bestOffset, 1);
    for (let d = 1; d <= DECIMATION - 1; d++) {
      const hi = bestOffset + d;
      if (hi <= rMax) {
        const s = correlationScore(hi, 1);
        if (s > fineScore) {
          fineScore = s;
          fineOffset = hi;
        }
      }
      const lo = bestOffset - d;
      if (lo >= rMin) {
        const s = correlationScore(lo, 1);
        if (s > fineScore) {
          fineScore = s;
          fineOffset = lo;
        }
      }
    }
    return fineOffset;
  }

  function produceOneFrame() {
    const center = Math.floor(naturalPos);
    const minOffset = Math.max(0, center - RADIUS);
    const maxOffsetWanted = center + RADIUS;
    // Require the FULL nominal lookahead before deciding anything, so the
    // search window never shrinks just because a caller fed input in small
    // chunks — that would make process() output depend on chunk boundaries.
    if (maxOffsetWanted + FRAME > inLen) return false;
    const maxOffset = maxOffsetWanted;

    const offset = findBestOffset(minOffset, maxOffset, clamp(center, minOffset, maxOffset));

    for (let i = 0; i < FRAME; i++) {
      frameScratch[i] = inBuf[offset + i] * hann[i];
    }
    for (let i = 0; i < FRAME; i++) {
      ola[i] += frameScratch[i];
    }

    ensureOutCapacity(outWritePos + HOP);
    for (let i = 0; i < HOP; i++) {
      outBuf[outWritePos + i] = ola[i];
    }
    outWritePos += HOP;

    ola.copyWithin(0, HOP, FRAME);
    ola.fill(0, FRAME - HOP, FRAME);

    for (let i = 0; i < HOP; i++) {
      prevTail[i] = inBuf[offset + HOP + i];
    }

    naturalPos += HOP * rate;

    const dropTo = Math.floor(Math.min(naturalPos, offset)) - RADIUS - DECIMATION;
    if (dropTo > HOP) {
      inBuf.copyWithin(0, dropTo, inLen);
      inLen -= dropTo;
      naturalPos -= dropTo;
    }
    return true;
  }

  function process(inputChunk) {
    outWritePos = 0;
    appendInput(inputChunk);
    while (produceOneFrame()) {
      /* drain as many frames as the buffered input allows */
    }
    return outBuf.slice(0, outWritePos);
  }

  function flush() {
    outWritePos = 0;
    // Pad so every remaining real sample can still form a full analysis frame.
    appendInput(new Float32Array(FRAME + RADIUS + HOP));
    while (produceOneFrame()) {
      /* drain */
    }
    ensureOutCapacity(outWritePos + HOP);
    for (let i = 0; i < HOP; i++) {
      outBuf[outWritePos + i] = ola[i];
    }
    outWritePos += HOP;

    ola.fill(0);
    prevTail.fill(0);
    inLen = 0;
    naturalPos = 0;
    return outBuf.slice(0, outWritePos);
  }

  function reset() {
    inLen = 0;
    naturalPos = 0;
    outWritePos = 0;
    prevTail.fill(0);
    ola.fill(0);
  }

  function setRate(r) {
    rate = r < RATE_MIN ? RATE_MIN : r > RATE_MAX ? RATE_MAX : r;
    return rate;
  }

  function getRate() {
    return rate;
  }

  return { process, flush, reset, setRate, getRate };
}

export function createStretcher(options) {
  return createStretcherEngine(options);
}

// One-shot: stretch a whole buffer and return a whole buffer, trimmed/padded
// to the length the rate implies (output duration = input duration / rate),
// which the streaming engine only hits within one output block on its own.
export function stretch(pcm, rate, options) {
  const opts = options || {};
  const engine = createStretcherEngine({
    sampleRate: opts.sampleRate || 44100,
    channels: 1,
    rate,
  });
  const head = engine.process(pcm);
  const tail = engine.flush();
  const raw = new Float32Array(head.length + tail.length);
  raw.set(head, 0);
  raw.set(tail, head.length);

  const expectedLen = Math.max(0, Math.round(pcm.length / engine.getRate()));
  if (raw.length === expectedLen) return raw;
  if (raw.length > expectedLen) return raw.slice(0, expectedLen);
  const padded = new Float32Array(expectedLen);
  padded.set(raw, 0);
  return padded;
}

// Returns self-contained JS source text defining `createStretcherEngine`,
// built from this exact function's own source so the AudioWorklet copy can
// never drift from the module copy — see tests/unit/wsola.test.mjs.
export function processorSource() {
  return 'const createStretcherEngine = ' + createStretcherEngine.toString() + ';\n';
}
