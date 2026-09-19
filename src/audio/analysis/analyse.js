// Wiring: analyse(pcm, sampleRate, { onProgress, beatsPerBar }) is the single entry point
// for this directory. pcm is mono decoded audio as a plain Float32Array (decoding happens
// elsewhere — this module never touches AudioContext/File/fetch). Runs beat/tempo
// detection, beat-synchronous chroma, key and chord estimation, yielding control between
// stages so a caller running this inside a Worker can report progress without one long
// synchronous block. Returns { bpm, beats, downbeats, key, chords, tuningCents, confidence }.

import { FFTProcessor } from './fft.js';
import { computeOnsetEnvelope } from './onset-envelope.js';
import { estimateTempo, trackBeats, downbeats as estimateDownbeats } from './tempo.js';
import { chromaFromSpectrum, estimateTuningCents, beatSynchronousChroma } from './chroma.js';
import { estimateKey } from './key.js';
import { estimateChords } from './chords.js';

const ONSET_FRAME_SIZE = 512;
const ONSET_HOP_SIZE = 128;
const CHROMA_FRAME_SIZE = 4096;
const CHROMA_HOP_SIZE = 2048;

const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0));

const emptyResult = (confidence = 0) => ({
  bpm: 0, beats: [], downbeats: [], key: { tonic: 0, mode: 'major', confidence: 0 },
  chords: [], tuningCents: 0, confidence,
});

export async function analyse(pcm, sampleRate, opts = {}) {
  const onProgress = opts.onProgress ?? (() => {});
  const beatsPerBar = opts.beatsPerBar ?? 4;
  onProgress(0);
  if (!pcm || pcm.length < ONSET_FRAME_SIZE) { onProgress(1); return emptyResult(0); }
  // --- Stage 1: onset envelope + tempo + beats ---------------------------------------
  const { envelope, hopSeconds } = computeOnsetEnvelope(pcm, sampleRate, {
    frameSize: ONSET_FRAME_SIZE, hopSize: ONSET_HOP_SIZE,
  });
  onProgress(0.2);
  await yieldToEventLoop();
  let envelopeMax = 0;
  for (let i = 0; i < envelope.length; i++) envelopeMax = Math.max(envelopeMax, envelope[i]);
  const hasOnsets = envelopeMax > 1e-9;
  const tempo = estimateTempo(envelope, hopSeconds);
  const beats = hasOnsets && tempo.bpm > 0 ? trackBeats(envelope, tempo.bpm, hopSeconds) : [];
  onProgress(0.4);
  await yieldToEventLoop();
  if (beats.length === 0) { onProgress(1); return emptyResult(tempo.confidence); }
  // --- Stage 2: per-frame chroma (preallocated matrix, no per-frame allocation) -------
  const numChromaFrames =
    pcm.length >= CHROMA_FRAME_SIZE ? Math.floor((pcm.length - CHROMA_FRAME_SIZE) / CHROMA_HOP_SIZE) + 1 : 0;
  const bins = CHROMA_FRAME_SIZE / 2 + 1;
  const magStore = new Float32Array(numChromaFrames * bins);
  const frameTimes = new Float32Array(numChromaFrames);
  const frame = new Float32Array(CHROMA_FRAME_SIZE);
  const proc = new FFTProcessor(CHROMA_FRAME_SIZE);
  const CHUNK = 64;
  for (let f = 0; f < numChromaFrames; f++) {
    const start = f * CHROMA_HOP_SIZE;
    frame.set(pcm.subarray(start, start + CHROMA_FRAME_SIZE));
    magStore.set(proc.process(frame), f * bins);
    frameTimes[f] = start / sampleRate;
    if (f % CHUNK === CHUNK - 1) {
      onProgress(0.4 + 0.2 * ((f + 1) / Math.max(1, numChromaFrames)));
      await yieldToEventLoop();
    }
  }
  onProgress(0.6);
  await yieldToEventLoop();
  // Tuning estimate from a sample of frames against default A440, then re-derive chroma per
  // frame using the refined reference pitch.
  const sampleFrames = [];
  for (let f = 0; f < numChromaFrames; f += 4) sampleFrames.push(magStore.subarray(f * bins, (f + 1) * bins));
  const tuningCents = numChromaFrames > 0 ? estimateTuningCents(sampleFrames, sampleRate, CHROMA_FRAME_SIZE) : 0;
  const a4 = 440 * Math.pow(2, tuningCents / 1200);
  const chromaFrames = [];
  for (let f = 0; f < numChromaFrames; f++) {
    chromaFrames.push(chromaFromSpectrum(magStore.subarray(f * bins, (f + 1) * bins), sampleRate, CHROMA_FRAME_SIZE, { a4 }));
  }
  onProgress(0.7);
  await yieldToEventLoop();
  const beatChroma = beatSynchronousChroma(chromaFrames, Array.from(frameTimes), beats);
  // --- Stage 3: key -------------------------------------------------------------------
  const aggregate = new Float32Array(12);
  for (const c of beatChroma) for (let k = 0; k < 12; k++) aggregate[k] += c[k];
  const key = estimateKey(aggregate);
  onProgress(0.8);
  await yieldToEventLoop();
  // --- Stage 4: downbeats + chords -----------------------------------------------------
  const downbeatResult = estimateDownbeats(beats, beatChroma, { beatsPerBar });
  const chords = estimateChords(beatChroma);
  onProgress(0.95);
  await yieldToEventLoop();
  onProgress(1);
  return {
    bpm: tempo.bpm, beats, downbeats: downbeatResult.downbeats, key, chords, tuningCents,
    confidence: Math.max(0, Math.min(1, (tempo.confidence + key.confidence) / 2)),
  };
}
