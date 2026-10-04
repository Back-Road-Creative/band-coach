// A song whose every note is unplayable on the chosen instrument (Mary Had a
// Little Lamb on the drum kit) has a zero-step lesson plan. It must say so
// plainly -- never "Nicely done. You have played through the whole piece." and
// never a passed mark the learner did not earn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

test('a card whose notes all skip does not claim the piece was played or mark it passed', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Mary Had a Little Lamb').click()");
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-instrument-btn')).find(b => b.textContent.startsWith('Drum kit')).click()");
  await page.waitFor("document.querySelector('.panel-songs-practice')");
  const text = await page.evaluate("document.querySelector('.panel-songs-practice').textContent");
  assert.doesNotMatch(text, /Nicely done/, 'no false success screen');
  assert.match(text, /cannot be played|can't be played|none of/i, 'says why nothing can be practised');
  assert.match(text, /Back to songs/, 'still offers a way out');
  // The message points at "Play it on…", so those cards must actually be on this screen.
  const cards = await page.evaluate("document.querySelectorAll('.panel-songs-practice .panel-songs-instrument-btn').length");
  assert.ok(cards > 0, 'the Play it on cards are drawn on the empty-lesson screen');
  // Real store: api.store('songs-progress') lives in DB.panels, keyed by song id.
  const passed = await page.evaluate("JSON.stringify((window.__coach.db().panels || {})['songs-progress'] || {})");
  assert.deepEqual(JSON.parse(passed), {}, 'song not marked passed in the progress store');
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Back to songs').click()");
  const rows = await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-row button')).map(b => b.textContent).join('|')");
  assert.match(rows, /Mary Had a Little Lamb(\||$)/, 'Mary row present and has no (passed) suffix');
  assert.doesNotMatch(rows, /\(passed\)/, 'no song shows a passed mark');
});

// One bar of kick/snare as a challenge file: a percussion part, no instrument named.
const KIT_CHALLENGE = JSON.stringify({
  schema: 'challenge/1', title: 'Kit test',
  songs: [{
    schema: 'song/1', id: 'kit-song', title: 'Kit Song', composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
    parts: [{ id: 'kit', name: 'Kit', role: 'percussion', notes: [
      { start: 0, dur: 480, midi: 36, piece: 'kick' }, { start: 480, dur: 480, midi: 38, piece: 'snare' },
    ] }],
    chords: [],
  }],
});

test('a percussion part opens on the drum kit even when a pitched instrument is selected', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-kit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = join(dir, 'challenge.json');
  writeFileSync(challengePath, KIT_CHALLENGE);
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', challengePath);
  await page.waitFor("Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes('Kit Song'))");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes('Kit Song')).click()");
  await page.waitFor('document.querySelector(\'.panel-songs-view[data-view="kit"] canvas\')');
  const text = await page.evaluate("document.querySelector('.panel-songs-practice').textContent");
  assert.doesNotMatch(text, /Nicely done|None of this part/, 'a real lesson, not an empty or finished one');
});

// SMF format 0, channel 10: kick at 0 and snare at 480 (both oscillator drum voices).
function drumMidi(path) {
  const trk = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, 0x00, 0x99, 36, 100, 0x3c, 0x89, 36, 0, 0x83, 0x60, 0x99, 38, 100, 0x3c, 0x89, 38, 0, 0x00, 0xff, 0x2f, 0x00];
  const len = trk.length;
  writeFileSync(path, Buffer.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0, 0x4d, 0x54, 0x72, 0x6b, 0, 0, (len >> 8) & 255, len & 255, ...trk]));
}

test('Play notes on a drum MIDI sounds drum hits, not pitched tones', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-kit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const midPath = join(dir, 'drums.mid');
  drumMidi(midPath);
  // Drum kick/snare use an oscillator; a pitched tone is a buffer source and never makes one.
  const init = "window.__osc = 0; const co = AudioContext.prototype.createOscillator; AudioContext.prototype.createOscillator = function (...a) { window.__osc++; return co.apply(this, a); };";
  const page = await launchPage(HTML_PATH, { initScript: init });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.clickSelector('#cv'); // wakes the AudioContext (Play notes is silent before it exists)
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelector('.add-song-row')");
  await page.evaluate("Array.from(document.querySelectorAll('.add-song-row button')).find(b => b.textContent.trim() === 'Add a song').click()");
  await page.setFileInput('#songsFileInput', midPath);
  await page.waitFor("document.querySelector('.panel-learn-result').hidden === false", 20000);
  const before = await page.evaluate('window.__osc');
  await page.evaluate("document.querySelector('.panel-learn-play-notes-btn').click()");
  await page.waitFor('window.__osc > ' + before, 5000);
});
