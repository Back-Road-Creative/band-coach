// A learned drum-pad map belongs to a kit part. In Songs the map applies only while the part being practised is a
// percussion part; a keyboard that happens to share the kit's saved device name ("USB MIDI" is common) plays its
// own notes. The range walk reads raw keys either way, and the device name keys two separate stores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiNoteOn } from '../helpers/fake-midi.mjs';
import { htmlPath, HCB_BY_HEADING, clickMode, connectFakeMidi, selectKbdMod, clickButtonNamed, driveStepReal } from './kbd-journey-shared.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NAME = 'USB MIDI';
// C4, D4, E4 are taught as snare, kick, hi-hat on this device (Hot Cross Buns uses 60, 62, 64).
const KEYBOARD_MAP = { 60: 'snare', 62: 'kick', 64: 'hihat-closed' };
const practiceText = page => page.evaluate("document.querySelector('.panel-songs-practice').textContent");

async function openHotCrossBuns(t, savedMap) {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await selectKbdMod(page);
  if (savedMap) await page.evaluate(`window.__coach.db().prefs.kit = { midiMaps: { ${JSON.stringify(NAME)}: ${JSON.stringify(savedMap)} } }`);
  await connectFakeMidi(page, 'p1', NAME);
  await page.evaluate("document.getElementById('harderBtn').click()");
  await page.waitFor("!!document.getElementById('kbdSongHandoff')");
  await page.evaluate("document.getElementById('kbdSongHandoff').click()");
  await page.waitFor("(document.getElementById('songsPracticeHeading') || {}).textContent === 'Hot Cross Buns'");
  await clickMode(page, 'check');
  return page;
}

// Plays every step up to and including the first "Play the notes" step with real MIDI, and says whether that step passed.
async function playUpToPitches(page) {
  for (let i = 0; i < 12; i++) {
    if (await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Next')")) { await clickButtonNamed(page, 'Next'); continue; }
    const heading = await page.evaluate("(document.querySelector('.panel-songs-practice h4') || {}).textContent");
    const key = (heading.match(/^(.*\(bars \d+-\d+\))/) || [])[1];
    const isPitches = heading.startsWith('Play the notes');
    await clickButtonNamed(page, 'Your turn');
    await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')", 8000);
    await driveStepReal(page, HCB_BY_HEADING[key][0], 'midi');
    await page.waitFor("Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Stop and check')", 15000);
    await clickButtonNamed(page, 'Stop and check');
    await page.waitFor("document.querySelector('.panel-songs-practice h4') || document.querySelector('.panel-songs-practice p')");
    if (isPitches) return practiceText(page);
  }
  throw new Error('never reached the pitches step');
}

test('a keyboard named like a kit with a saved map still plays its own notes in Songs', async (t) => {
  const page = await openHotCrossBuns(t, KEYBOARD_MAP);
  const text = await playUpToPitches(page);
  assert.doesNotMatch(text, /Missed/, 'the saved kit map must not rewrite a keyboard part: ' + text);
  assert.deepEqual(page.exceptions, []);
});

test('control: the same keyboard with no saved map plays its own notes in Songs', async (t) => {
  const page = await openHotCrossBuns(t, null);
  const text = await playUpToPitches(page);
  assert.doesNotMatch(text, /Missed/, text);
});

// A one-hit kit part (a tom), imported as a teacher's challenge file, practised while the keyboard module is selected.
function tomChallenge() {
  return JSON.stringify({ schema: 'challenge/1', title: 'Tom test', songs: [{ schema: 'song/1', id: 'tom-song', title: 'Tom Song', composer: null, licence: null, source: null, key: null, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480, parts: [{ id: 'kit', name: 'Kit', role: 'percussion', notes: [{ start: 0, dur: 480, midi: 50, piece: 'tom-high' }] }], chords: [] }] });
}
async function openTomSong(t, savedMap) {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  if (savedMap) await page.evaluate(`window.__coach.db().prefs.kit = { midiMaps: { ${JSON.stringify(NAME)}: ${JSON.stringify(savedMap)} } }`);
  await connectFakeMidi(page, 'p1', NAME);
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-kitmap-'));
  const file = join(dir, 'challenge.json'); writeFileSync(file, tomChallenge());
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', file);
  await page.waitFor("Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes('Tom Song'))");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes('Tom Song')).click()");
  rmSync(dir, { recursive: true, force: true });
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  while (!(await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')"))) {
    await clickButtonNamed(page, 'Next'); await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  }
  await clickButtonNamed(page, 'Your turn');
  await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
  return page;
}
async function hitAndCheck(page, note) {
  await midiNoteOn(page, 'p1', note);
  await new Promise((r) => setTimeout(r, 300));
  await clickButtonNamed(page, 'Stop and check');
  await page.waitFor("document.querySelector('.panel-songs-practice h4') || document.querySelector('.panel-songs-practice p')");
  return practiceText(page);
}

test('a kit part in Songs still reads the saved map while the keyboard module is selected', async (t) => {
  const page = await openTomSong(t, { 60: 'tom-high' });
  const text = await hitAndCheck(page, 60);
  assert.match(text, /Which drum: Right/, 'the learned pad plays its drum: ' + text);
});

test('control: the same pad note with no saved map is not that drum', async (t) => {
  const page = await openTomSong(t, null);
  const text = await hitAndCheck(page, 60);
  assert.match(text, /Which drum: Not assessed/, 'an unmapped note is not named as a drum: ' + text);
});

test('the range walk reads raw keys, and its store is separate from the kit map of the same name', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate(`window.__coach.db().prefs.kit = { midiMaps: { ${JSON.stringify(NAME)}: { 48: 'kick', 72: 'crash' } } }`);
  await connectFakeMidi(page, 'p1', NAME);
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.evaluate("document.getElementById('midiRangeBtn').click()");
  await midiNoteOn(page, 'p1', 48); await midiNoteOn(page, 'p1', 72);
  assert.deepEqual(await page.evaluate('window.__coach.db().prefs.midiRange'), { [NAME]: { low: 48, high: 72 } });
  assert.equal(await page.evaluate('window.__coach.db().prefs.kit.midiMaps["USB MIDI"][48]'), 'kick');
});
