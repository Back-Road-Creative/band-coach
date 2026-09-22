// Turning a decoded audio file's PCM into transcribe()-ready frames/onsets
// (src/audio/file-frames.js) -- the file-import counterpart to
// src/ui/editor/record.js's live-mic sampleFrame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { framesFromPCM } from '../../src/audio/file-frames.js';
import { transcribe } from '../../src/song/transcribe.js';

const SR = 44100;

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Appends `ms` of a clean sine tone at `midi`, ramped in/out a few ms so the
// splice between notes reads as a real attack (a hard edit would smear a
// spurious click-onset across every join, not just the re-attack we want).
function appendTone(samples, midi, ms, sr = SR, amp = 0.5) {
  const n = Math.round((ms / 1000) * sr);
  const freq = midiToHz(midi);
  const rampSamples = Math.min(200, Math.floor(n / 4));
  for (let i = 0; i < n; i++) {
    let env = 1;
    if (i < rampSamples) env = i / rampSamples;
    else if (i > n - rampSamples) env = (n - i) / rampSamples;
    samples.push(amp * env * Math.sin((2 * Math.PI * freq * i) / sr));
  }
}

function appendSilence(samples, ms, sr = SR) {
  const n = Math.round((ms / 1000) * sr);
  for (let i = 0; i < n; i++) samples.push(0);
}

// C4, then E4, then a re-attacked E4 (same pitch, new onset) -- a gap of
// true silence separates each note so the onset detector sees a genuine
// energy transient at every attack, including the repeated E4.
function buildSequence() {
  const samples = [];
  const starts = [];
  let tMs = 0;
  const gapMs = 60;
  const noteMs = 350;
  [60, 64, 64].forEach((midi, i) => {
    if (i > 0) {
      appendSilence(samples, gapMs);
      tMs += gapMs;
    }
    starts.push(tMs / 1000);
    appendTone(samples, midi, noteMs);
    tMs += noteMs;
  });
  return { pcm: new Float32Array(samples), starts, midis: [60, 64, 64] };
}

test('framesFromPCM tracks midi pitch through a C4-E4-E4 sequence', () => {
  const { pcm } = buildSequence();
  const { frames } = framesFromPCM(pcm, SR, { hopMs: 50, windowSize: 4096 });
  assert.ok(frames.length > 0, 'a real tone sequence must produce frames');
  frames.forEach((f) => {
    assert.equal(typeof f.t, 'number');
    assert.equal(typeof f.midi, 'number');
    assert.ok(f.confidence > 0 && f.confidence <= 1);
  });
  // Every frame's midi should land near 60 or 64 (the only two pitches in
  // the clip) -- nothing wildly off, e.g. an octave error or noise.
  frames.forEach((f) => {
    const nearC4 = Math.abs(f.midi - 60) < 0.5;
    const nearE4 = Math.abs(f.midi - 64) < 0.5;
    assert.ok(nearC4 || nearE4, `frame midi ${f.midi} at t=${f.t} is not near 60 or 64`);
  });
  const sawC4 = frames.some((f) => Math.abs(f.midi - 60) < 0.5);
  const sawE4 = frames.some((f) => Math.abs(f.midi - 64) < 0.5);
  assert.ok(sawC4, 'the C4 segment must be detected');
  assert.ok(sawE4, 'the E4 segments must be detected');
});

test('framesFromPCM reports an onset near each of the three attacks, including the re-attacked E4', () => {
  const { pcm, starts } = buildSequence();
  const { onsets } = framesFromPCM(pcm, SR, { hopMs: 50, windowSize: 4096 });
  assert.equal(starts.length, 3);
  starts.forEach((s) => {
    const hit = onsets.some((o) => Math.abs(o - s) < 0.12);
    assert.ok(hit, `expected an onset near t=${s}, got [${onsets.join(', ')}]`);
  });
});

test('framesFromPCM on pure silence produces no frames', () => {
  const pcm = new Float32Array(SR); // 1s of silence
  const { frames, onsets } = framesFromPCM(pcm, SR);
  assert.deepEqual(frames, []);
  assert.deepEqual(onsets, []);
});

test('framesFromPCM handles a clip shorter than one analysis window', () => {
  const samples = [];
  appendTone(samples, 69, 20); // 20ms of A4 at 44.1kHz is well under a 4096-sample window
  const pcm = new Float32Array(samples);
  const { frames, onsets } = framesFromPCM(pcm, SR, { windowSize: 4096 });
  assert.ok(Array.isArray(frames));
  assert.ok(Array.isArray(onsets));
  // Must not throw and must not loop forever -- a single attempt over the
  // zero-padded tail is enough; whether it clears the rms gate is incidental.
});

test('framesFromPCM works at a non-44.1kHz sample rate (48kHz)', () => {
  const sr = 48000;
  const samples = [];
  const freq = midiToHz(69);
  const n = Math.round(0.3 * sr);
  for (let i = 0; i < n; i++) samples.push(0.5 * Math.sin((2 * Math.PI * freq * i) / sr));
  const pcm = new Float32Array(samples);
  const { frames } = framesFromPCM(pcm, sr, { hopMs: 50, windowSize: 4096 });
  assert.ok(frames.length > 0);
  frames.forEach((f) => assert.ok(Math.abs(f.midi - 69) < 0.5));
});

test('end-to-end: transcribe(frames, { onsets }) from a file yields C4, E4, E4 in order', () => {
  const { pcm } = buildSequence();
  const { frames, onsets } = framesFromPCM(pcm, SR, { hopMs: 50, windowSize: 4096 });
  const { song, report } = transcribe(frames, { onsets });
  assert.ok(report.notesCaptured > 0);
  const notes = song.parts[0].notes;
  assert.ok(notes.length >= 3, `expected at least 3 notes, got ${notes.length}`);
  const midis = notes.map((n) => Math.round(n.midi));
  assert.deepEqual(midis.slice(0, 3), [60, 64, 64]);
});
