// "Calibrate timing" listens for eight taps. A keyboard or pad that sends one hit twice (a bouncing contact, a
// double trigger) must not count as two taps: the run stops at eight and a tap closer than half a beat to the
// last counted one is ignored. Real entry points: a fake MIDI port, the real ioBtn and calBtn clicks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort } from '../helpers/fake-midi.mjs';

const feedback = "document.getElementById('feedback').textContent";
const HIT = "window.__midiSend('p1', [0x90, 60, 100]); window.__midiSend('p1', [0x80, 60, 0]);";

async function startCalibrate(t) {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('rhy')");
  await midiAddPort(page, 'p1', 'Test Keys');
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  await page.evaluate("document.getElementById('calBtn').click()");
  await page.waitFor(`${feedback} === 'Tap along with the eight clicks.'`);
  return page;
}
const pause = ms => new Promise(r => setTimeout(r, ms));

// Eight hits, each sent `times` times in the same instant, about half a second apart (a beat is 0.83 s at the calibration tempo).
async function run(page, times) {
  const seen = [];
  for (let i = 0; i < 8; i++) {
    await page.evaluate(HIT.repeat(times));
    await page.waitFor(`${feedback} === 'Caught ${i + 1} of 8 taps.'`, 3000);
    seen.push(await page.evaluate(feedback));
    await pause(500);
  }
  return seen;
}

test('a doubled hit counts once: eight real taps read 1 of 8 up to 8 of 8, then the run calibrates', async (t) => {
  const page = await startCalibrate(t);
  const seen = await run(page, 2);
  assert.equal(seen[7], 'Caught 8 of 8 taps.');
  await page.waitFor(`/^Timing calibrated: -?\\d+ ms\\.$/.test(${feedback})`, 10000);
  assert.deepEqual(page.exceptions, []);
});

test('control: single hits count one each and calibrate', async (t) => {
  const page = await startCalibrate(t);
  const seen = await run(page, 1);
  assert.equal(seen[7], 'Caught 8 of 8 taps.');
  await page.waitFor(`/^Timing calibrated: -?\\d+ ms\\.$/.test(${feedback})`, 10000);
});

test('taps after the eighth are not counted', async (t) => {
  const page = await startCalibrate(t);
  await run(page, 1);
  await page.evaluate(HIT);
  await pause(300);
  assert.equal(await page.evaluate(feedback), 'Caught 8 of 8 taps.');
});

test('a doubled run before the cap never reads more than 8', async (t) => {
  const page = await startCalibrate(t);
  for (let i = 0; i < 6; i++) { await page.evaluate(HIT.repeat(3)); await pause(450); }
  assert.equal(await page.evaluate(feedback), 'Caught 6 of 8 taps.');
});
