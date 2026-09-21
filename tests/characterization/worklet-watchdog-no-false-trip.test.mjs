// Companion to worklet-watchdog-fallback.test.mjs, which proves the watchdog
// FIRES when the worklet is genuinely dead. This proves it does NOT fire when
// the worklet is fine and audio has merely paused.
//
// The worry that prompted it, read off the device-switch handler in
// src/app.js: picking a different microphone stops the current stream's
// tracks, clears micReady, and then AWAITS getUserMedia for the new device.
// Acquiring a device can easily outlast the watchdog's half-second grace
// period -- a permission prompt, a USB interface waking up -- and a watchdog
// that discarded a healthy worklet mid-switch would log a failure that never
// happened and drop the app onto its slower main-thread path for the rest of
// the session. A watchdog that cries wolf gets deleted by the next person to
// see it fire wrongly, taking the real protection with it.
//
// MEASURED, and the worry turned out to be unfounded: frames do NOT stop
// during a switch. The test was re-run with the grace period cut from 500ms
// to 50ms and still passed, which it could not have done if there were any
// gap at all -- the old source node keeps feeding the worklet while the new
// device is acquired. So this passes today by construction, not because of
// any guard.
//
// It is kept deliberately, as the guard for the change that WOULD introduce
// the problem: anything that tears the worklet's input down on a switch, or
// rebuilds the audio graph across the await, makes frames stop and turns this
// red. That is exactly when somebody needs to be told.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

// Makes every getUserMedia call after the first one take 900ms -- comfortably
// past the 0.5s grace period, and a realistic time for a real device to come
// up. The first call is left fast so the test reaches a live worklet quickly.
const SLOW_SECOND_GETUSERMEDIA = `
  (function () {
    var calls = 0;
    var orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function (constraints) {
      calls++;
      if (calls === 1) return orig(constraints);
      return new Promise(function (resolve, reject) {
        setTimeout(function () { orig(constraints).then(resolve, reject); }, 900);
      });
    };
  })();
`;

test('the worklet watchdog does not trip while a slow microphone switch is in flight', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: SLOW_SECOND_GETUSERMEDIA });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor('window.__coach.pitchWorkletActive() === true', 8000);
  await page.waitFor('window.__coach.devices().length > 1', 5000);

  const ids = await page.evaluate('window.__coach.devices().map(d => d.deviceId)');
  assert.ok(ids.length > 1, 'this test needs at least two fake input devices to switch between');

  // The real UI flow: pick the other device from the dropdown.
  await page.evaluate(`
    (() => {
      const sel = document.getElementById('micDeviceSelect');
      sel.value = ${JSON.stringify(ids[1])};
      sel.dispatchEvent(new Event('change'));
    })()
  `);

  // Wait out the whole slow acquisition plus a margin, so the watchdog has had
  // every chance to fire.
  await new Promise((r) => setTimeout(r, 1400));

  const active = await page.evaluate('window.__coach.pitchWorkletActive()');
  const tripped = await page.evaluate(
    "JSON.stringify(window.__coach.errors().filter(e => String(e.where || '').indexOf('worklet-watchdog') !== -1))"
  );

  assert.equal(
    tripped,
    '[]',
    'the watchdog recorded a failure during a microphone switch, when the worklet was healthy and ' +
      'audio was merely paused while the new device was being acquired: ' + tripped,
  );
  assert.equal(
    active,
    true,
    'the worklet was discarded during a microphone switch. It was never broken -- no audio was ' +
      'reaching it because the app was awaiting getUserMedia for the newly-chosen device -- so the ' +
      'app has dropped onto its main-thread fallback for the rest of the session for no reason.',
  );
});
