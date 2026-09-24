// Drum-hit classifier for the microphone path of the drum-kit trainer. MIDI drums say
// exactly which pad was struck; a mic in front of an acoustic kit does not, so at each
// detected onset this looks at ONE analysis frame and says which of three classes it
// heard: 'kick', 'snare' or 'hihat' (hi-hat and cymbals together), or null when unsure.
// Pure: no DOM, no AudioContext; the caller supplies plain Float32Array PCM.
//
// Wiring: createDrumClassifier({ sampleRate, frameSize }).classify(frame) for one frame;
// classifyHits(samples, { sampleRate, frameSize, hop }) runs src/audio/onset.js's
// createOnsetDetector over a whole buffer and classifies each onset -> [{ t, kind,
// confidence }] (kind may be null: an onset was heard but could not be named).
//
// Method: band-energy SHARES from one Hann-windowed FFT (FFTProcessor, the shared
// src/audio/analysis/fft.js, reused rather than a second FFT): low 40-150 Hz, mid
// 150-1500 Hz, high 3-12 kHz, each divided by their sum, so the answer does not depend on
// how loud the hit or how hot the mic gain is. A kick is low-dominant; a hi-hat/cymbal is
// high-dominant with almost no low end; a snare is broadband -- a strong mid (the shell
// tone) AND a noticeable high (the snare wires). Anything else is null.
//
// Priority rule when drums coincide: kick, then snare, then hi-hat. A beat that has the
// kick (or snare) plus the hat riding on it is reported as 'kick' (or 'snare'): the hat
// plays every eighth anyway, so the drum the learner was asked for on that beat is the
// one that counts. The rules are checked in that order, so this is by construction.
//
// Frame alignment: classify() expects a frame that starts just before the attack (the
// Hann window weights the middle, so an attack at the very end of the frame is mostly
// windowed away). classifyHits() does that alignment: it finds the attack inside the
// onset frame (the 64-sample block with the largest energy jump) and analyses the
// frameSize samples starting frameSize/8 before it.
//
// Zero allocation per classify() after construction: the FFT buffers live in the
// FFTProcessor, the zero-padded input frame is pre-allocated, and the SAME result object
// is returned every call (copy it if you keep it past the next call -- the same contract
// as FFTProcessor.process()).
//
// Mic detectability was MEASURED with synthesized signals, not assumed
// (tests/unit/drum-classify.test.mjs, 44.1 kHz, 2048-sample frame / 512 hop):
// - Isolated hits, identical at -6, -18 and -30 dBFS peak (shares are level-free):
//   kick  (sine, 120->50 Hz pitch drop in ~40 ms, ~150 ms decay): low .996 mid .004
//         high .000 -> 'kick', confidence 1.00;
//   snare (180+330 Hz tone ~120 ms + 1-8 kHz noise ~150 ms): low .003 mid .858 high .139
//         -> 'snare', confidence 0.70 (0.63-0.85 over 30 noise seeds at -18 dBFS);
//   hi-hat (noise high-passed above 5 kHz, ~60 ms): high 1.000 -> 'hihat', 1.00.
//   The snare is the weakest call: its wires are only ~14% of the in-band energy.
// - Two-bar rock beat at 100 bpm (hat every eighth, kick 1+3, snare 2+4, coincidences
//   summed): 16 of 16 onsets, every one the right class; kick+hat 1.00, snare+hat 0.80,
//   hat alone 1.00.
// - The same rock beat rescaled to -30 dBFS peak (a quiet mic): still 16 of 16, all right.
// - Steady white noise at 0.3, 0.1, 0.01, 0.001 amplitude: at most its one start onset.
// - Silence: no hits. A sustained 440 Hz sine (a held guitar note): one onset at the
//   attack, classified null (mid-only, no high band), never kick or snare.
// NOT measured: a real kit through a real mic and room. Toms, rides and crashes with a
// lot of mid energy may come back null or as 'snare'; the thresholds below are fitted to
// the synthesized hits above and should be revisited with recorded kits.
import { FFTProcessor } from './analysis/fft.js';
import { createOnsetDetector } from './onset.js';

const BANDS = { low: [40, 150], mid: [150, 1500], high: [3000, 12000] };
const ATTACK_BLOCK = 64;
const HISTORY_S = 0.1;
const MIN_FLUX = 0.0005;
const REL_JUMP = 0.1;

