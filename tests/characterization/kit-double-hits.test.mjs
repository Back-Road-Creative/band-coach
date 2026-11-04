// One strike on a real kit can send the note twice or send a soft snare note beside a hi-hat
// (tests/fixtures/midi/kit-reading-usb-midi.json), or soft snare and tom notes beside a full-force kick
// (tests/fixtures/midi/kit-reading-kick-usb-midi.json). These play those messages through a fake port on each screen a drummer
// uses, each with a single-hit control. The message times are given, so a slow box cannot widen a gap past the window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort } from '../helpers/fake-midi.mjs';
import { TRAINER_LEVELS } from '../../src/instruments/drum-kit.js';
import { starterById } from '../../src/song/starter/index.js';
import { buildLessonPlan } from '../../src/song/lesson.js';
import { byId } from '../../src/instruments/index.js';
import { skipDemo } from '../helpers/songs-demo.mjs';

const KICK = 36, SNARE = 38, HAT = 42;
const SINGLE = note => [[note, 100, 0]];
const REPEATED = note => [[note, 110, 0], [note, 45, 30]];
const HARD = note => [[note, 127, 0], [note, 127, 20], [note, 32, 79]];
const BLEEDING = note => [[note, 121, 0], [SNARE, 39, 5]];
const KICK_CROSSTALK = note => [[note, 127, 0], [SNARE, 26, 12], [45, 38, 18]];

async function connected(t, mod) {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await page.evaluate(`window.__coach.setMod('${mod}')`);
  await midiAddPort(page, 'kit', 'Test E-kit');
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  return page;
}

// Sends a strike's messages at one moment of the app's clock, each carrying its own time stamp.
const strikeScript = (strike, status = 0x99) => `(function () { const base = performance.now(); ${JSON.stringify(strike)}.forEach(function (m) { window.__midiSend('kit', [${status}, m[0], m[1]], base + m[2]); window.__midiSend('kit', [${status - 0x10}, m[0], 0], base + m[2]); }); })()`;

// Plays one trainer bar, one strike per written hit, and returns what the judge said.
async function trainerBar(t, level, tick, strikeFor) {
  const page = await connected(t, 'drum-kit');
  await page.evaluate(`window.__coach.state().level = ${level}; window.__coach.state().tick = ${tick}; window.__coach.db().latencyMs = 0`);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.bar() && window.__coach.bar().onsets && window.__coach.bar().onsets.length > 0');
  const onsets = await page.evaluate('window.__coach.bar().onsets');
  for (const o of onsets) {
    await page.waitFor(`window.__coach.audioNow() >= ${o.t}`, 20000);
    await page.evaluate(strikeScript(strikeFor(o)));
  }
  await page.waitFor('window.__coach.bar().judged', 20000);
  const r = await page.evaluate("({ failed: window.__coach.task().els[0].failed, say: document.getElementById('feedback').textContent, midi: window.__coach.midi() })");
  assert.deepEqual(page.exceptions, []);
  return r;
}
const PIECE_NOTE = { kick: KICK, snare: SNARE, 'hihat-closed': HAT };
const allNotes = (shape) => o => o.pieces.flatMap(p => shape(PIECE_NOTE[p]));

