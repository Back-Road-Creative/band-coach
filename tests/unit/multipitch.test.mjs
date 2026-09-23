import test from 'node:test';
import assert from 'node:assert/strict';
import { FFTProcessor } from '../../src/audio/analysis/fft.js';
import { detectPitches, multipitchTrack, midiToFreq } from '../../src/audio/analysis/multipitch.js';
import { starterSongs } from '../../src/song/starter/index.js';
import { transpose, ticksToSeconds } from '../../src/song/model.js';
import { scoreNotes } from '../../src/song/eval/note-f1.js';

const SAMPLE_RATE = 44100;
const FFT_SIZE = 16384; // fine frequency resolution for isolated-tone/chord probes
const PARTIALS = [1, 0.5, 0.25, 0.125, 0.06, 0.03]; // fundamental + 5 decaying partials

// Sums one or more harmonic tones (fundamental + decaying partials, per PARTIALS)
// into a single FFT_SIZE-long buffer and returns its magnitude spectrum -- the
// same shape FFTProcessor.process/magnitudeSpectrum hand detectPitches in the
// real pipeline.
function harmonicChordSpectrum(freqs) {
  const pcm = new Float32Array(FFT_SIZE);
  for (const freq of freqs) {
    for (let i = 0; i < FFT_SIZE; i++) {
      for (let h = 1; h <= PARTIALS.length; h++) {
        pcm[i] += PARTIALS[h - 1] * Math.sin((2 * Math.PI * freq * h * i) / SAMPLE_RATE);
      }
    }
  }
  const proc = new FFTProcessor(FFT_SIZE);
  return proc.process(pcm).slice();
}

test('single harmonic tone detects exactly its own fundamental, not the octave or fifth', () => {
  const mag = harmonicChordSpectrum([midiToFreq(60)]); // C4
  const picks = detectPitches(mag, SAMPLE_RATE, FFT_SIZE, { maxVoices: 4 });
  assert.deepEqual(picks.map((p) => p.midi), [60]);
});

test('two-note chord (C4+E4, a major third) detects both and only those', () => {
  const mag = harmonicChordSpectrum([midiToFreq(60), midiToFreq(64)]);
  const picks = detectPitches(mag, SAMPLE_RATE, FFT_SIZE, { maxVoices: 4 });
  assert.deepEqual(picks.map((p) => p.midi).sort((a, b) => a - b), [60, 64]);
});

test('two-note chord a perfect twelfth apart (C3+G4, where G4 sits on C3\'s 3rd harmonic) detects both', () => {
  const mag = harmonicChordSpectrum([midiToFreq(48), midiToFreq(67)]);
  const picks = detectPitches(mag, SAMPLE_RATE, FFT_SIZE, { maxVoices: 4 });
  assert.deepEqual(picks.map((p) => p.midi).sort((a, b) => a - b), [48, 67]);
});

test('caps at maxVoices even when more notes are sounding', () => {
  const chordMidis = [48, 52, 55, 58, 62]; // 5-note stacked chord
  const mag = harmonicChordSpectrum(chordMidis.map(midiToFreq));
  const picks = detectPitches(mag, SAMPLE_RATE, FFT_SIZE, { maxVoices: 4 });
  assert.equal(picks.length, 4);
  // every pick is one of the real notes -- capping never invents a pitch.
  for (const p of picks) assert.ok(chordMidis.includes(p.midi), `unexpected midi ${p.midi}`);
});

test('silence yields no pitches', () => {
  const mag = harmonicChordSpectrum([]);
  const picks = detectPitches(mag, SAMPLE_RATE, FFT_SIZE, { maxVoices: 4 });
  assert.deepEqual(picks, []);
});

// --- Round-trip proof: a two-voice render of a starter song, scored with the
// shared note-f1.js scorer. NOT audio synthesis via roundtrip.js's per-frame
// tracker stand-in (that harness is for transcribe.js's monophonic input) --
// this renders real PCM (harmonic tones, per PARTIALS) for two simultaneous
// voices (the melody, and the same melody transposed down a minor sixth, so
// the two voices never land on a simple small-integer frequency ratio) and
// runs it through multipitchTrack end-to-end, exactly the entry point a real
// caller would use.

const ROUNDTRIP_SAMPLE_RATE = 44100;
const ROUNDTRIP_FFT_SIZE = 4096; // shorter analysis window -- these are short notes, not long tones
const SECOND_VOICE_SEMITONES = -8;

function renderVoicePcm(song, totalSamples, semitones) {
  const pcm = new Float32Array(totalSamples);
  const voice = transpose(song, semitones);
  for (const note of voice.parts[0].notes) {
    const onsetSec = ticksToSeconds(note.start, song.bpm);
    const durSec = ticksToSeconds(note.dur, song.bpm) * 0.75; // leave an audible rest so repeated same-pitch notes re-attack
    const startSample = Math.round(onsetSec * ROUNDTRIP_SAMPLE_RATE);
    const nSamples = Math.round(durSec * ROUNDTRIP_SAMPLE_RATE);
    const freq = midiToFreq(note.midi);
    const fadeSamples = Math.min(200, Math.floor(nSamples / 4));
    for (let i = 0; i < nSamples && startSample + i < totalSamples; i++) {
      let s = 0;
      for (let h = 1; h <= PARTIALS.length; h++) s += PARTIALS[h - 1] * Math.sin((2 * Math.PI * freq * h * i) / ROUNDTRIP_SAMPLE_RATE);
      let env = 1;
      if (i < fadeSamples) env = i / fadeSamples;
      else if (i > nSamples - fadeSamples) env = (nSamples - i) / fadeSamples;
      pcm[startSample + i] += s * env;
    }
  }
  return pcm;
}

test('two-voice starter-song render meets the measured F1 floor', () => {
  const song = starterSongs.find((s) => s.id === 'hot-cross-buns');
  const lastNote = song.parts[0].notes.at(-1);
  const totalSec = ticksToSeconds(lastNote.start + lastNote.dur, song.bpm) + 0.5;
  const totalSamples = Math.ceil(totalSec * ROUNDTRIP_SAMPLE_RATE);

  const pcmA = renderVoicePcm(song, totalSamples, 0);
  const pcmB = renderVoicePcm(song, totalSamples, SECOND_VOICE_SEMITONES);
  const pcm = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) pcm[i] = pcmA[i] + pcmB[i];

  const detected = multipitchTrack(pcm, ROUNDTRIP_SAMPLE_RATE, { fftSize: ROUNDTRIP_FFT_SIZE, maxVoices: 4 });

  const refA = song.parts[0].notes.map((n) => ({ onset: ticksToSeconds(n.start, song.bpm), midi: n.midi }));
  const refB = song.parts[0].notes.map((n) => ({ onset: ticksToSeconds(n.start, song.bpm), midi: n.midi + SECOND_VOICE_SEMITONES }));
  const ref = [...refA, ...refB];

  const result = scoreNotes(ref, detected, { onsetToleranceSec: 0.1 });
  console.log(`multipitch round-trip F1: ${result.f1.toFixed(4)} (precision ${result.precision.toFixed(4)}, recall ${result.recall.toFixed(4)}, matched ${result.matched}/${result.ref} ref, ${result.est} est)`);

  // Measured on this exact render at commit time: f1 = 0.9189 (precision
  // 0.85, recall 1.0, 34/34 ref notes matched, 40 estimated). Floor set
  // ~0.07 below that measured value, not invented.
  assert.ok(result.f1 >= 0.85, `f1 ${result.f1} below measured floor 0.85`);
});
