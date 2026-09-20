import { writeFileSync } from 'node:fs';

// Pure-Node, dependency-free fixture generator for a REAL plucked-string
// signal, to replace the steady-sine/fixed-harmonic-ratio fixtures every
// existing mic test uses (testSource/testPluck in src/app.js: a sine plus
// 1/h^2 harmonics, fundamental always loudest — nothing a real guitar
// pluck, a noisy room, a weak fundamental, or a one-sided stereo interface
// ever produces). Deterministic: a seeded PRNG (mulberry32), never
// Math.random, so a fixture is byte-identical across runs and CI.
//
// Karplus-Strong: seed a ring buffer of length N = round(sampleRate/freq)
// with noise, then repeatedly output the oldest sample and feed a
// low-pass-filtered, decayed version of it back in. This is the standard
// plucked-string synthesis algorithm — a physically-motivated pluck, not a
// pure tone, with a natural attack transient and decaying envelope.

// mulberry32: a tiny, fast, seeded 32-bit PRNG. Good enough statistically
// for audio dither/noise-burst seeding; NOT cryptographic.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function rand() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One Karplus-Strong plucked string at `freq` Hz, `seconds` long, at
// `sampleRate`. `brightness` (0..1) blends the loop filter between a dull
// two-tap average (0) and the raw delayed sample (1) — higher brightness
// keeps more high-frequency content in the ring, closer to a bright pluck
// near the bridge. `decay` (<1, close to 1) is the per-sample loop-filter
// feedback gain that makes the string ring out. `seed` drives the initial
// noise burst deterministically.
export function karplusStrong(freq, sampleRate, seconds, { brightness = 0.5, decay = 0.996, seed = 1 } = {}) {
  const N = Math.max(2, Math.round(sampleRate / freq));
  const rand = mulberry32(seed);
  const ring = new Float32Array(N);
  for (let i = 0; i < N; i++) ring[i] = rand() * 2 - 1;
  const total = Math.max(0, Math.round(seconds * sampleRate));
  const out = new Float32Array(total);
  let idx = 0;
  for (let i = 0; i < total; i++) {
    const cur = ring[idx];
    const next = ring[(idx + 1) % N];
    const filtered = (1 - brightness) * 0.5 * (cur + next) + brightness * cur;
    out[i] = cur;
    ring[idx] = filtered * decay;
    idx = (idx + 1) % N;
  }
  return out;
}

// RMS of a Float32Array slice — used both by fixture generation (to reach a
// target overall gain) and by callers verifying a fixture's loudness.
export function rms(buf, start = 0, len = buf.length - start) {
  let s = 0;
  const end = Math.min(buf.length, start + len);
  for (let i = start; i < end; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, end - start));
}

function scaleToRms(buf, targetRms) {
  const cur = rms(buf);
  if (!(cur > 0) || !(targetRms >= 0)) return buf;
  const g = targetRms / cur;
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] * g;
  return out;
}

// Additive white-noise floor at a given RMS, seeded off the same PRNG family
// (a different seed than the pluck itself, so the two never cancel/reinforce
// in a seed-dependent way) — models a real room/interface noise floor under
// the signal, which none of the app's existing fixtures do.
function addNoiseFloor(buf, noiseRms, seed) {
  if (!(noiseRms > 0)) return buf;
  const rand = mulberry32(seed);
  const noise = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) noise[i] = rand() * 2 - 1;
  const scaled = scaleToRms(noise, noiseRms);
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] + scaled[i];
  return out;
}

// A plucked string whose SECOND HARMONIC is louder than its fundamental —
// the shape VERIFIED DEFECT 5 asks about: does yin() slip an octave on a
// weak-fundamental low string. Built as two Karplus-Strong strings (freq and
// 2*freq) summed at different gains — an approximation of a weak-fundamental
// partial balance, not a physically exact overtone series, but enough to
// pose the question yin() has to answer: which lag does it lock onto.
function pluckWeakFundamental(freq, sampleRate, seconds, opts) {
  const fundamental = karplusStrong(freq, sampleRate, seconds, { ...opts, seed: opts.seed });
  const secondHarmonic = karplusStrong(freq * 2, sampleRate, seconds, { ...opts, seed: opts.seed + 1 });
  const out = new Float32Array(fundamental.length);
  for (let i = 0; i < out.length; i++) out[i] = 0.4 * fundamental[i] + 1.0 * secondHarmonic[i];
  return out;
}

