// Shared deterministic synth helpers for audio-analysis unit tests. Not a *.test.mjs file
// so `node --test tests/unit/*.test.mjs` never picks it up directly.

export const SR = 22050;

// Deterministic seeded PRNG (mulberry32) — never Math.random in a fixture used by tests
// that assert exact tolerances.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function whiteNoise(seconds, sr, rng) {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rng() * 2 - 1;
  return out;
}

// Click track: short broadband burst at every beat, constant bpm, `beatsPerBar`-aligned bar 0.
export function clickTrack(seconds, bpm, sr) {
  const pcm = new Float32Array(Math.round(seconds * sr));
  const period = 60 / bpm;
  const clickLen = Math.round(0.004 * sr);
  const beatTimes = [];
  for (let t = 0; t < seconds; t += period) {
    beatTimes.push(t);
    const start = Math.round(t * sr);
    for (let i = 0; i < clickLen && start + i < pcm.length; i++) {
      pcm[start + i] += (i % 2 === 0 ? 1 : -1) * (1 - i / clickLen);
    }
  }
  return { pcm, beatTimes };
}

const NOTE_TO_MIDI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function midiToFreq(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

// intervals: array of semitone offsets from a root midi note, e.g. major triad [0,4,7].
export function addChord(pcm, sr, startSec, durSec, rootMidi, intervals, amp = 0.15, a4 = 440) {
  const start = Math.round(startSec * sr);
  const dur = Math.round(durSec * sr);
  const fadeLen = Math.round(0.01 * sr);
  for (let i = 0; i < dur && start + i < pcm.length; i++) {
    let s = 0;
    for (const iv of intervals) {
      const freq = midiToFreq(rootMidi + iv, a4);
      s += Math.sin((2 * Math.PI * freq * i) / sr);
    }
    s *= amp / intervals.length;
    const fade = Math.min(1, i / fadeLen, (dur - i) / fadeLen);
    pcm[start + i] += s * fade;
  }
}

// Build a click track plus a chord progression (I-IV-V-I), one chord per bar, in the given
// key. `mode` 'major' -> triads [0,4,7] on scale degrees 1,4,5,1; 'minor' -> natural minor
// triads on 1,4,5,1 (minor, minor, minor, minor for natural minor i-iv-v-i, all minor triads
// except using the *minor* v (no raised leading tone) to keep this a simple, unambiguous
// synthetic fixture).
export function synthesizeProgression({ bpm, bars, beatsPerBar = 4, tonicPc, mode, sr = SR, a4 = 440, rng = null }) {
  const secondsPerBeat = 60 / bpm;
  const totalSeconds = bars * beatsPerBar * secondsPerBeat + 0.5;
  const pcm = new Float32Array(Math.round(totalSeconds * sr));

  const { pcm: clicks, beatTimes } = clickTrack(totalSeconds, bpm, sr);
  for (let i = 0; i < pcm.length; i++) pcm[i] += clicks[i] * 0.6;

  const rootMidiBase = 60 + tonicPc; // around middle C
  const scaleDegreeSemitones = mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  const triadShape = mode === 'major' ? [0, 4, 7] : [0, 3, 7];
  const degrees = [1, 4, 5, 1]; // I-IV-V-I / i-iv-v-i (scale degree numbers, 1-indexed)
  const chordSymbols = [];
  for (let bar = 0; bar < bars; bar++) {
    const degree = degrees[bar % degrees.length];
    const rootSemitone = scaleDegreeSemitones[(degree - 1) % 7];
    const rootMidi = rootMidiBase + rootSemitone;
    const startSec = bar * beatsPerBar * secondsPerBeat;
    const durSec = beatsPerBar * secondsPerBeat;
    addChord(pcm, sr, startSec, durSec, rootMidi, triadShape, 0.18, a4);
    chordSymbols.push({ startBar: bar, rootPc: (tonicPc + rootSemitone) % 12, quality: mode === 'major' ? 'maj' : 'min' });
  }

  if (rng) {
    for (let i = 0; i < pcm.length; i++) pcm[i] += (rng() * 2 - 1) * 0.005;
  }

  return { pcm, sr, beatTimes, chordSymbols, tonicPc, mode, bpm };
}
