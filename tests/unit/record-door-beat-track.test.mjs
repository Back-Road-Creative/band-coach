// transcribeAudioFile (src/ui/songs/record-door.js) feeds the clip's beat track to transcribe():
// a swung tune comes back with a tempoMap, song.swing and a plain feel line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcribeAudioFile } from '../../src/ui/songs/record-door.js';

const SR = 22050;
function swungTune(seconds = 16, frac = 2 / 3) {
  const pcm = new Float32Array(SR * seconds);
  const burst = (t, hz) => {
    const s0 = Math.round(t * SR); const n = Math.round(0.11 * SR);
    for (let i = 0; i < n && s0 + i < pcm.length; i++) pcm[s0 + i] += 0.6 * Math.exp(-i / (0.05 * SR)) * Math.sin((2 * Math.PI * hz * i) / SR);
  };
  for (let b = 0; b * 0.5 < seconds - 0.6; b++) { burst(b * 0.5, 440); burst(b * 0.5 + 0.5 * frac, 554.37); }
  return pcm;
}
const apiFor = (pcm) => ({
  audio: () => ({ decodeAudioData: async () => ({ numberOfChannels: 1, sampleRate: SR, duration: pcm.length / SR, getChannelData: () => pcm }) }),
});
const fileOf = () => ({ name: 'tune.wav', arrayBuffer: async () => new ArrayBuffer(8) });

test('a swung recording gets a tempoMap, a swing ratio and a swung line', async () => {
  const r = await transcribeAudioFile(fileOf(), apiFor(swungTune()));
  assert.ok(Array.isArray(r.song.tempoMap) && r.song.tempoMap.length >= 1, 'has a tempoMap');
  assert.ok(r.song.swing >= 1.4, 'swing ' + r.song.swing);
  assert.match(r.report.feelLine, /swung/i);
});

test('a straight recording says straight', async () => {
  const r = await transcribeAudioFile(fileOf(), apiFor(swungTune(16, 0.5)));
  assert.ok(r.song.swing < 1.4, 'swing ' + r.song.swing);
  assert.match(r.report.feelLine, /straight/i);
});
