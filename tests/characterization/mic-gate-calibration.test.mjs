// VERIFIED DEFECT 1 (mic-gate-and-capture): ensurePitchWorklet() built the
// AudioWorklet's pitch detector ONCE with `rmsGate: gates.pitch` captured at
// creation time, and calibrateNoiseFloor() recomputed `gates` on the main
// thread afterwards without ever telling the already-created worklet — a
// learner with a quiet mic who ran "Check my microphone" saw the main-thread
// `gates` object change but the WORKLET kept gating on the old, higher
// value, so a quiet pluck it should now be able to hear still never
// produced a pitch. This drives the real getUserMedia -> worklet -> onPitch
// pipeline with a real (if synthetic) fake-microphone WAV, per
// tests/helpers/browser.mjs's `fakeAudioFile` and
// tests/helpers/pluck-wav.mjs's Karplus-Strong pluck generator, and asserts
// on the WORKLET'S OWN behaviour (a frame carrying a nonzero pitch reaching
// the page via window.__coach.heard()) rather than on the main-thread
// `gates` object, which could change with nothing downstream noticing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { pluck, writePluckWav } from '../helpers/pluck-wav.mjs';
import { waitForHeardSnapshot } from '../helpers/audio-heard.mjs';

const htmlPath = HTML_PATH;
const SR = 48000;

// A2 (110 Hz), quiet and (deliberately, only for this fixture) very
// slow-decaying so it spends a wide, easy-to-catch window of real time
// sitting between the two gates under test: measured (see this unit's own
// probe, and the FINAL REPORT) to fall from ~0.0108 RMS down through the
// stock default gates.pitch (0.008) by ~800ms, then settle in the
// ~0.006-0.0075 band for several seconds after -- below the stock gate, but
// above a calibrated-quiet-mic gate (gatesFor(0.0015) == 0.0045).
function writeQuietPluck(path) {
  const buf = pluck(110, SR, 6.0, { seed: 9, decay: 0.9999995, brightness: 0.3, gain: 0.06 });
  writePluckWav(path, buf, SR);
  return path;
}

test('a quiet pluck the stock gate misses registers once "Check my microphone" lowers the worklet\'s own gate', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mic-gate-calibration-'));
  const wavPath = writeQuietPluck(join(dir, 'quiet-pluck.wav'));

  const page = await launchPage(htmlPath, { fakeAudioFile: wavPath });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor('window.__coach.devices().length > 0', 5000);

  // Wait for the fixture to ring down into the STOCK default gate's band
  // (crosses 0.008 around 800ms in, then settles in a ~0.006-0.0075 band for
  // several seconds — see writeQuietPluck above), and read the gate, rms and
  // freq that qualified the wait TOGETHER, in one round-trip -- so the
  // assertion below is made against the exact instant the wait found, never
  // a later frame reached by a second, separate evaluate(). This is the
  // "before" half of the characterization, not an assumption.
  const before = await waitForHeardSnapshot(
    page,
    (s) => s.rms > 0.005 && s.rms < 0.0075,
    { timeoutMs: 8000 },
  );
  assert.equal(before.gate, 0.008, 'the worklet must start at the stock default rmsGate');
  // The sampled band (0.005-0.0075) is entirely below the stock gate
  // (0.008), so this implication is never vacuous here -- it is the same
  // "quiet pluck at the stock gate produces no pitch" claim, stated so a
  // future failure message cannot again print a number that contradicts the
  // claim it is making.
  assert.ok(
    !(before.rms < before.gate) || before.freq === 0,
    `expected no pitch when rms (${before.rms}) is below the sampled gate (${before.gate}), got freq ${before.freq}`,
  );

  // setNoiseFloorForTest drives the exact gatesFor()+applyGates() path
  // calibrateNoiseFloor() uses (see src/app.js), skipping only the real
  // 3-second quiet-room listen -- a deterministic stand-in for a learner
  // with a genuinely quiet room/mic, not a fabricated pass.
  await page.evaluate('window.__coach.setNoiseFloorForTest(0.0015)');
  const gateAfter = await page.evaluate('window.__coach.pitchWorkletGate()');
  assert.ok(gateAfter < 0.008, `expected the worklet's own gate to drop below the stock default, got ${gateAfter}`);

  const after = await waitForHeardSnapshot(page, (s) => s.freq > 0, { timeoutMs: 5000 });
  const cents = 1200 * Math.log2(after.freq / 110);
  assert.ok(Math.abs(cents) < 50, `expected the worklet to report ~110 Hz once its own gate was lowered, got ${after.freq} Hz`);
});

test('the worklet catches up on a gate change made while ensurePitchWorklet() is still resolving', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  // Fire the worklet's creation (testPluck awaits ensurePitchWorklet()
  // internally) and a calibration change CONCURRENTLY, so the gate change
  // can land while createPitchNode()'s addModule() is still loading --
  // the worklet must end up at the CURRENT gates.pitch once both settle,
  // not whatever gate0 it happened to be built with the instant it was
  // constructed.
  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate(`
    (async () => {
      const p = window.__coach.testPluck(220, [0]);
      window.__coach.setNoiseFloorForTest(0.0015);
      await p;
    })()
  `);

  const gate = await page.evaluate('window.__coach.pitchWorkletGate()');
  const expected = await page.evaluate('window.__coach.gates().pitch');
  assert.equal(gate, expected, 'the worklet must be caught up to the current gates.pitch even when calibrated before it existed');
});