// The one entry point tests should use. Returns a mono Float32Array (or a
// { left, right } pair when `channels: 'stereo'`) representing `seconds` of
// audio: a pluck at `freq`, optionally weak-fundamental-shaped, optionally
// mixed with an additive noise floor, scaled to an overall `gain` (models a
// quiet mic/interface), with `silenceSeconds` of trailing silence appended
// (models a note ringing out into nothing, or a fixture padded for a
// steady-state analysis window).
export function pluck(freq, sampleRate, seconds, opts = {}) {
  const {
    brightness = 0.5,
    decay = 0.996,
    seed = 1,
    gain = 1,
    noiseFloorRms = 0,
    weakFundamental = false,
    silenceSeconds = 0,
    channels = 'mono',
    // Which channel carries the (only) signal in a stereo fixture — models a
    // guitar plugged into one side of a 2-channel audio interface input.
    channelSide = 'right',
    // decay:1, brightness:1 makes the loop filter a no-op, so the ring
    // never changes -- flat RMS from sample 0. For LEVEL-COMPARISON
    // fixtures only, never gate/calibration or mid-session-switch, where
    // decay is the point.
    steady = false,
  } = opts;
  const ksOpts = steady ? { brightness: 1, decay: 1, seed } : { brightness, decay, seed };

  let mono = weakFundamental
    ? pluckWeakFundamental(freq, sampleRate, seconds, ksOpts)
    : karplusStrong(freq, sampleRate, seconds, ksOpts);

  // Scale to gain relative to the raw KS output's own natural loudness,
  // rather than to a fixed target RMS, so a caller can ask for "half as
  // loud" (a quiet mic) without having to know the pluck's absolute level.
  if (gain !== 1) {
    const scaled = new Float32Array(mono.length);
    for (let i = 0; i < mono.length; i++) scaled[i] = mono[i] * gain;
    mono = scaled;
  }
  if (noiseFloorRms > 0) mono = addNoiseFloor(mono, noiseFloorRms, seed + 1000);

  const silenceSamples = Math.max(0, Math.round(silenceSeconds * sampleRate));
  if (silenceSamples > 0) {
    const withTail = new Float32Array(mono.length + silenceSamples);
    withTail.set(mono, 0);
    mono = withTail;
  }

  if (channels !== 'stereo') return mono;

  const left = new Float32Array(mono.length);
  const right = new Float32Array(mono.length);
  // channelSide 'both' models a hardware capsule that duplicates its one
  // real signal onto both channels identically -- the OTHER real interface
  // behaviour VERIFIED DEFECT 3's fix has to not double.
  if (channelSide === 'both') { left.set(mono, 0); right.set(mono, 0); }
  else { const target = channelSide === 'left' ? left : right; target.set(mono, 0); }
  return { left, right };
}

// Models a cable re-patched mid-session: the pluck's signal lives on
// `firstSide` for the first `switchAtSeconds`, then jumps to the OTHER
// channel for the rest of `seconds` -- the channel that was carrying signal
// falls silent, and the other one starts carrying it, without restarting
// the capture. Used to prove an adaptive mono-sum's periodic re-check
// actually re-routes, not just its one-time decision at mic-open.
export function pluckChannelSwitch(freq, sampleRate, seconds, switchAtSeconds, opts = {}) {
  const { firstSide = 'left', ...rest } = opts;
  const secondSide = firstSide === 'left' ? 'right' : 'left';
  const before = pluck(freq, sampleRate, switchAtSeconds, { ...rest, channels: 'stereo', channelSide: firstSide });
  const after = pluck(freq, sampleRate, seconds - switchAtSeconds, { ...rest, channels: 'stereo', channelSide: secondSide, seed: (rest.seed || 1) + 1 });
  const left = new Float32Array(before.left.length + after.left.length);
  const right = new Float32Array(before.right.length + after.right.length);
  left.set(before.left, 0); left.set(after.left, before.left.length);
  right.set(before.right, 0); right.set(after.right, before.right.length);
  return { left, right };
}

function clampSample(x) {
  return Math.max(-32767, Math.min(32767, Math.round(x * 32767)));
}

// 16-bit PCM WAV writer, mono or stereo (interleaved). `samplesOrPair` is
// either a mono Float32Array or a { left, right } pair from pluck() above.
export function writePluckWav(path, samplesOrPair, sampleRate) {
  const stereo = samplesOrPair && typeof samplesOrPair === 'object' && 'left' in samplesOrPair;
  const numChannels = stereo ? 2 : 1;
  const numFrames = stereo ? samplesOrPair.left.length : samplesOrPair.length;
  const dataSize = numFrames * numChannels * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numChannels * 2, 28); // byte rate
  buf.writeUInt16LE(numChannels * 2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    if (stereo) {
      buf.writeInt16LE(clampSample(samplesOrPair.left[i]), offset);
      buf.writeInt16LE(clampSample(samplesOrPair.right[i]), offset + 2);
      offset += 4;
    } else {
      buf.writeInt16LE(clampSample(samplesOrPair[i]), offset);
      offset += 2;
    }
  }
  writeFileSync(path, buf);
  return path;
}