// Level 1: tick 0 is the kick bar, tick 1 the snare bar, tick 2 the closed hi-hat bar.
test('trainer: a single hit on each written note is a clean bar (control)', async t => {
  const r = await trainerBar(t, 1, 1, allNotes(SINGLE));
  assert.equal(r.failed, false, r.say);
  assert.equal(r.midi.doubled, 0);
});
test('trainer: a hit the kit repeats softer is one hit, not "4 extra hits"', async t => {
  const r = await trainerBar(t, 1, 1, allNotes(REPEATED));
  assert.equal(r.failed, false, r.say);
  assert.equal(r.midi.doubled, 4);
});
test('trainer: a hard hit sent three times is one hit', async t => {
  const r = await trainerBar(t, 1, 1, allNotes(HARD));
  assert.equal(r.failed, false, r.say);
});
test('trainer: a hi-hat hit bleeding a soft snare note is one hit', async t => {
  const r = await trainerBar(t, 1, 2, allNotes(BLEEDING));
  assert.equal(r.failed, false, r.say);
  assert.equal(r.midi.doubled, 4);
});
test('trainer: a full-force kick that also sends snare and tom notes is one hit', async t => {
  const r = await trainerBar(t, 1, 0, allNotes(KICK_CROSSTALK));
  assert.equal(r.failed, false, r.say);
  assert.equal(r.midi.doubled, 8);
});
test('trainer: two drums written together both count, with the hat first', async t => {
  const tick = TRAINER_LEVELS[1].bars.findIndex(b => b.hits.some(h => h.pieces.includes('hihat-closed') && h.pieces.includes('snare')));
  assert.ok(tick >= 0);
  const r = await trainerBar(t, 2, tick, o => o.pieces.slice().sort((a, b) => (a === 'hihat-closed' ? -1 : b === 'hihat-closed' ? 1 : 0)).map((p, i) => [PIECE_NOTE[p], 110, i * 3]));
  assert.equal(r.failed, false, r.say);
  assert.equal(r.midi.doubled, 0);
});
test('trainer: a flam, soft then loud, is still two hits and passes', async t => {
  const tick = TRAINER_LEVELS[5].bars.findIndex(b => b.hits.every(h => h.flam));
  assert.ok(tick >= 0);
  const r = await trainerBar(t, 6, tick, () => [[SNARE, 40, 0], [SNARE, 105, 20]]);
  assert.equal(r.midi.doubled, 0);
  assert.equal(r.failed, false, r.say);
});

const song = starterById('groove-rock');
const orderStep = buildLessonPlan(song, 'kit', byId['drum-kit']).steps.find(s => s.kind === 'drum-order');
const BTN = (label) => `Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === ${JSON.stringify(label)})`;
const TITLE = "document.querySelector('.panel-songs-practice h4').textContent";

async function songsOrderStep(t, shape) {
  const page = await connected(t, 'drum-kit');
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-list .panel-songs-row button').length > 0");
  await page.evaluate(`Array.from(document.querySelectorAll('.panel-songs-row > button')).find(b => b.textContent === ${JSON.stringify(song.title)}).click()`);
  await page.waitFor(`!!${BTN('Next')}`);
  await page.evaluate(`${BTN('Next')}.click()`);
  await skipDemo(page);
  await page.waitFor(`!!${BTN('Your turn')}`);
  const before = await page.evaluate(TITLE);
  assert.ok(before.startsWith('Play the drums in order'));
  await page.evaluate(`${BTN('Your turn')}.click()`);
  await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')", 8000);
  for (const n of orderStep.notes) await page.evaluate(strikeScript(shape(n.midi)));
  await page.waitFor(`!!${BTN('Stop and check')}`);
  await page.evaluate(`${BTN('Stop and check')}.click()`);
  await page.waitFor(`${TITLE} !== ${JSON.stringify(before)}`, 8000);
  await skipDemo(page);
  assert.ok(!(await page.evaluate(TITLE)).startsWith('Play the drums in order'), 'moved on');
  assert.deepEqual(page.exceptions, []);
}
test('Songs kit drum-order step: single hits pass (control)', t => songsOrderStep(t, SINGLE));
test('Songs kit drum-order step: repeated hits pass, not "extra notes"', t => songsOrderStep(t, REPEATED));

