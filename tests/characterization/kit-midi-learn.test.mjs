import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchPage } from '../helpers/browser.mjs';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { FAKE_MIDI_INIT, midiNoteOn, midiNoteOff } from '../helpers/fake-midi.mjs';
import { connectFakeMidi } from './kbd-journey-shared.mjs';

const PIECE_IDS = ['kick', 'snare', 'hihat-closed', 'hihat-pedal', 'hihat-open', 'tom-floor', 'tom-mid', 'tom-high', 'crash', 'ride'];
const coach = page => page.evaluate("document.getElementById('coach').textContent");
const prompt = page => page.evaluate("document.getElementById('kitLearnStatus').textContent");

test('"Hit each pad" lights each piece in turn, saves a map for that device, and the map survives backup and reload', async t => {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await connectFakeMidi(page, 'p1', 'XKORCE Kit');
  await page.evaluate("document.getElementById('setupBtn').click()");
  await page.evaluate("document.getElementById('kitLearn').click()");
  assert.match(await prompt(page), /Kick/, 'starts on the first piece');
  assert.equal(await page.evaluate("document.querySelector('#kitPreview .kit-sel').dataset.piece"), 'kick', 'the piece being learned is lit');
  // A note from the pad, then a skip, then the rest in order.
  await midiNoteOn(page, 'p1', 60);
  assert.match(await prompt(page), /Snare/);
  await page.evaluate("document.getElementById('kitLearnSkip').click()");
  assert.match(await prompt(page), /Hi-hat closed/);
  let n = 70;
  for (const id of PIECE_IDS.slice(2)) { await midiNoteOn(page, 'p1', n++); await midiNoteOff(page, 'p1', n - 1); }
  const kit = await page.evaluate('window.__coach.db().prefs.kit');
  assert.deepEqual(kit.midiMaps['XKORCE Kit'], { 60: 'kick', 70: 'hihat-closed', 71: 'hihat-pedal', 72: 'hihat-open', 73: 'tom-floor', 74: 'tom-mid', 75: 'tom-high', 76: 'crash', 77: 'ride' });
  assert.match(await prompt(page), /9/, 'the finish line says how many pads were learned');
  // Learning must not have judged anything or counted a hit.
  assert.equal(await page.evaluate('window.__coach.bar()'), null);
  const backup = await page.evaluate('window.__coach.exportProgress()');
  await page.evaluate("document.getElementById('kitLearnForget').click()");
  assert.equal(await page.evaluate("'midiMaps' in window.__coach.db().prefs.kit"), false);
  assert.equal(await page.evaluate(`window.__coach.importProgress(${JSON.stringify(JSON.stringify(backup))}).then(r => r.ok)`), true);
  assert.deepEqual(await page.evaluate('window.__coach.db().prefs.kit.midiMaps["XKORCE Kit"][60]'), 'kick');
});

test('a learned note plays its piece, other devices keep the GM map, and an unseen note stays an extra note', async t => {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await page.evaluate("window.__coach.db().prefs.kit = { midiMaps: { 'XKORCE Kit': { 60: 'snare', 38: 'ride' } } }; window.__coach.setMod('drum-kit')");
  await page.evaluate("window.__midiAddPort('p2', 'Plain Kit', 'connected')");
  await connectFakeMidi(page, 'p1', 'XKORCE Kit');
  await midiNoteOn(page, 'p1', 60);
  assert.match(await coach(page), /Snare heard/);
  await midiNoteOn(page, 'p1', 38);
  assert.match(await coach(page), /Ride cymbal heard/, 'the learned note beats GM on this device');
  await midiNoteOn(page, 'p1', 36);
  assert.match(await coach(page), /Bass drum heard/, 'unlearned notes keep the GM reading');
  await midiNoteOn(page, 'p1', 39);
  assert.match(await coach(page), /not one of the drums/);
  await midiNoteOn(page, 'p2', 38);
  assert.match(await coach(page), /Snare heard/, 'another device falls back to GM');
});

test('the walk-through skips pieces hidden on the set-up sheet', async t => {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await page.evaluate("window.__coach.db().prefs.kit = { hiddenPieces: ['snare', 'hihat-pedal', 'hihat-open', 'tom-floor', 'tom-mid', 'tom-high', 'crash', 'ride'] }; window.__coach.setMod('drum-kit')");
  await connectFakeMidi(page, 'p1', 'XKORCE Kit');
  await page.evaluate("document.getElementById('setupBtn').click()");
  await page.evaluate("document.getElementById('kitLearn').click()");
  assert.match(await prompt(page), /Kick/);
  await midiNoteOn(page, 'p1', 60);
  assert.match(await prompt(page), /Hi-hat closed/, 'snare is hidden, so the walk-through goes straight on');
  await midiNoteOn(page, 'p1', 61);
  assert.equal(await page.evaluate("document.getElementById('kitLearnStop') .hidden"), true, 'the walk-through ended after the last shown piece');
  assert.deepEqual(await page.evaluate('window.__coach.db().prefs.kit.midiMaps["XKORCE Kit"]'), { 60: 'kick', 61: 'hihat-closed' });
});

test('learning a single pad reads "1 pad", not "1 pads"', async t => {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await connectFakeMidi(page, 'p1', 'XKORCE Kit');
  await page.evaluate("document.getElementById('setupBtn').click()");
  await page.evaluate("document.getElementById('kitLearn').click()");
  await midiNoteOn(page, 'p1', 60);
  await page.evaluate("document.getElementById('kitLearnStop').click()");
  assert.equal(await prompt(page), 'Learned 1 pad on XKORCE Kit.');
});
