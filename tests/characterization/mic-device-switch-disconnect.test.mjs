// VERIFIED DEFECT 4 (mic-gate-and-capture): the micDeviceSelect change
// handler (src/app.js) re-opened the mic and called wireAnalysers(src) again
// without ever disconnecting the PREVIOUS source node (lastAudioSource) —
// switching input devices left the old (now-stopped) stream's source node
// still wired into anTime/anFreq/the pitch worklet, piling up dead graph
// edges on every switch.
//
// AudioNode has no public "is this connected" introspection, so this proves
// the fix by installing an `initScript` (runs before ANY page script, per
// tests/helpers/browser.mjs) that counts real AudioNode.prototype.disconnect
// calls, then driving the actual device-switch UI flow (the #micDeviceSelect
// <select>'s change event) with two distinct fake device ids the app itself
// enumerates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

const COUNT_DISCONNECTS_SCRIPT = `
  window.__disconnectCount = 0;
  const origDisconnect = AudioNode.prototype.disconnect;
  AudioNode.prototype.disconnect = function (...args) {
    window.__disconnectCount++;
    return origDisconnect.apply(this, args);
  };
`;

test('switching microphone input devices disconnects the previous source node', async (t) => {
  const page = await launchPage(htmlPath, { initScript: COUNT_DISCONNECTS_SCRIPT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor('window.__coach.devices().length > 1', 5000);

  const ids = await page.evaluate('window.__coach.devices().map(d => d.deviceId)');
  assert.ok(ids.length > 1, 'this test needs at least two distinct fake input devices to switch between');

  const beforeSwitch = await page.evaluate('window.__disconnectCount');

  // Drive the real UI element and event, exactly as a learner picking a
  // different input from the dropdown would.
  await page.evaluate(`
    (function () {
      const sel = document.getElementById('micDeviceSelect');
      sel.value = ${JSON.stringify(ids[1])};
      sel.dispatchEvent(new Event('change'));
    })()
  `);
  await page.waitFor(`window.__coach.db().prefs.inputDeviceId === ${JSON.stringify(ids[1])}`, 5000);
  // openMic() re-opening after the switch is async; give it a moment to
  // finish wiring the new source before reading the disconnect count.
  await page.waitFor('window.__disconnectCount > ' + beforeSwitch, 5000);

  const afterSwitch = await page.evaluate('window.__disconnectCount');
  assert.ok(afterSwitch > beforeSwitch, `expected switching devices to disconnect the previous source node at least once (before ${beforeSwitch}, after ${afterSwitch})`);
});