// The Rhythm screen is not a kit screen, so a drum kit is told apart there by the drum channel.
async function rhythmTaps(t, strike, status) {
  const page = await connected(t, 'rhy');
  await page.evaluate('window.__coach.state().level = 1');
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.bar() && window.__coach.bar().onsets.length > 0');
  await page.waitFor('window.__coach.audioNow() >= window.__coach.bar().playAt', 20000);
  await page.evaluate(strikeScript(strike, status));
  return page.evaluate('window.__coach.bar().taps.length');
}
test('Rhythm bar: a drum kit\'s single hit is one tap (control)', async t => assert.equal(await rhythmTaps(t, SINGLE(SNARE), 0x99), 1));
test('Rhythm bar: a drum kit\'s repeated hit is one tap, not an extra tap', async t => assert.equal(await rhythmTaps(t, REPEATED(SNARE), 0x99), 1));
test('Rhythm bar: a keyboard is not guarded, so a fast soft repeat stays two taps', async t => assert.equal(await rhythmTaps(t, REPEATED(60), 0x90), 2));

test('a keyboard on a keyboard screen keeps every fast repeat', async t => {
  const page = await connected(t, 'kbd');
  await page.evaluate(strikeScript(REPEATED(60), 0x90));
  assert.equal(await page.evaluate('window.__coach.midi().doubled'), 0);
});

test('note-offs pass through: on, on, off, off is one hit and leaves nothing held', async t => {
  const page = await connected(t, 'drum-kit');
  await page.evaluate("(function () { const b = performance.now(); window.__midiSend('kit', [0x99, 38, 110], b); window.__midiSend('kit', [0x99, 38, 40], b + 20); })()");
  assert.deepEqual((await page.evaluate('window.__coach.midi()')).held, [38]);
  await page.evaluate("(function () { const b = performance.now(); window.__midiSend('kit', [0x89, 38, 0], b); window.__midiSend('kit', [0x89, 38, 0], b + 1); })()");
  const m = await page.evaluate('window.__coach.midi()');
  assert.deepEqual(m.held, []);
  assert.equal(m.doubled, 1);
});

test('MIDI details shows the ignored count beside the raw bytes it ignored', async t => {
  const page = await connected(t, 'drum-kit');
  await page.evaluate("document.getElementById('midiDetailsBtn').click()");
  const text = "document.getElementById('midiDetailsText').textContent";
  assert.doesNotMatch(await page.evaluate(text), /Double hits ignored/);
  await page.evaluate(strikeScript(REPEATED(SNARE)));
  const shown = await page.evaluate(text);
  assert.match(shown, /Double hits ignored: 1/);
  assert.match(shown, /99 26 2d/, 'the dropped note is still in the raw list');
});

// Every pad in turn, with the messages the real kit sent: the walk-through lands one piece per pad.
test('walk-through: a kick that also sends snare and tom notes learns the kick, and the snare is still asked for', async t => {
  const page = await connected(t, 'drum-kit');
  await page.evaluate("document.getElementById('setupBtn').click()");
  await page.evaluate("document.getElementById('kitLearn').click()");
  await page.evaluate(strikeScript(KICK_CROSSTALK(36)));
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(strikeScript(SINGLE(SNARE)));
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(await page.evaluate("window.__coach.db().prefs.kit.midiMaps['Test E-kit']"), { 36: 'kick', 38: 'snare' });
  assert.deepEqual(page.exceptions, []);
});

test('walk-through: repeated and bleeding pads each learn one piece and never skip the next', async t => {
  const page = await connected(t, 'drum-kit');
  await page.evaluate("document.getElementById('setupBtn').click()");
  await page.evaluate("document.getElementById('kitLearn').click()");
  const pads = [HARD(36), REPEATED(SNARE), BLEEDING(HAT), SINGLE(44), BLEEDING(46), REPEATED(43), REPEATED(45), REPEATED(48), REPEATED(49), SINGLE(51)];
  for (const strike of pads) {
    await page.evaluate(strikeScript(strike));
    await new Promise(r => setTimeout(r, 300));
  }
  assert.deepEqual(await page.evaluate("window.__coach.db().prefs.kit.midiMaps['Test E-kit']"), { 36: 'kick', 38: 'snare', 42: 'hihat-closed', 44: 'hihat-pedal', 46: 'hihat-open', 43: 'tom-floor', 45: 'tom-mid', 48: 'tom-high', 49: 'crash', 51: 'ride' });
  assert.deepEqual(page.exceptions, []);
});
