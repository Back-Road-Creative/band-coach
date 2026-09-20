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
import { launchPage, effectiveWaitMs } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort, midiNoteOn } from '../helpers/fake-midi.mjs';

const RELEASE_HTML = fileURLToPath(new URL('../../dist/release/band-coach.html', import.meta.url));
const PKG = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'));
const SIZE_BUDGET_BYTES = 1.5 * 1024 * 1024;

// Pure-Node WAV writer: 16-bit PCM mono, a sharp attack that decays
// exponentially to true silence, then real silence for the rest of the
// file. Models a plucked string, not a held tone -- the shape the tuner
// bug report was about. Chromium loops a fake-audio-capture file once it
// reaches the end, so `silenceSeconds` is generous: the file must stay
// silent for well longer than any window a test measures against it.
function writeDecayWav(path, { freq = 440, sampleRate = 48000, toneSeconds = 0.6, silenceSeconds = 6.4 } = {}) {
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

// A fresh profile (new localStorage every launchPage()) starts at kbd level
// 1, which only ever asks for these three notes (src/app.js:243, N(60,62,64)
// under 'C, D and E'). The on-screen prompt names the target note by pitch
// class regardless of whether it has been revealed (src/core/reveal.js
// promptFor(): item.label is always set for a 'note' item), so a real
// learner -- and this test -- can read '#prompt b' to know what to play
// without any debug hook.
const LEVEL1_NOTE_TO_MIDI = { C: 60, D: 62, E: 64 };
// src/app.js:1226 PCKEYS: the real computer-keyboard note entry a learner
// without a MIDI device uses. Only the level-1 keys are needed here.
const LEVEL1_MIDI_TO_PCKEY = { 60: 'a', 62: 's', 64: 'd' };

async function readLevel1TargetMidi(page) {
  await page.waitFor("document.querySelector('#prompt b') !== null");
  const label = await page.evaluate("document.querySelector('#prompt b').textContent.trim()");
  const midi = LEVEL1_NOTE_TO_MIDI[label];
  if (midi === undefined) {
    throw new Error(
      `level-1 keyboard prompt showed "${label}", not one of C/D/E -- a fresh profile should start at ` +
        'level 1 (src/app.js:243); if that changed, this test needs updating, not loosening.'
    );
  }
  return midi;
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

test('release build: the tuner readout survives a decaying note through the silence after it, not just once', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-wav-'));
  const wavPath = writeDecayWav(join(dir, 'a4-pluck-440hz.wav'));

  // Captures fillText calls, but reset on every clearRect -- the app's
  // render loop calls clearRect(0,0,W,H) exactly once per animation frame
  // (src/app.js:1016) before redrawing, so this array always reflects only
  // the CURRENT frame, not "was this text ever drawn, at any point in the
  // test." The old assertion here was `.some(...)` over every frame ever
  // drawn, which is exactly why it could not fail: the tuner's row list
  // (src/app.js:1053, 'String 4   A4') names every string's OPEN pitch
  // unconditionally, every frame, tone or no tone. The text that actually
  // depends on a live detection is the big central readout drawn only while
  // st.phase !== 'idle' (src/app.js:1054/1060), and for A4 that text is the
  // bare pitch class 'A' (nname() with no octave argument) -- distinct from
  // the row label's 'A4', so checking for exactly 'A' proves the live
  // readout, not the always-there tuning reference.
  const captureScript = `
    (function () {
      window.__bcCanvasText = [];
      var proto = CanvasRenderingContext2D.prototype;
      var origFillText = proto.fillText;
      var origClearRect = proto.clearRect;
      proto.clearRect = function () {
        window.__bcCanvasText = [];
        return origClearRect.apply(this, arguments);
      };
      proto.fillText = function (text) {
        window.__bcCanvasText.push(String(text));
        return origFillText.apply(this, arguments);
      };
    })();
  `;

  const page = await launchPage(RELEASE_HTML, { fakeAudioFile: wavPath, initScript: captureScript });
  t.after(() => page.close());

  // Tuner tool, ukulele tuning: its 4th string is A4 (440 Hz, midi 69) —
  // the same note the fake microphone plays.
  await page.evaluate("document.querySelector('#picker button[data-mod=\"tuner\"]').click()");
  await page.evaluate(
    "(() => { const s = document.getElementById('optTune'); s.value = 'uke'; s.dispatchEvent(new Event('change')); })()"
  );
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true");

  const currentFrameShowsA = () => page.evaluate("window.__bcCanvasText.indexOf('A') !== -1");

  const detectDeadline = Date.now() + effectiveWaitMs(8000);
  let firstSeenAt = null;
  while (Date.now() < detectDeadline) {
    if (await currentFrameShowsA()) { firstSeenAt = Date.now(); break; }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(firstSeenAt, 'the tuner readout never showed A even once while the fake microphone played 440 Hz');

  // The product's own hold window is 1500ms of CONTINUOUS silence before the
  // readout is allowed to drop back to idle (src/core/tuner.js stepTuner,
  // holdWindowMs). This checks a 900ms window from first detection — well
  // under that budget even accounting for the ~600ms of tone still playing
  // when detection first lands — so every sample in it must still show the
  // note. A regression that blanks the readout the instant the signal goes
  // quiet (the exact field report this test exists for) fails on the very
  // first sample taken after the pluck's decay tail ends.
  const persistUntil = firstSeenAt + 900;
  while (Date.now() < persistUntil) {
    const stillShown = await currentFrameShowsA();
    assert.ok(
      stillShown,
      `the tuner readout disappeared ${Date.now() - firstSeenAt}ms after it first showed the note, ` +
        'well inside the product\'s own 1500ms hold-through-silence window'
    );
    await new Promise((r) => setTimeout(r, 75));
  }
});

test('release build: a real MIDI note-on through the Connect button is graded during a running keyboard exercise', async (t) => {
  const page = await launchPage(RELEASE_HTML, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("document.querySelector('#picker button[data-mod=\"kbd\"]').click()");
  await midiAddPort(page, 'p1', 'Test Keys');
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true");

  await page.evaluate("document.getElementById('playBtn').click()");
  const targetMidi = await readLevel1TargetMidi(page);

  await midiNoteOn(page, 'p1', targetMidi);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");
});

test('release build: a real key press with no debug hook plays and grades a note (on-screen/computer-keys entry)', async (t) => {
  const page = await launchPage(RELEASE_HTML);
  t.after(() => page.close());

  await page.evaluate("document.querySelector('#picker button[data-mod=\"kbd\"]').click()");
  await page.evaluate("document.getElementById('playBtn').click()");
  const targetMidi = await readLevel1TargetMidi(page);
  const key = LEVEL1_MIDI_TO_PCKEY[targetMidi];
  assert.ok(key, `no computer-key mapping for target midi ${targetMidi}`);

  // A real KeyboardEvent dispatched at the document, exactly the entry point
  // src/app.js:1226-1232 listens on for a learner with no MIDI device and no
  // pointer precision for the on-screen keys -- never window.__coach.note().
  await page.evaluate(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`
  );
  await page.waitFor("document.getElementById('feedback').className === 'ok'");
  const feedbackText = await page.evaluate("document.getElementById('feedback').textContent");
  assert.ok(feedbackText.length > 0, 'the feedback area should show something a learner can read after a correct key press');
});
