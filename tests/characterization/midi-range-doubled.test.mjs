// "Set my keyboard's range" with a keyboard that sends one key press twice. A repeat of the same key within a
// moment is the same press: it must not read as "not higher than your lowest key", and the second copy of the
// highest key must not leak out as an ordinary played note ("C heard"). A slow repeat is a real second press.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort } from '../helpers/fake-midi.mjs';

async function start(t, name = 'Test Keys') {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await midiAddPort(page, 'p1', name);
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  await page.evaluate("document.getElementById('midiRangeBtn').click()");
  return page;
}
const coach = page => page.evaluate("document.getElementById('coach').textContent");
const stored = page => page.evaluate('window.__coach.db().prefs.midiRange');

test('a doubled lowest key keeps asking for the highest, and a doubled highest key saves once with no stray note', async (t) => {
  const page = await start(t);
  await page.evaluate("window.__midiSend('p1', [0x90, 48, 100], 1000); window.__midiSend('p1', [0x90, 48, 100], 1012);");
  assert.equal(await coach(page), 'Play your highest key', 'the repeat of the lowest key is not "not higher"');
  await page.evaluate("window.__midiSend('p1', [0x90, 72, 100], 2000); window.__midiSend('p1', [0x90, 72, 100], 2012);");
  assert.equal(await coach(page), 'Range: C3 to C5 (25 keys)', 'the second copy of the highest key says nothing');
  assert.deepEqual(await stored(page), { 'Test Keys': { low: 48, high: 72 } });
  assert.deepEqual(page.exceptions, []);
});

test('control: single presses behave the same, and the same key again after a pause is still "not higher"', async (t) => {
  const page = await start(t);
  await page.evaluate("window.__midiSend('p1', [0x90, 48, 100], 1000); window.__midiSend('p1', [0x90, 48, 100], 1600);");
  assert.match(await coach(page), /not higher than your lowest key/);
  await page.evaluate("window.__midiSend('p1', [0x90, 72, 100], 2000);");
  assert.equal(await coach(page), 'Range: C3 to C5 (25 keys)');
  assert.deepEqual(await stored(page), { 'Test Keys': { low: 48, high: 72 } });
});

test('a different key straight after the highest key is a real played note again', async (t) => {
  const page = await start(t);
  await page.evaluate("window.__midiSend('p1', [0x90, 48, 100], 1000); window.__midiSend('p1', [0x90, 72, 100], 2000); window.__midiSend('p1', [0x90, 60, 100], 2005);");
  assert.match(await coach(page), /heard/);
});
