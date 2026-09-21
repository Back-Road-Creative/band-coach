// THE BUG: on the tuner screen the "Microphone level" meter never moves,
// even while the tuner is actually hearing the player (src/app.js `stepTuner`
// runs off the same audio). The meter is the one indicator a beginner uses to
// answer "is my mic working?", and on the tuner screen it permanently says
// no. Root cause: meterUpdate() is called only from the pitch-worklet
// onmessage handler (src/app.js ~line 159) and the main-thread `listen()`
// fallback (~line 1026), both gated on `MODS[mod].input === 'pluck' ||
// 'sustain'` -- `tuner` lives in TOOLS, not MODS, so that guard is never
// true for it. The tuner's own audio comes from a THIRD poller
// (src/app.js's `setInterval(... toolPitch ...)`, ~line 1586) that never
// called meterUpdate() at all.
//
// This test drives the real mic-listening path the same way
// tests/characterization/tuner-holds.test.mjs does (steady tone into the
// fake microphone, real yin() detection, real stepTuner state machine), and
// asserts on the one DOM property meterUpdate() writes: the fill bar's
// width. It also asserts on `aria-valuenow`, which meterUpdate() never set
// at all (for ANY screen) before this change -- a screen reader was left
// reading a progressbar that claims a range but never reports where it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage, effectiveWaitMs } from '../helpers/browser.mjs';
import { waitForAudioHeard } from '../helpers/audio-heard.mjs';

const htmlPath = HTML_PATH;

function writeSteadyWav(path, { freq = 440, sampleRate = 48000, seconds = 8 } = {}) {
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
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const v = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.85;
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2);
  }
  writeFileSync(path, buf);
  return path;
}

async function openTuner(page) {
  await page.evaluate("document.querySelector('#picker button[data-mod=\"tuner\"]').click()");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true", effectiveWaitMs(5000));
  await waitForAudioHeard(page);
}

test('the microphone level meter moves on the tuner screen, and reports aria-valuenow', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-tuner-meter-'));
  const wavPath = writeSteadyWav(join(dir, 'steady-a4.wav'));
  const page = await launchPage(htmlPath, { fakeAudioFile: wavPath });
  t.after(() => page.close());

  await openTuner(page);

  const deadline = Date.now() + effectiveWaitMs(8000);
  let width = '', valuenow = null;
  while (Date.now() < deadline) {
    width = await page.evaluate("document.getElementById('micLevelFill').style.width");
    valuenow = await page.evaluate(
      "document.querySelector('.mic-meter[role=\"progressbar\"]').getAttribute('aria-valuenow')"
    );
    if (width && parseFloat(width) > 0 && valuenow !== null) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  assert.ok(
    width && parseFloat(width) > 0,
    'the microphone level meter never moved on the tuner screen with a steady 440Hz tone playing ' +
      'into the fake microphone, even though the tuner itself was hearing it'
  );
  assert.ok(
    valuenow !== null,
    'the meter\'s role="progressbar" element never got an aria-valuenow, so a screen reader would ' +
      'read a progressbar that never reports where it is'
  );
  assert.ok(
    Number(valuenow) > 0,
    `expected aria-valuenow to reflect a real, non-zero level while a tone is playing, got ${valuenow}`
  );
});
