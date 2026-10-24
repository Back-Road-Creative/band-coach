// Pins the wording of the microphone connect path in English: the Connect
// button a mic instrument shows, the tuner's own Connect button, and the
// device picker's first option. These come from the i18n catalogue
// (tuner.connectMic, setup.defaultMic) rather than a second hand-typed copy
// in src/app.js, so the two can never drift apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

test('the mic Connect button, the tuner Connect button and the default device option keep their wording', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  assert.equal(await page.evaluate("document.getElementById('ioBtn').textContent"), 'Connect microphone');

  await page.evaluate("window.__coach.setMod('tuner')");
  assert.equal(await page.evaluate("document.getElementById('tunerConnect').textContent"), 'Connect microphone');

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor('window.__coach.devices().length > 0', 5000);
  assert.equal(await page.evaluate("document.getElementById('micDeviceSelect').options[0].textContent"), 'Default microphone');
  assert.equal(await page.evaluate("document.getElementById('micDeviceSelect').options[0].value"), '');
  assert.deepEqual(page.exceptions, []);
});
