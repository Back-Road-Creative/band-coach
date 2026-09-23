// transcribe(frames, { polyphonic }) (src/song/transcribe.js): wiring B1
// (tempo map shape), B2 (multipitch detection), B3 (voice tracking/melody
// pick) and B4 (tempo-map quantize) behind opts.polyphonic, so a file with
// more than one note sounding at once comes out as more than one part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcribe } from '../../src/song/transcribe.js';

// A clean two-voice clip: a held bass note under a two-note melody line,
// synthesized directly as PCM (no WAV/file decoding involved — that is the
// characterization test's job). 22050Hz, as the unit spec suggests.
function twoVoicePcm() {
  const sr = 22050;
  const noteSeconds = 0.6;
  const noteSamples = Math.round(noteSeconds * sr);
  const total = noteSamples * 2;
  const pcm = new Float32Array(total);
  const freqFor = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  // Deliberately not octave/fifth multiples of each other -- a bass note and
  // a melody note whose harmonic series coincide (e.g. C3 under C5) mask one
  // another in the harmonic-sum salience detectPitches uses, which is a
  // known limitation of that algorithm (src/audio/analysis/multipitch.js),
  // not something this wiring unit can fix.
  const bassFreq = freqFor(43); // G2, held the whole clip
  const melFreq1 = freqFor(72); // C5, first half
  const melFreq2 = freqFor(76); // E5, second half
  for (let i = 0; i < total; i++) {
    const melFreq = i < noteSamples ? melFreq1 : melFreq2;
    pcm[i] = 0.35 * Math.sin((2 * Math.PI * bassFreq * i) / sr) + 0.35 * Math.sin((2 * Math.PI * melFreq * i) / sr);
  }
  return { pcm, sampleRate: sr };
}

test('transcribe with opts.polyphonic hears a held bass note and a two-note melody as two parts', () => {
  const { pcm, sampleRate } = twoVoicePcm();
  const result = transcribe([], {
    title: 'Two voices',
    polyphonic: { pcm, sampleRate, fftSize: 2048, hopSize: 512, minFrames: 2 },
  });

  assert.equal(result.song.parts.length, 2, `expected 2 parts, got ${JSON.stringify(result.song.parts.map((p) => p.role))}`);

  const roles = result.song.parts.map((p) => p.role);
  assert.ok(roles.includes('melody'), 'a melody part was found');
  assert.ok(roles.includes('bass'), 'a bass part was found');

  const bassPart = result.song.parts.find((p) => p.role === 'bass');
  const melodyPart = result.song.parts.find((p) => p.role === 'melody');
  assert.ok(bassPart.notes.length >= 1, 'the bass part has at least one note');
  bassPart.notes.forEach((n) => assert.equal(n.midi, 43, 'the bass note is G2'));

  const melodyMidis = melodyPart.notes.map((n) => n.midi);
  assert.ok(melodyMidis.includes(72), `melody should include C5, got ${JSON.stringify(melodyMidis)}`);
  assert.ok(melodyMidis.includes(76), `melody should include E5, got ${JSON.stringify(melodyMidis)}`);

  assert.ok(
    result.report.needsCheck.some((line) => line.includes('I heard 2 voices')),
    `needsCheck should say "I heard 2 voices", got ${JSON.stringify(result.report.needsCheck)}`,
  );
});

test('transcribe without opts.polyphonic is unaffected by the polyphonic wiring', () => {
  const frames = [];
  for (let i = 0; i < 40; i++) frames.push({ t: i * 0.01, midi: 60, confidence: 1 });
  const result = transcribe(frames, { title: 'Mono' });
  assert.equal(result.song.parts.length, 1);
  assert.equal(result.song.parts[0].id, 'melody');
  assert.ok(!result.report.needsCheck.some((line) => line.includes('I heard')));
});
