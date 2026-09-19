// F11: absolute loudness gates (0.008 / 0.01 / 0.012 RMS) with no
// noise-floor calibration, no level meter, no input-device picker. This
// unit adds a "Check my microphone" calibration (src/app.js
// calibrateNoiseFloor, backed by the pure src/audio/levels.js), an input
// device <select> (src/index.html #micDeviceSelect), and a DOM level
// meter (#micLevelFill) — while keeping the gates EXACTLY at today's
// constants until a learner actually calibrates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('gates default to today\'s constants, the device picker lists an input, and calibration writes a finite noiseFloor', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  // Nothing has calibrated yet: the app must behave exactly as before.
  const gatesBefore = await page.evaluate('window.__coach.gates()');
  assert.deepEqual(gatesBefore, { pitch: 0.008, note: 0.01, chord: 0.012 }, 'default gates must equal today\'s hard-coded constants');

  // 'gtr' has input: 'pluck', so Connect opens the microphone.
  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor('window.__coach.devices().length > 0', 5000);

  const optionCount = await page.evaluate("document.getElementById('micDeviceSelect').options.length");
  assert.ok(optionCount >= 2, `expected the default option plus at least one real input, got ${optionCount}`);

  // Calibration must stay usable while offline device labels come back
  // empty (headless fake devices may not label until permission settles) —
  // it should not throw either way.
  await page.evaluate('window.__coach.calibrate()');
  await page.waitFor("document.getElementById('calibrateResult').textContent.length > 0", 5000);

  const floor = await page.evaluate('window.__coach.db().prefs.noiseFloor');
  assert.ok(Number.isFinite(floor), `expected calibration to write a finite noiseFloor, got ${floor}`);
  assert.ok(floor >= 0, 'noiseFloor must not be negative');

  const gatesAfter = await page.evaluate('window.__coach.gates()');
  assert.ok(Number.isFinite(gatesAfter.pitch) && Number.isFinite(gatesAfter.note) && Number.isFinite(gatesAfter.chord), 'gates must remain finite after calibration');
});
