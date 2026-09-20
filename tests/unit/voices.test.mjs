// Synthesized instrument-family reference tones (src/audio/voices.js), the
// single thing src/app.js `tone()` now delegates to. Render functions are
// pure JS sample generators, so pitch accuracy and loudness are asserted
// directly here with the app's own pitch detector (src/audio/yin.js) --
// no browser, no OfflineAudioContext needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recipeForFamily,
  voiceDurationSeconds,
  renderVoice,
  renderPluck,
  renderStruck,
  renderSustain,
  renderBrass,
} from '../../src/audio/voices.js';
import { yin } from '../../src/audio/yin.js';
import { frameSizeForInstrument } from '../../src/audio/range.js';

const SR = 44100;
const SR48 = 48000;
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const centsOff = (freq, expected) => 1200 * Math.log2(freq / expected);

// Pulls a detection frame from somewhere in the middle of a rendered buffer
// (not the very onset, not the fully decayed tail) -- the part of the sound
// a learner is actually holding a tuner up to.
function detect(buf, sampleRate, freq, frameSize) {
  const start = Math.min(Math.floor(sampleRate * 0.05), Math.max(0, buf.length - frameSize));
  const frame = buf.subarray(start, start + frameSize);
  return yin(frame, sampleRate, Math.max(20, freq / 4), freq * 4);
}

test('recipeForFamily maps every schema family to a recipe, with a safe fallback', () => {
  assert.equal(recipeForFamily('keys'), 'struck');
  assert.equal(recipeForFamily('fretted'), 'pluck');
  assert.equal(recipeForFamily('percussion'), 'pluck');
  assert.equal(recipeForFamily('bowed'), 'sustain');
  assert.equal(recipeForFamily('wind'), 'sustain');
  assert.equal(recipeForFamily('free-reed'), 'sustain');
  assert.equal(recipeForFamily('voice'), 'sustain');
  assert.equal(recipeForFamily('brass'), 'brass');
  assert.equal(recipeForFamily('nonsense'), 'sustain', 'unknown family falls back to sustain');
  assert.equal(recipeForFamily(undefined), 'sustain', 'missing family falls back to sustain');
});

test('voiceDurationSeconds never shrinks the requested duration, and never grows it past what a real caller asked for', () => {
  // F5 (deaf window) regression guard: src/ui/songs.js:302 and
  // src/ui/editor.js:450 pass a song's own note duration (as short as 0.05s
  // in the editor, 0.12s on a bpm-driven song phrase) straight into
  // src/app.js `tone()`, which sizes the mic's deaf window off the RENDERED
  // BUFFER's length. A family floor bigger than that requested duration
  // (pluck used to floor at 0.5s, struck at 0.9s) silently makes the deaf
  // window outlive the note the arrangement chose to be short, so on a
  // fretted play-along the app stops listening for up to ~3 eighth notes
  // after a short note plays. The floor must never exceed `seconds`.
  for (const [family, seconds] of [['fretted', 0.05], ['fretted', 0.12], ['keys', 0.05], ['keys', 0.12], ['bowed', 0.05], ['brass', 0.05]]) {
    const dur = voiceDurationSeconds(family, seconds);
    assert.ok(dur <= seconds + 1e-9, `${family} at ${seconds}s: voiceDurationSeconds returned ${dur}, which is longer than the note the caller asked for`);
  }
  assert.equal(voiceDurationSeconds('voice', 2), 2, 'a long request is never shortened');
  assert.equal(voiceDurationSeconds('wind', 0), voiceDurationSeconds('wind', 0), 'deterministic');
});

test('renderVoice buffer length (which drives the deaf window) never exceeds the requested duration, for every recipe', () => {
  // Direct regression test on the actual rendered buffer, not just the pure
  // duration helper: src/app.js `tone()` opens the deaf window for
  // `samples.length / sampleRate`, so THIS is the number that must not
  // exceed the caller's requested `dur`. Shortest real durations observed:
  // src/ui/editor.js:450 `Math.max(0.05, ...)`, src/ui/songs.js:302
  // `Math.max(0.12, ...)`.
  for (const family of ['fretted', 'keys', 'bowed', 'wind', 'free-reed', 'voice', 'brass', 'percussion']) {
    for (const requested of [0.05, 0.12]) {
      const buf = renderVoice(family, 220, SR, requested, 0.22);
      const seconds = buf.length / SR;
      assert.ok(
        seconds <= requested + 1e-6,
        `${family} at requested dur ${requested}s rendered ${seconds}s of audio -- the deaf window would outlive the note`
      );
    }
  }
});

test('renderVoice never throws on an unregistered family and still produces sound', () => {
  const buf = renderVoice('made-up-family', 220, SR, 0.5, 0.22);
  assert.ok(buf.length > 0);
  assert.ok(buf.some((s) => Math.abs(s) > 0.001), 'fallback voice is actually audible');
});

