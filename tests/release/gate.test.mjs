// The release gate: makes a broken download impossible. This drives the
// actual file a learner downloads, dist/release/band-coach.html, straight
// from disk (file://, no dev server) in headless Chromium, the same way
// tests/characterization does for the dev build.
//
// Run via `npm run gate`, which builds `--release` first. This file assumes
// dist/release/band-coach.html already exists; it does not build it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchPage } from '../helpers/browser.mjs';

const RELEASE_HTML = fileURLToPath(new URL('../../dist/release/band-coach.html', import.meta.url));
const PKG = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'));
const SIZE_BUDGET_BYTES = 1.5 * 1024 * 1024;

// Pure-Node WAV writer: 16-bit PCM mono, a steady sine, no binary fixture
// committed to the repo.
function writeSineWav(path, { seconds = 3, freq = 440, sampleRate = 48000 } = {}) {
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
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.85;
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sample * 32767))), 44 + i * 2);
  }
  writeFileSync(path, buf);
  return path;
}

test('release file size stays within the 1.5 MB download budget', () => {
  const bytes = statSync(RELEASE_HTML).size;
  console.log(`release file size: ${bytes} bytes (${(bytes / (1024 * 1024)).toFixed(3)} MB)`);
  assert.ok(bytes <= SIZE_BUDGET_BYTES, `release file is ${bytes} bytes, budget is ${SIZE_BUDGET_BYTES}`);
});

test('release build: no network beyond the page, no console errors, debug hook removed, version stamped', async (t) => {
  const page = await launchPage(RELEASE_HTML);
  t.after(() => page.close());

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions during boot');
  assert.deepEqual(page.consoleErrors, [], 'no console.error during boot');

  const nonFileRequests = page.requests.filter((url) => !url.startsWith('file://'));
  assert.deepEqual(
    nonFileRequests,
    [],
    'no network requests other than the file:// page itself: ' + JSON.stringify(page.requests)
  );

  assert.equal(
    await page.evaluate('typeof window.__coach'),
    'undefined',
    'the debug hook must not ship in the release build'
  );

  const metaContent = await page.evaluate(
    "document.querySelector('meta[name=\"band-coach-version\"]')?.getAttribute('content')"
  );
  assert.equal(metaContent, PKG.version, 'version meta content matches package.json');

  const footerText = await page.evaluate("document.getElementById('verFooter')?.textContent");
  assert.ok(footerText && footerText.includes(PKG.version), 'the footer shows the version: ' + footerText);
});

test('release build: a note played into the microphone is heard and shown (tuner)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-wav-'));
  const wavPath = writeSineWav(join(dir, 'a4-440hz.wav'));

  // Captures every CanvasRenderingContext2D.fillText call the app makes so
  // the test can read what the (canvas-drawn, not DOM-text) tuner readout
  // shows, without any debug hook — none ships in the release build.
  const captureScript = `
    (function () {
      window.__bcCanvasText = [];
      var proto = CanvasRenderingContext2D.prototype;
      var orig = proto.fillText;
      proto.fillText = function (text) {
        window.__bcCanvasText.push(String(text));
        return orig.apply(this, arguments);
      };
    })();
  `;

  const page = await launchPage(RELEASE_HTML, { fakeAudioFile: wavPath, initScript: captureScript });
  t.after(() => page.close());

  // Tuner tool, ukulele tuning: its 4th string is A4 (440 Hz, midi 69) —
  // the same note the fake microphone plays — so the readout should show
  // "A4" once the pitch detector locks onto it.
  await page.evaluate("document.querySelector('#picker button[data-mod=\"tuner\"]').click()");
  await page.evaluate(
    "(() => { const s = document.getElementById('optTune'); s.value = 'uke'; s.dispatchEvent(new Event('change')); })()"
  );
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true", 5000);

  const start = Date.now();
  let heardA4 = false;
  while (Date.now() - start < 8000) {
    heardA4 = await page.evaluate("window.__bcCanvasText.some((t) => t.indexOf('A4') !== -1)");
    if (heardA4) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(
    heardA4,
    'the tuner readout should show A4 once the fake microphone plays a steady 440 Hz tone into it'
  );
});
