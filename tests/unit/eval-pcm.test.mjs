import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluateClip, evaluateManifest, readWav, encodeWavPCM16 } from '../../src/song/eval/pcm.js';

// A4 = MIDI 69 = 440 Hz, same reference the rest of the app tunes to
// (src/audio/range.js).
function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Synthesizes a short mono PCM clip: three notes each separated by a real
// silent gap, plus trailing silence, at a real-world sample rate (44.1kHz,
// same as tests/unit/file-frames.test.mjs's own fixture builder). Each note
// is ramped in/out (a few ms) so the splice reads as a genuine attack rather
// than a click that could itself register as a spurious onset.
function synthesizeClip() {
  const sampleRate = 44100;
  const noteMs = 350;
  const gapMs = 400;
  const midis = [60, 64, 67]; // C4, E4, G4
  const samples = [];
  const notes = [];
  let tMs = 0;
  midis.forEach((midi, i) => {
    if (i > 0) {
      appendSilence(samples, gapMs, sampleRate);
      tMs += gapMs;
    }
    notes.push({ midi, startSec: tMs / 1000, durSec: noteMs / 1000 });
    appendTone(samples, midi, noteMs, sampleRate);
    tMs += noteMs;
  });
  appendSilence(samples, gapMs, sampleRate); // trailing silence
  return { pcm: new Float32Array(samples), sampleRate, notes };
}

function appendTone(samples, midi, ms, sampleRate, amp = 0.5) {
  const n = Math.round((ms / 1000) * sampleRate);
  const freq = midiToHz(midi);
  const rampSamples = Math.min(200, Math.floor(n / 4));
  for (let i = 0; i < n; i++) {
    let env = 1;
    if (i < rampSamples) env = i / rampSamples;
    else if (i > n - rampSamples) env = (n - i) / rampSamples;
    samples.push(amp * env * Math.sin((2 * Math.PI * freq * i) / sampleRate));
  }
}

function appendSilence(samples, ms, sampleRate) {
  const n = Math.round((ms / 1000) * sampleRate);
  for (let i = 0; i < n; i++) samples.push(0);
}

test('evaluateClip transcribes a labelled clip and does not fill the silent gap', () => {
  const { pcm, sampleRate, notes } = synthesizeClip();
  const result = evaluateClip(pcm, sampleRate, notes, { fmin: 100, fmax: 500 });

  assert.ok(result.f1 >= 0.66, `expected f1 >= 0.66, got ${result.f1}`);
  // Every label has a matching detection: no note was hallucinated inside
  // the 400ms silent gaps between notes or in the trailing silence -- a
  // false positive there would mean a gap got filled.
  assert.equal(result.falsePositives, 0, `expected no false positives (silent gap filled), got ${result.falsePositives}`);
});

test('evaluateManifest on an empty fixtures directory returns skipped: no corpus', () => {
  const emptyDir = mkdtempSync(path.join(tmpdir(), 'band-coach-eval-empty-'));
  try {
    const result = evaluateManifest(emptyDir);
    assert.deepEqual(result, { clips: [], skipped: 'no corpus' });
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test('readWav round-trips a PCM-16 mono buffer encoded in this test', () => {
  const sampleRate = 8000;
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25]);
  const wavBuffer = encodeWavPCM16(samples, sampleRate);
  const { pcm, sampleRate: gotRate } = readWav(wavBuffer);

  assert.equal(gotRate, sampleRate);
  assert.equal(pcm.length, samples.length);
  for (let i = 0; i < samples.length; i++) {
    // PCM16 quantization: within one quantization step of the original.
    assert.ok(Math.abs(pcm[i] - samples[i]) < 1 / 32767 + 1e-6, `sample ${i}: expected ~${samples[i]}, got ${pcm[i]}`);
  }
});
