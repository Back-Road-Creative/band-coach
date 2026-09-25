// Songs' drum mic path (P4-12): createDrumCapture() is src/app.js's
// listenDrums() with the DOM/AudioContext stripped out -- fed hop by hop,
// the SAME onset+classify maths measured in tests/unit/drum-classify.test.mjs
// against synthesized kick/hi-hat buffers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrumCapture } from '../../src/ui/songs/drum-capture.js';
import { makeRng, whiteNoise } from './audio-analysis-fixtures.mjs';

const SR = 44100;
const HOP = 512;

// Same kick synth as tests/unit/drum-classify.test.mjs: a sine sweeping
// 120 -> 50 Hz over ~40 ms, amplitude decaying ~150 ms.
function kick() {
  const len = Math.round(0.3 * SR);
  const out = new Float32Array(len);
  const tau = 0.15 / Math.log(100);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 50 + 70 * Math.exp(-t / 0.01);
    phase += (2 * Math.PI * f) / SR;
    out[i] = Math.exp(-t / tau) * Math.sin(phase);
  }
  let peak = 0; for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < out.length; i++) out[i] /= peak;
  return out;
}

// Feeds `pcm` into `capture` in HOP-sized hops, oldest first, nowSec at each
// hop's end -- exactly the shape src/ui/songs.js's mic loop pushes. Returns
// every hit heard across the whole buffer.
function feed(capture, pcm) {
  const hits = [];
  for (let start = 0; start + HOP <= pcm.length; start += HOP) {
    const nowSec = (start + HOP) / SR;
    hits.push(...capture.push(pcm.subarray(start, start + HOP), nowSec));
  }
  return hits;
}

test('a kick burst pushed in hops is heard once, as the kick, near its attack', () => {
  const capture = createDrumCapture({ sampleRate: SR });
  const preroll = 256;
  const k = kick();
  const pcm = new Float32Array(preroll + k.length);
  pcm.set(k, preroll);
  const hits = feed(capture, pcm);
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].piece, 'kick');
  assert.ok(hits[0].confidence >= 0.5, hits[0].confidence);
  const attackSec = preroll / SR;
  assert.ok(Math.abs(hits[0].atSec - attackSec) < 0.05, `atSec ${hits[0].atSec} not near attack ${attackSec}`);
});

// Same "at most its one start onset" contract as
// tests/unit/drum-classify.test.mjs's own steady-noise test -- the onset
// detector has no history yet at the very first frame, so it can call that
// alone an onset; the adaptive threshold (unchanged here) is what rejects
// every frame after it.
test('steady noise gives at most its one start onset, not a stream of hits', () => {
  const capture = createDrumCapture({ sampleRate: SR });
  const rng = makeRng(5);
  const pcm = whiteNoise(3, SR, rng);
  for (let i = 0; i < pcm.length; i++) pcm[i] *= 0.05;
  const hits = feed(capture, pcm);
  assert.ok(hits.length <= 1, JSON.stringify(hits));
});

test('createDrumCapture requires a sampleRate', () => {
  assert.throws(() => createDrumCapture({}));
});
