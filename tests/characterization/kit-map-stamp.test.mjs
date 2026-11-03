import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchPage } from '../helpers/browser.mjs';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { FAKE_MIDI_INIT, midiNoteOn } from '../helpers/fake-midi.mjs';
import { connectFakeMidi } from './kbd-journey-shared.mjs';

const DEV = 'XKORCE Kit';
const PIECE_IDS = ['kick', 'snare', 'hihat-closed', 'hihat-pedal', 'hihat-open', 'tom-floor', 'tom-mid', 'tom-high', 'crash', 'ride'];
const STANDARD = { 36: 'kick', 38: 'snare', 42: 'hihat-closed', 44: 'hihat-pedal', 46: 'hihat-open', 41: 'tom-floor', 47: 'tom-mid', 50: 'tom-high', 49: 'crash', 51: 'ride' };
const NOTE_OF = Object.fromEntries(Object.entries(STANDARD).map(([n, id]) => [id, Number(n)]));
const coach = page => page.evaluate("document.getElementById('coach').textContent");
// Longer than the 250 ms quiet gap in src/ui/kit-setup.js: a player pauses between pads.
const pause = () => new Promise(r => setTimeout(r, 300));
const click = (page, id) => page.evaluate(`document.getElementById('${id}').click()`);
const savedList = page => page.evaluate(`(window.__coach.db().prefs.kit.midiMaps || {})[${JSON.stringify(DEV)}]`);
const open = async t => {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await connectFakeMidi(page, 'p1', DEV);
  return page;
};
const hit = async (page, note) => { await pause(); await midiNoteOn(page, 'p1', note, 100, 9); };
// Teach every pad in a full set-up with `notes[id]`.
const fullSetup = async (page, notes) => { await click(page, 'setupBtn'); await click(page, 'kitLearn'); for (const id of PIECE_IDS) await hit(page, notes[id]); };
const relearn = async (page, id, note) => { await click(page, 'kitRelearn-' + id); await hit(page, note); };
// The wrong list a pre-fix walk-through could leave: snare as high tom, high tom as ride.
const teachWrongList = async page => {
  await fullSetup(page, NOTE_OF);
  await relearn(page, 'tom-high', 38); await relearn(page, 'ride', 48);
  assert.equal((await savedList(page))[38], 'tom-high', 'precondition: the wrong list is saved');
};

test('an unstamped saved list from an older version is dropped on load and GM reads the pads', async t => {
  const seed = JSON.stringify({ prefs: { kit: { preset: 'compact', midiMaps: { [DEV]: { 38: 'tom-high', 48: 'ride' } } } } });
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT + `;if (!localStorage.getItem('bandcoach.v1')) localStorage.setItem('bandcoach.v1', ${JSON.stringify(seed)});` });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await connectFakeMidi(page, 'p1', DEV);
  assert.equal(await page.evaluate('window.__coach.db().prefs.kit.midiMaps'), undefined, 'the old list is gone');
  assert.equal(await page.evaluate('window.__coach.db().prefs.kit.preset'), 'compact', 'the rest of the kit prefs stay');
  await midiNoteOn(page, 'p1', 38, 100, 9); assert.match(await coach(page), /Snare heard -- start an exercise to see it judged\./);
  await midiNoteOn(page, 'p1', 48, 100, 9); assert.match(await coach(page), /High tom heard -- start an exercise to see it judged\./);
});

test('a stamped list is kept across reload', async t => {
  const page = await open(t);
  await click(page, 'setupBtn'); await click(page, 'kitLearn'); await midiNoteOn(page, 'p1', 60, 100, 9); await click(page, 'kitLearnStop');
  await page.reload();
  assert.deepEqual(await savedList(page), { 60: 'kick' });
});

test('a new full set-up stopped early leaves only the pads heard; the old wrong list is gone', async t => {
  const page = await open(t);
  await teachWrongList(page);
  await click(page, 'kitLearn');
  await hit(page, 36);
  await click(page, 'kitLearnStop');
  assert.deepEqual(await savedList(page), { 36: 'kick' });
  await midiNoteOn(page, 'p1', 38, 100, 9); assert.match(await coach(page), /Snare heard/);
});

test('a skipped pad in a new full set-up stays unlearned instead of keeping its old note', async t => {
  const page = await open(t);
  await teachWrongList(page);
  await click(page, 'kitLearn'); await hit(page, 36); await click(page, 'kitLearnSkip'); await click(page, 'kitLearnStop');
  assert.deepEqual(await savedList(page), { 36: 'kick' });
});

test('a full set-up answered with the standard notes replaces the wrong list and every pad reads right', async t => {
  const page = await open(t);
  await teachWrongList(page);
  await click(page, 'kitLearn');
  for (const id of PIECE_IDS) await hit(page, NOTE_OF[id]);
  assert.deepEqual(await savedList(page), STANDARD);
  for (const [note, id] of Object.entries(STANDARD)) {
    if (id === 'hihat-pedal') continue;
    await midiNoteOn(page, 'p1', Number(note), 100, 9);
    const label = await coach(page);
    assert.match(label, new RegExp('^' + ({ 'hihat-closed': 'Hi-hat closed', 'hihat-open': 'Hi-hat open', 'tom-floor': 'Floor tom', 'tom-mid': 'Mid tom', 'tom-high': 'High tom' }[id] || id[0].toUpperCase() + id.slice(1)) + ' heard'), note + ' reads as ' + id);
  }
});

test('relearning one pad keeps the rest of the list', async t => {
  const page = await open(t);
  await fullSetup(page, NOTE_OF);
  await relearn(page, 'ride', 60);
  const list = await savedList(page);
  assert.equal(list[60], 'ride'); assert.equal(list[36], 'kick'); assert.equal(Object.keys(list).length, 10);
});
