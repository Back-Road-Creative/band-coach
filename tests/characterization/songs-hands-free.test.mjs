// Hands-free song practice (leftovers plan F11): with both hands on an
// instrument, Space presses the step's "Your turn" / "Stop and check" button,
// Enter presses its Next, and a MIDI sustain pedal (CC64) presses whichever
// one the screen shows -- except while a keyboard part is recording, where
// the pedal is the player's sustain and is left alone. Driven by real key
// events over CDP (page.press) and a fake Web MIDI port
// (tests/helpers/fake-midi.mjs), never the debug hook's own buttons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort, midiSend } from '../helpers/fake-midi.mjs';
import { skipDemo } from '../helpers/songs-demo.mjs';

const htmlPath = HTML_PATH;
const HEADING = "(document.querySelector('.panel-songs-practice h4') || {}).textContent || ''";
const hasButton = (text) => `Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === ${JSON.stringify(text)})`;

async function openHotCrossBuns(page) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  // The click above leaves focus on a button that is now gone; nothing on
  // the page is focused, as for a learner who has put the mouse down.
  await page.evaluate('document.activeElement && document.activeElement.blur()');
}

async function pedal(page, value) { await midiSend(page, 'p1', [0xb0, 64, value]); }

test('Enter is Next and Space starts and stops a try, with nothing focused', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await openHotCrossBuns(page);

  assert.ok((await page.evaluate(HEADING)).startsWith('Listen'), 'starts on the Listen step');
  await page.press('Enter');
  await page.waitFor(`!(${HEADING}).startsWith('Listen')`);
  await skipDemo(page);
  await page.waitFor(hasButton('Your turn'));

  await page.press(' ');
  await page.waitFor(hasButton('Stop and check'));
  await page.press(' ');
  await page.waitFor(hasButton('Your turn'));
  assert.deepEqual(page.exceptions, []);
});

test('Space on a focused button presses only that button, once', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await openHotCrossBuns(page);
  await page.press('Enter');
  await page.waitFor(`!(${HEADING}).startsWith('Listen')`);
  await skipDemo(page);
  await page.waitFor(hasButton('Your turn'));

  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn').focus()");
  await page.press(' ');
  await page.waitFor(hasButton('Stop and check'));
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(await page.evaluate(hasButton('Stop and check')), 'one press started the try and did not also stop it');
  assert.deepEqual(page.exceptions, []);
});

test('a sustain pedal press is Next, then Your turn; held through a keyboard try it is left alone', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await openHotCrossBuns(page);
  await midiAddPort(page, 'p1', 'Test Keys');
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true");

  await pedal(page, 127);
  await pedal(page, 0);
  await page.waitFor(`!(${HEADING}).startsWith('Listen')`);
  await skipDemo(page);
  await page.waitFor(hasButton('Your turn'));

  // Down, a repeat of down (a half-pedal wobble), then up: one press.
  await pedal(page, 127);
  await pedal(page, 100);
  await pedal(page, 0);
  await page.waitFor(hasButton('Stop and check'));

  // A pianist pedals while playing: the try keeps listening.
  await pedal(page, 127);
  await pedal(page, 0);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(await page.evaluate(hasButton('Stop and check')), 'the pedal did not stop a keyboard try');

  await page.press(' ');
  await page.waitFor(hasButton('Your turn'));
  assert.deepEqual(page.exceptions, []);
});
