// A song's learning-event row (src/ui/songs.js advance()) records which
// route the notes judged in that attempt actually came from -- 'midi' only
// when every judged note in the attempt was a real MIDI note-on, so a later
// reader can trust "input: 'midi'" as evidence a real keyboard was used,
// never a guess from the mere presence of a Web MIDI API. Drives the real
// entry points: a fake Web MIDI port's note-on (tests/helpers/fake-midi.mjs)
// for the MIDI attempt, and a real `keydown` KeyboardEvent (the same
// technique tests/characterization/midi-entry.test.mjs's computer-key test
// uses) for the computer-key attempt -- neither goes through the debug hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort } from '../helpers/fake-midi.mjs';

const htmlPath = HTML_PATH;

// Same one-note challenge tests/characterization/songs-session-log.test.mjs
// uses: one phrase, one note at tick 0, so every judged step in the lesson
// expects this note at the very start of listening.
function challengeJson() {
  return JSON.stringify({
    schema: 'challenge/1',
    title: 'One Note',
    from: null,
    note: null,
    songs: [{
      schema: 'song/1', id: 'one-note-song', title: 'One Note Song', composer: null, licence: null, source: null,
      key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
      parts: [{ id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 1920, midi: 64 }] }],
      chords: []
    }]
  });
}

async function importAndOpenSong(page, challengePath) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', challengePath);
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes('One Note Song'))"
  );
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes('One Note Song')).click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
}

// Clicks "Next" past every listen-only step, then, on the first judged step,
// clicks "Your turn", waits for real listening to begin, and fires
// `sendNoteJs` (a page-side JS expression, e.g. a fake-MIDI send or a real
// keydown) in the SAME in-page turn that observed listening had started --
// same reasoning as tests/helpers/songs-note.mjs's playSongNoteWhenListening
// (no Node-side round trip to add lateness before the note lands).
async function judgeFirstStepWith(page, sendNoteJs) {
  for (let i = 0; i < 8; i++) {
    const hasNext = await page.evaluate(
      "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Next')"
    );
    if (!hasNext) break;
    await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()");
  }
  await page.evaluate(`(async () => {
    const turnBtn = Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn');
    if (turnBtn) turnBtn.click();
    while (!(document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far'))) {
      await new Promise(r => setTimeout(r, 4));
    }
    ${sendNoteJs}
  })()`);
  await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.includes('1')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4') || document.querySelector('.panel-songs-practice p')");
}

test('a keyboard song attempt played through real fake-MIDI note-ons logs input: "midi"', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-song-input-midi-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = join(dir, 'challenge.json');
  writeFileSync(challengePath, challengeJson());

  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await importAndOpenSong(page, challengePath);
  await midiAddPort(page, 'p1', 'Test Keys');
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true");

  const before = await page.evaluate('window.__coach.db().events.length');
  await judgeFirstStepWith(page, "window.__midiSend('p1', [0x90, 64, 100]);");
  await page.waitFor('window.__coach.db().events.length > ' + before);

  const events = await page.evaluate('window.__coach.db().events');
  const row = events[events.length - 1];
  assert.equal(row.source, 'song');
  assert.equal(row.input, 'midi');
  assert.deepEqual(page.exceptions, []);
});

test('the same attempt played through computer keys never logs input: "midi"', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-song-input-key-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = join(dir, 'challenge.json');
  writeFileSync(challengePath, challengeJson());

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await importAndOpenSong(page, challengePath);

  const before = await page.evaluate('window.__coach.db().events.length');
  // 'd' -> MIDI 64 (src/core/pckeys.js), the same note this song expects.
  await judgeFirstStepWith(page, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));");
  await page.waitFor('window.__coach.db().events.length > ' + before);

  const events = await page.evaluate('window.__coach.db().events');
  const row = events[events.length - 1];
  assert.equal(row.source, 'song');
  assert.equal(row.input, 'computer-key');
  assert.notEqual(row.input, 'midi');
  assert.deepEqual(page.exceptions, []);
});