export function createDrumClassifier({ sampleRate, frameSize } = {}) {
  if (!(sampleRate > 0) || !frameSize) throw new Error('createDrumClassifier requires sampleRate and frameSize');
  const proc = new FFTProcessor(frameSize); // throws on a non-power-of-two frameSize
  const input = new Float32Array(frameSize);
  const binHz = sampleRate / frameSize, nyq = frameSize / 2;
  const bin = (hz) => Math.min(nyq, Math.max(1, Math.round(hz / binHz)));
  const lowA = bin(BANDS.low[0]), lowB = bin(BANDS.low[1]), midB = bin(BANDS.mid[1]);
  const highA = bin(BANDS.high[0]), highB = bin(BANDS.high[1]);
  const bands = { low: 0, mid: 0, high: 0 };
  const result = { kind: null, confidence: 0, bands };
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const sumSq = (mag, a, b) => { let s = 0; for (let i = a; i < b; i++) s += mag[i] * mag[i]; return s; };

  return {
    // frame: Float32Array (or view) starting just before the attack; shorter frames are
    // zero-padded, longer ones use the first frameSize samples.
    classify(frame) {
      const n = Math.min(frame.length, frameSize);
      for (let i = 0; i < n; i++) input[i] = frame[i];
      for (let i = n; i < frameSize; i++) input[i] = 0;
      const mag = proc.process(input);
      const low = sumSq(mag, lowA, lowB), mid = sumSq(mag, lowB, midB), high = sumSq(mag, highA, highB);
      const total = low + mid + high;
      result.kind = null; result.confidence = 0;
      // Only (near-)digital silence is refused here; the shares below carry no level.
      if (!(total > 1e-9)) { bands.low = 0; bands.mid = 0; bands.high = 0; return result; }
      // Rules in priority order (kick > snare > hi-hat). Confidence is 0.5 at a rule's
      // threshold rising to 1 with the margin past it (for the snare, its weaker margin).
      const L = low / total, M = mid / total, H = high / total;
      bands.low = L; bands.mid = M; bands.high = H;
      if (L >= 0.4) { result.kind = 'kick'; result.confidence = clamp01(0.5 + (L - 0.4) / 0.4); }
      else if (M >= 0.15 && H >= 0.08 && L < 0.25) { result.kind = 'snare'; result.confidence = clamp01(0.5 + Math.min(M - 0.15, H - 0.08) / 0.3); }
      else if (H >= 0.7 && L < 0.05) { result.kind = 'hihat'; result.confidence = clamp01(0.5 + (H - 0.7) / 0.5); }
      return result;
    },
  };
}

// Whole-buffer driver: onset detection (energy flux, src/audio/onset.js) then one
// classify() per onset, on a frame aligned to the attack. Returns [{ t, kind, confidence }]
// with t in seconds at the attack; kind null means "heard a hit, could not tell which".
export function classifyHits(samples, { sampleRate, frameSize, hop } = {}) {
  const hopSize = hop || frameSize;
  // Two onset.js defaults are overridden for drums (both measured on the rock beat):
  // ~100 ms of flux history instead of ~1 s -- with the default, one loud kick or snare
  // sits in the baseline for a whole second and lifts the threshold above every quieter
  // hat that follows (8 of 16 onsets); drum strokes are never closer than the 90 ms
  // refractory anyway. And a minFlux floor of 0.0005 RMS (about -66 dBFS) instead of 0.02:
  // the default absolute floor lost hits as the mic got quieter (11 of 16 at -6 dBFS
  // peak, 4 at -18, 0 at -30); 0.0005 keeps 16 of 16 down to -30 dBFS while steady noise
  // and a held note still give only their one start onset (the adaptive mean + 2.2 sd
  // term, not the floor, is what rejects a steady noise floor). Because the floor is now
  // tiny, a loud steady noise (a fan, hiss at -10 dBFS) wobbles over it; so an onset must
  // ALSO be a real rise: flux >= REL_JUMP of the frame's RMS. Measured: real hits on the
  // rock beat 0.99-1.00, wobble on white noise at 0.1/0.3 amplitude 0.01-0.02 (it gave 2-13
  // false hits in 3 s without this check, 0 extra with it).
  const det = createOnsetDetector({ sampleRate, frameSize, hop: hopSize, historyFrames: Math.max(4, Math.round((HISTORY_S * sampleRate) / hopSize)), minFlux: MIN_FLUX });
  const clf = createDrumClassifier({ sampleRate, frameSize });
  const preroll = frameSize >> 3;
  const hits = [];
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    const o = det.push(samples.subarray(start, start + frameSize));
    if (!o.onset) continue;
    let attack = start, prevE = Infinity, bestJump = 0, frameE = 0; // no rise found -> the frame start
    for (let b = start; b + ATTACK_BLOCK <= start + frameSize; b += ATTACK_BLOCK) {
      let e = 0;
      for (let i = b; i < b + ATTACK_BLOCK; i++) e += samples[i] * samples[i];
      if (e - prevE > bestJump) { bestJump = e - prevE; attack = b; }
      prevE = e; frameE += e;
    }
    if (o.strength < REL_JUMP * Math.sqrt(frameE / frameSize)) continue;
    const from = Math.max(0, attack - preroll);
    const r = clf.classify(samples.subarray(from, from + frameSize));
    hits.push({ t: attack / sampleRate, kind: r.kind, confidence: r.confidence });
  }
  return hits;
}
