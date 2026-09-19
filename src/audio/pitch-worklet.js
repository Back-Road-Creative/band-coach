// E3: pitch tracking ran on the main thread from setInterval(…, 50),
// allocating a 4096-float buffer per tick, running YIN's O(window * lag)
// autocorrelation in the event loop. This moves that work to an
// AudioWorkletProcessor, which runs on the audio rendering thread with its
// own pre-allocated buffers.
//
// The app ships as ONE bundled iife file opened via file://, with no
// sibling-file fetches allowed (see build/build.mjs and CLAUDE.md). A
// worklet module normally loads from its own .js file — not possible here —
// so the processor's source travels as a STRING, loaded through a `data:`
// URL (neither counts as a network request; addModule() never leaves the
// page). A `blob:` URL was tried first and rejected: pages opened from
// file:// have an opaque ("null") origin, and Chromium refuses to load an
// AudioWorklet module from a blob: URL created on a null-origin page
// ("a dependency or cross-origin script failed to load" — measured against
// the same headless Chromium tests/helpers/browser.mjs drives). A `data:`
// URL carries the whole source inline instead of pointing at a same-origin
// blob store, so that null-origin check never applies.
//
// To keep that string from drifting away from the main-thread maths, it is
// built by reading yin() and createOnsetDetector()'s own source text via
// Function.prototype.toString() rather than being retyped by hand. Both
// functions are written to be self-contained (no free variables reaching
// outside their own body — see yin.js's comment) specifically so they can be
// dropped into the worklet's global scope and just work.
import { yin } from './yin.js';
import { createOnsetDetector } from './onset.js';
import { FALLBACK_RANGE } from './range.js';

const PROCESSOR_NAME = 'band-coach-pitch-worklet';

// Item 4 (Wave W, unit w-fixes): the worklet was created once with a fixed
// fmin/fmax, unlike the old main-thread listen() path which read each
// module's own M.fmin/M.fmax every call. This is the port protocol that
// lets a caller re-range an already-created worklet: { type: 'range',
// fmin, fmax }. Self-contained (no free variables) so its source text can
// be embedded into the worklet string via toString(), same pattern as
// yin() and createOnsetDetector() above.
export function applyRangeMessage(proc, data) {
  if (!data || data.type !== 'range') return;
  if (typeof data.fmin === 'number' && isFinite(data.fmin)) proc.fmin = data.fmin;
  if (typeof data.fmax === 'number' && isFinite(data.fmax)) proc.fmax = data.fmax;
}

function buildProcessorSource() {
  return `
${yin.toString()}
${createOnsetDetector.toString()}
${applyRangeMessage.toString()}
class BandCoachPitchProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.frameSize = opts.frameSize || 2048;
    this.hop = opts.hop || 512;
    this.fmin = opts.fmin || ${FALLBACK_RANGE.fmin};
    this.fmax = opts.fmax || ${FALLBACK_RANGE.fmax};
    this.rmsGate = opts.rmsGate || 0.008;
    this.ring = new Float32Array(this.frameSize);
    this.linear = new Float32Array(this.frameSize);
    this.writeIdx = 0;
    this.filled = 0;
    this.sinceHop = 0;
    this.detector = createOnsetDetector({ sampleRate: sampleRate, frameSize: this.frameSize, hop: this.hop });
    this.port.onmessage = ev => applyRangeMessage(this, ev.data);
  }
  process(inputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.ring[this.writeIdx] = ch[i];
      this.writeIdx = (this.writeIdx + 1) % this.frameSize;
      if (this.filled < this.frameSize) this.filled++;
      this.sinceHop++;
      if (this.sinceHop >= this.hop && this.filled >= this.frameSize) {
        this.sinceHop = 0;
        for (let k = 0; k < this.frameSize; k++) this.linear[k] = this.ring[(this.writeIdx + k) % this.frameSize];
        const pitch = yin(this.linear, sampleRate, this.fmin, this.fmax, this.rmsGate);
        const onsetResult = this.detector.push(this.linear);
        this.port.postMessage({
          rms: pitch.rms,
          freq: pitch.freq,
          clarity: pitch.clarity || 0,
          onset: onsetResult.onset,
          strength: onsetResult.strength,
        });
      }
    }
    return true;
  }
}
registerProcessor('${PROCESSOR_NAME}', BandCoachPitchProcessor);
`;
}

export const PITCH_WORKLET_SOURCE = buildProcessorSource();

// actx: an AudioContext (or anything shaped like one — the check below is
// what lets the caller feature-detect and fall back to the setInterval path
// when AudioWorklet is unavailable, per E3's "needs an AudioWorklet, with a
// fallback" requirement).
export function createPitchNode(actx, opts = {}) {
  if (!actx || !actx.audioWorklet || typeof actx.audioWorklet.addModule !== 'function') {
    return Promise.reject(new Error('AudioWorklet is not available on this AudioContext'));
  }
  const encoded = btoa(unescape(encodeURIComponent(PITCH_WORKLET_SOURCE)));
  const url = `data:application/javascript;base64,${encoded}`;
  return actx.audioWorklet
    .addModule(url)
    .then(() => {
      return new AudioWorkletNode(actx, PROCESSOR_NAME, {
        numberOfInputs: 1,
        // A silent output, muted by createPitchNode's caller before it
        // reaches the destination: some engines only keep pulling an
        // AudioWorkletNode's process() calls while it is part of a graph
        // that reaches the destination, whatever inputs it has.
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        processorOptions: {
          frameSize: opts.frameSize || 2048,
          hop: opts.hop || 512,
          fmin: opts.fmin || FALLBACK_RANGE.fmin,
          fmax: opts.fmax || FALLBACK_RANGE.fmax,
          rmsGate: opts.rmsGate || 0.008,
        },
      });
    });
}
