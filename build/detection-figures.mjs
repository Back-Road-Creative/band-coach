// Computes the note-detection figures that docs/capabilities.md ("Measured detection figures") and
// the app (Settings > How this works) both show, and writes them to src/core/detection-figures.json
// so neither can be hand-typed. tests/unit/detection-figures.test.mjs fails if the committed JSON
// drifts from a fresh run, or if the doc tables differ from the JSON.
//
// Regenerate: node build/detection-figures.mjs   (no npm script: the build has no generator pattern)
//
// Sources, all synthetic (no real microphone, room or instrument):
//  - evaluateAll() from src/song/eval/roundtrip.js: per-family mean F1 and per-song (keys profile) scores.
//  - the two-voice "Hot Cross Buns" render through multipitchTrack, the same render and scorer
//    tests/unit/multipitch.test.mjs uses (that test file holds the render inline, so it is repeated here).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { multipitchTrack, midiToFreq } from '../src/audio/analysis/multipitch.js';
import { starterSongs } from '../src/song/starter/index.js';
import { transpose, ticksToSeconds } from '../src/song/model.js';
import { scoreNotes } from '../src/song/eval/note-f1.js';
import { evaluateAll } from '../src/song/eval/roundtrip.js';

const SAMPLE_RATE = 44100;
const FFT_SIZE = 4096;
const SECOND_VOICE_SEMITONES = -8;
const PARTIALS = [1, 0.5, 0.25, 0.125, 0.06, 0.03];
const r = (x, dp) => Number(x.toFixed(dp));

function renderVoicePcm(song, totalSamples, semitones) {
  const pcm = new Float32Array(totalSamples);
  for (const note of transpose(song, semitones).parts[0].notes) {
    const startSample = Math.round(ticksToSeconds(note.start, song.bpm) * SAMPLE_RATE);
    const nSamples = Math.round(ticksToSeconds(note.dur, song.bpm) * 0.75 * SAMPLE_RATE);
    const freq = midiToFreq(note.midi);
    const fade = Math.min(200, Math.floor(nSamples / 4));
    for (let i = 0; i < nSamples && startSample + i < totalSamples; i++) {
      let s = 0;
      for (let h = 1; h <= PARTIALS.length; h++) s += PARTIALS[h - 1] * Math.sin((2 * Math.PI * freq * h * i) / SAMPLE_RATE);
      pcm[startSample + i] += s * (i < fade ? i / fade : i > nSamples - fade ? (nSamples - i) / fade : 1);
    }
  }
  return pcm;
}

function polyphonic() {
  const song = starterSongs.find((s) => s.id === 'hot-cross-buns');
  const last = song.parts[0].notes.at(-1);
  const total = Math.ceil(ticksToSeconds(last.start + last.dur, song.bpm) * SAMPLE_RATE + 0.5 * SAMPLE_RATE);
  const a = renderVoicePcm(song, total, 0), b = renderVoicePcm(song, total, SECOND_VOICE_SEMITONES);
  const pcm = new Float32Array(total);
  for (let i = 0; i < total; i++) pcm[i] = a[i] + b[i];
  const detected = multipitchTrack(pcm, SAMPLE_RATE, { fftSize: FFT_SIZE, maxVoices: 4 });
  const ref = song.parts[0].notes.flatMap((n) => [0, SECOND_VOICE_SEMITONES].map((d) => ({ onset: ticksToSeconds(n.start, song.bpm), midi: n.midi + d })));
  const s = scoreNotes(ref, detected, { onsetToleranceSec: 0.1 });
  return { precision: r(s.precision, 4), recall: r(s.recall, 4), f1: r(s.f1, 4), matched: s.matched, ref: s.ref, est: s.est };
}

export function computeFigures() {
  const ev = evaluateAll();
  return {
    multipitch: polyphonic(),
    families: ev.perFamily.map((f) => ({ family: f.family, meanF1: r(f.meanF1, 3) })),
    songs: ev.perSong.map((s) => ({ title: s.title, f1: r(s.f1, 3), matched: s.matched, ref: s.ref, est: s.est })),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(new URL('../src/core/detection-figures.json', import.meta.url), JSON.stringify(computeFigures(), null, 2) + '\n');
}