const PITCH_CASES = [
  { name: 'plucked mid note (A3, 220Hz)', family: 'fretted', midi: 57 },
  { name: 'keyboard mid note (A3, 220Hz)', family: 'keys', midi: 57 },
  { name: 'bowed mid note (A3, 220Hz)', family: 'bowed', midi: 57 },
  { name: 'wind mid note (A3, 220Hz)', family: 'wind', midi: 57 },
  { name: 'brass mid note (A3, 220Hz)', family: 'brass', midi: 57 },
  { name: 'voice mid note (A3, 220Hz)', family: 'voice', midi: 57 },
  { name: 'free-reed mid note (A3, 220Hz)', family: 'free-reed', midi: 57 },
];

for (const { name, family, midi } of PITCH_CASES) {
  test(`${name}: the synthesized fundamental is within a few cents of the requested pitch`, () => {
    const freq = midiToHz(midi);
    const dur = voiceDurationSeconds(family, 0.75);
    const buf = renderVoice(family, freq, SR, dur, 0.22);
    const frameSize = frameSizeForInstrument({ range: { low: midi } }, SR);
    const r = detect(buf, SR, freq, frameSize);
    assert.ok(r.freq > 0, `expected a pitch lock for ${family} at ${freq}Hz`);
    const cents = centsOff(r.freq, freq);
    assert.ok(Math.abs(cents) < 8, `expected within 8 cents of ${freq}Hz, got ${r.freq}Hz (${cents.toFixed(1)} cents)`);
  });
}

// A bass note needs the larger analysis frame src/audio/range.js derives
// (frameSizeForInstrument) -- yin's own lag search caps at (frameSize >> 1)
// - 1 samples, so a low fundamental is invisible to a too-small frame.
test('a bass note (E1, ~41.2Hz, plucked family) is within a few cents using the derived frame size', () => {
  const midi = 28; // E1
  const freq = midiToHz(midi);
  const dur = voiceDurationSeconds('fretted', 0.75);
  const buf = renderPluck(freq, SR48, dur, 0.22);
  const frameSize = frameSizeForInstrument({ range: { low: midi } }, SR48);
  assert.ok(frameSize >= 4096, 'a note this low should need the larger frame');
  const r = detect(buf, SR48, freq, frameSize);
  assert.ok(r.freq > 0, 'expected a pitch lock on the low bass note');
  const cents = centsOff(r.freq, freq);
  assert.ok(Math.abs(cents) < 8, `expected within 8 cents of ${freq}Hz, got ${r.freq}Hz (${cents.toFixed(1)} cents)`);
});

test('a sustained bass note (bowed family, D2 ~73.4Hz) is within a few cents using the derived frame size', () => {
  const midi = 38; // D2
  const freq = midiToHz(midi);
  const dur = voiceDurationSeconds('bowed', 0.75);
  const buf = renderSustain(freq, SR48, dur, 0.22, 0.5);
  const frameSize = frameSizeForInstrument({ range: { low: midi } }, SR48);
  const r = detect(buf, SR48, freq, frameSize);
  assert.ok(r.freq > 0, 'expected a pitch lock on the low sustained note');
  const cents = centsOff(r.freq, freq);
  assert.ok(Math.abs(cents) < 8, `expected within 8 cents of ${freq}Hz, got ${r.freq}Hz (${cents.toFixed(1)} cents)`);
});

test('loudness stays comparable to the old reference tone: peak amplitude tracks the vol argument', () => {
  for (const [family, render] of [
    ['fretted', (f, sr, d, v) => renderPluck(f, sr, d, v)],
    ['keys', (f, sr, d, v) => renderStruck(f, sr, d, v)],
    ['bowed', (f, sr, d, v) => renderSustain(f, sr, d, v, 0.5)],
    ['brass', (f, sr, d, v) => renderBrass(f, sr, d, v)],
  ]) {
    const vol = 0.22;
    const buf = render(midiToHz(57), SR, 0.75, vol);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
    assert.ok(peak > 0, `${family} should be audible`);
    assert.ok(peak <= vol * 1.05, `${family} peak ${peak} should not exceed the requested vol ${vol} by more than rounding slop`);
  }
});

test('renderVoice buffer length matches voiceDurationSeconds exactly, for every recipe', () => {
  for (const family of ['fretted', 'keys', 'bowed', 'wind', 'free-reed', 'voice', 'brass', 'percussion']) {
    const requested = 0.3;
    const expectedSeconds = voiceDurationSeconds(family, requested);
    const buf = renderVoice(family, 220, SR, requested, 0.22);
    const expectedSamples = Math.max(1, Math.round(expectedSeconds * SR));
    assert.equal(buf.length, expectedSamples, `${family} buffer length should match its own floored duration`);
  }
});
