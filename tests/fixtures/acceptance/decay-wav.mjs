// Pure-Node WAV writer for the tuner-decay acceptance test: 16-bit PCM mono, a
// sharp attack decaying exponentially to true silence, then silence (Chromium
// loops a fake-audio file, so the silence outlasts any measured window). The
// same writer is inline in tests/release/gate.test.mjs; keep the signals equal.
import { writeFileSync } from 'node:fs';

export function writeDecayWav(path, { freq = 440, sampleRate = 48000, toneSeconds = 0.6, silenceSeconds = 6.4 } = {}) {
  const seconds = toneSeconds + silenceSeconds;
  const numSamples = Math.round(seconds * sampleRate);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  const toneSamples = Math.round(toneSeconds * sampleRate);
  for (let i = 0; i < numSamples; i++) {
    let sample = 0;
    if (i < toneSamples) {
      const t = i / sampleRate;
      const envelope = Math.exp((-9 * t) / toneSeconds); // ~-78 dB by toneSeconds: inaudible, not just quiet
      sample = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.85 * envelope;
    }
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sample * 32767))), 44 + i * 2);
  }
  writeFileSync(path, buf);
  return path;
}
