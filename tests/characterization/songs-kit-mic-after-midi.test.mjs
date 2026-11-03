// Back-Road-Creative/band-coach#630: the trainer stops counting the microphone
// after a real MIDI hit on a drum kit (kitMidiHit in src/app.js), because the
// mic only hears the e-kit's speaker/pads again. Songs' listenDrumKit must
// follow the same rule: otherwise each echo is an extra and fails the step.
// Real entry points: the Connect button, a fake MIDI port (__midiSend), and
// the "Notes heard so far" line a learner reads. The mic side is a real hit
// through the analyser chain (testDrumHit); computer keys go through the
// same forwardNote() path onNote() uses, tagged 'computer-key'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort, midiRemovePort, midiNoteOn } from '../helpers/fake-midi.mjs';

const song = JSON.stringify({
  schema: 'challenge/1', title: 'Kit mic test',
  songs: [{
    schema: 'song/1', id: 'kit-mic', title: 'Kit Mic Song', composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
    parts: [{ id: 'kit', name: 'Kit', role: 'percussion', notes: [0, 480, 960, 1440].map((s, i) => ({ start: s, dur: 480, midi: i % 2 ? 38 : 36, piece: i % 2 ? 'snare' : 'kick' })) }],
    chords: [],
  }],
});
const btns = (sel, text) => `Array.from(document.querySelectorAll('${sel} button')).find(b => b.textContent === ${JSON.stringify(text)})`;

async function open(t, { connect = true } = {}) {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('drum-kit')");
  if (connect) {
    await midiAddPort(page, 'k1', 'Test Kit');
    await page.evaluate("document.getElementById('ioBtn').click()");
    await page.waitFor("/Test Kit found/.test(document.getElementById('ioText').textContent)");
  }
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-kitmic-'));
  const file = join(dir, 'challenge.json');
  writeFileSync(file, song);
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', file);
  await page.waitFor("Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes('Kit Mic Song'))");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes('Kit Mic Song')).click()");
  rmSync(dir, { recursive: true, force: true });
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  while (!(await page.evaluate(`!!(${btns('.panel-songs-practice', 'Your turn')})`))) {
    await page.evaluate(`${btns('.panel-songs-practice', 'Next')}.click()`);
    await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  }
  await page.evaluate(`${btns('.panel-songs-practice', 'Your turn')}.click()`);
  await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
  return page;
}
const count = async (page) => Number((await page.evaluate("document.querySelector('.panel-songs-count').textContent")).match(/(\d+)\s*$/)[1]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Three mic hits spaced apart so none merges into the next.
const micHits = async (page) => { await page.evaluate("window.__coach.testDrumHit([{kind:'kick',atMs:0},{kind:'hihat',atMs:350},{kind:'kick',atMs:700}])"); await sleep(1600); };

test('after a real MIDI hit, mic hits are not counted: heard equals MIDI sent', async (t) => {
  const page = await open(t);
  await midiNoteOn(page, 'k1', 36);
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.endsWith('1')");
  await micHits(page);
  await midiNoteOn(page, 'k1', 38);
  await sleep(200);
  assert.equal(await count(page), 2);
  assert.deepEqual(page.exceptions, []);
});

test('control: with no MIDI hit, mic hits still count', async (t) => {
  const page = await open(t);
  await micHits(page);
  assert.ok((await count(page)) >= 2, 'the mic heard the kit');
});

test('unplugging the only port hands counting back to the mic', async (t) => {
  const page = await open(t);
  await midiNoteOn(page, 'k1', 36);
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.endsWith('1')");
  await midiRemovePort(page, 'k1');
  await page.waitFor("!/Test Kit/.test(document.getElementById('ioText').textContent)");
  await micHits(page);
  assert.ok((await count(page)) >= 3, 'the mic counted again after the unplug');
});

test('a computer-key hit does not turn the mic off', async (t) => {
  const page = await open(t, { connect: false });
  await page.evaluate("window.__coach.songsNote(36, true, undefined, 'computer-key')");
  await micHits(page);
  assert.ok((await count(page)) >= 3, 'the mic still counted after a key hit');
});

// A new attempt is a new listen, but the e-kit is still the same e-kit: the
// rule must outlive one listen (the trainer's kitMidiHit does), or any mic
// noise before the first hit of the retry becomes an extra.
async function retry(page) {
  await page.evaluate(`${btns('.panel-songs-practice', 'Stop and check')}.click()`);
  await page.waitFor(`!!(${btns('.panel-songs-practice', 'Practice again')} || ${btns('.panel-songs-practice', 'Your turn')})`);
  await page.evaluate(`(${btns('.panel-songs-practice', 'Practice again')} || ${btns('.panel-songs-practice', 'Your turn')}).click()`);
  await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
}

test('a new attempt after a real MIDI hit still keeps the mic off', async (t) => {
  const page = await open(t);
  await midiNoteOn(page, 'k1', 36);
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.endsWith('1')");
  await retry(page);
  await micHits(page);
  assert.equal(await count(page), 0);
});

test('a new attempt after the e-kit is unplugged counts the mic again', async (t) => {
  const page = await open(t);
  await midiNoteOn(page, 'k1', 36);
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.endsWith('1')");
  await midiRemovePort(page, 'k1');
  await page.waitFor("!/Test Kit/.test(document.getElementById('ioText').textContent)");
  await retry(page);
  await micHits(page);
  assert.ok((await count(page)) >= 2, 'the mic counted in the new attempt');
});
