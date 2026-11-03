import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchPage } from '../helpers/browser.mjs';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { FAKE_MIDI_INIT, midiNoteOn } from '../helpers/fake-midi.mjs';
import { connectFakeMidi } from './kbd-journey-shared.mjs';

const coach = page => page.evaluate("document.getElementById('coach').textContent");
const details = page => page.evaluate("document.getElementById('midiDetailsText').textContent");
const pause = () => new Promise(r => setTimeout(r, 300));
const click = (page, id) => page.evaluate(`document.getElementById('${id}').click()`);
const STANDARD = [36, 38, 42, 44, 46, 43, 45, 48, 49, 51];

async function start(t) {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await connectFakeMidi(page, 'p1', 'USB MIDI');
  return page;
}

test('a bad learned list is named on the heard line and in MIDI details', async t => {
  const page = await start(t);
  await click(page, 'setupBtn'); await click(page, 'kitLearn');
  for (const n of STANDARD) { await pause(); await midiNoteOn(page, 'p1', n); }
  await pause();
  await click(page, 'kitRelearn-tom-high'); await midiNoteOn(page, 'p1', 38);
  await pause();
  await click(page, 'kitRelearn-ride'); await midiNoteOn(page, 'p1', 48);
  await pause();
  await midiNoteOn(page, 'p1', 38);
  assert.match(await coach(page), /^High tom heard \(note 38, learned as High tom; General MIDI says Snare\) -- start an exercise/);
  await midiNoteOn(page, 'p1', 48);
  assert.match(await coach(page), /^Ride heard \(note 48, learned as Ride; General MIDI says High tom\)/);
  await midiNoteOn(page, 'p1', 36);
  assert.match(await coach(page), /^Kick heard -- start an exercise/);
  await click(page, 'midiDetailsBtn');
  const d = await details(page);
  assert.match(d, /-> High tom \(learned, GM Snare\)/);
  assert.match(d, /-> Ride \(learned, GM High tom\)/);
  assert.match(d, /Learned pad list in use for USB MIDI: \d+ notes/);
});

test('with no learned list the heard line and details stay plain', async t => {
  const page = await start(t);
  await midiNoteOn(page, 'p1', 38);
  assert.match(await coach(page), /^Snare heard -- start an exercise/);
  await click(page, 'midiDetailsBtn');
  assert.doesNotMatch(await details(page), /learned/i);
});
