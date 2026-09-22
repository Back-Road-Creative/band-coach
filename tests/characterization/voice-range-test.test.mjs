// Drives the REAL "Find my range" flow on the Voice screen through actual
// button clicks and the real mic-listening path (yin pitch detector, the
// same `heard` object drawVoice already reads), the way
// tests/characterization/tuner-holds.test.mjs drives the tuner. The fake
// microphone plays a WAV that alternates between a low tone and a high
// tone every few seconds -- close to how a learner actually uses the
// button pair (sing low, click Next, sing high, click Done), without
// requiring a real singer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage, effectiveWaitMs } from '../helpers/browser.mjs';
import { waitForSteadyMidi } from '../helpers/steady-midi.mjs';

const htmlPath = HTML_PATH;

const LOW_FREQ = 130.81; // C3, midi 48
const HIGH_FREQ = 523.25; // C5, midi 72
const SEGMENT_SEC = 2.5;

// Alternates LOW_FREQ / HIGH_FREQ every SEGMENT_SEC, looping (Chromium's
// fake-audio-file always loops) so a test that starts mid-file still sees
// both halves within one loop.
function writeAlternatingWav(path) {
  const sampleRate = 48000, totalSec = 10;
  const numSamples = Math.round(totalSec * sampleRate);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii'); buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const phase = Math.floor(t / SEGMENT_SEC) % 2;
    const freq = phase === 0 ? LOW_FREQ : HIGH_FREQ;
    const v = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.85;
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), 44 + i * 2);
  }
  writeFileSync(path, buf);
  return path;
}

// Voice is a MOD (input: 'sustain'), not a TOOL, so `window.__coach.audioHeardTicks()`
// never advances for it (src/app.js's setInterval(listen, 50) tick counter that
// feeds it is gated to `TOOLS[mod]` only) -- the first waitForSteadyMidi() call
// in each test is this flow's own readiness gate instead.
async function openVoice(page) {
  await page.evaluate("document.querySelector('#picker button[data-mod=\"voice\"]').click()");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true", effectiveWaitMs(5000));
}

test('Find my range: singing low then high through the real mic saves a range and picks it as the voice', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-voice-range-'));
  const wavPath = writeAlternatingWav(join(dir, 'low-high.wav'));
  const page = await launchPage(htmlPath, { fakeAudioFile: wavPath });
  t.after(() => page.close());

  await openVoice(page);

  // Real entry point: click the button, not the debug hook.
  await page.evaluate("document.getElementById('optRangeStart') && document.getElementById('optRangeStart').click()");
  assert.equal(
    await page.evaluate("document.getElementById('optRangeStart') === null"),
    true,
    '"Find my range" should disappear once the flow has started (replaced by the Next/Cancel pair)'
  );

  await waitForSteadyMidi(page, 48, 700);
  await page.evaluate("document.getElementById('optRangeNext').click()");
  assert.match(
    await page.evaluate("document.getElementById('coach').textContent"),
    /highest/,
    'the on-screen coach line should tell the learner to sing the highest note next'
  );

  await waitForSteadyMidi(page, 72, 700);
  await page.evaluate("document.getElementById('optRangeDone').click()");

  await page.waitFor("document.getElementById('optRangeDone') === null", effectiveWaitMs(3000));

  const coachText = await page.evaluate("document.getElementById('coach').textContent");
  assert.match(coachText, /Sounds closest to|range/i, `expected a plain-language result, got: ${coachText}`);

  // The voice picker gained a real, learner-visible fourth choice and
  // switched to it -- not just an internal pref flip.
  const optionTexts = await page.evaluate(
    "Array.from(document.getElementById('optVoice').options).map(o => o.textContent)"
  );
  assert.ok(optionTexts.includes('My range (found by test)'), `expected a "My range (found by test)" option, got: ${JSON.stringify(optionTexts)}`);
  assert.equal(await page.evaluate("document.getElementById('optVoice').value"), 'mine');

  // Corroborate with the saved preference itself (guarded: a missing/renamed
  // hook must not be able to get this test past the DOM assertions above).
  const range = await page.evaluate(
    "typeof window.__coach.db === 'function' ? window.__coach.db().prefs.voiceRange : null"
  );
  if (range) {
    assert.ok(range.low < range.high, `expected a real low < high range, got ${JSON.stringify(range)}`);
    assert.ok(range.low >= 40 && range.high <= 80, `expected a range roughly around the C3-C5 tones sung, got ${JSON.stringify(range)}`);
  }
});

test('Find my range: cancelling mid-flow leaves the previous voice choice untouched', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-voice-range-cancel-'));
  const wavPath = writeAlternatingWav(join(dir, 'low-high.wav'));
  const page = await launchPage(htmlPath, { fakeAudioFile: wavPath });
  t.after(() => page.close());

  await openVoice(page);
  const before = await page.evaluate("document.getElementById('optVoice').value");

  await page.evaluate("document.getElementById('optRangeStart').click()");
  await page.waitFor("document.getElementById('optRangeCancel') !== null", effectiveWaitMs(3000));
  await page.evaluate("document.getElementById('optRangeCancel').click()");

  await page.waitFor("document.getElementById('optRangeStart') !== null", effectiveWaitMs(3000));
  assert.equal(await page.evaluate("document.getElementById('optVoice').value"), before, 'cancelling should not change the saved voice choice');
  const range = await page.evaluate(
    "typeof window.__coach.db === 'function' ? window.__coach.db().prefs.voiceRange : 'no-hook'"
  );
  if (range !== 'no-hook') assert.equal(range, null, 'cancelling should not save a range');
});
