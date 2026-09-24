// P3-4: Songs gets one "Add a song" button (Record or Open file, then
// Review) instead of the three-panel Add-a-song row -- folding "Learn this"'s
// record door and review screen (src/ui/songs/record-door.js,
// src/ui/songs/review.js, both P3-2/P3-3 moves out of src/ui/learn.js)
// straight into src/ui/songs.js so adding a song never leaves the Songs
// panel. Drives the built dist/band-coach.html through a real headless
// browser, a real file input and a real IndexedDB, same pattern as
// tests/characterization/learn-this.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

// Pure-Node WAV writer: 16-bit PCM mono from a plain Float32Array (same
// precedent as tests/characterization/learn-this.test.mjs).
function writeWav(path, pcm, sampleRate) {
  const dataSize = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < pcm.length; i++) {
    const clamped = Math.max(-1, Math.min(1, pcm[i]));
    buf.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  writeFileSync(path, buf);
  return path;
}

// Three clean 0.35s tones at 44100Hz: C4, E4, G4 -- same precedent as
// tests/characterization/learn-this.test.mjs's threeToneWav.
function threeToneWav(path) {
  const sr = 44100;
  const noteSamples = Math.round(0.35 * sr);
  const pcm = new Float32Array(noteSamples * 3);
  const freqFor = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  [60, 64, 67].forEach((midi, i) => {
    const f = freqFor(midi);
    for (let j = 0; j < noteSamples; j++) pcm[i * noteSamples + j] = 0.5 * Math.sin((2 * Math.PI * f * j) / sr);
  });
  return writeWav(path, pcm, sr);
}

// A Q: tempo field is included so this imports with no warnings -- see
// learn-this.test.mjs's own ABC constant, same reasoning.
const ABC = 'X:1\nT:Add A Song Test\nM:4/4\nL:1/8\nQ:120\nK:C\nCDEFGABc|\n';

async function openAddSongSection(page) {
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelector('.add-song-row')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.add-song-row button')).find(b => b.textContent.trim() === 'Add a song').click()",
  );
}

test('Songs shows one Add a song button, and pressing it reveals Record and Open file', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelector('.add-song-row')");

  const labels = await page.evaluate(
    "Array.from(document.querySelectorAll('.add-song-row button')).map(b => b.textContent.trim())",
  );
  assert.deepEqual(labels, ['Add a song']);

  const isFirstChild = await page.evaluate("document.querySelector('.add-song-row').previousElementSibling === null");
  assert.equal(isFirstChild, true, 'the Add-a-song row is the first thing inside the Songs panel');

  await page.evaluate(
    "Array.from(document.querySelectorAll('.add-song-row button')).find(b => b.textContent.trim() === 'Add a song').click()",
  );
  await page.waitFor("!!document.querySelector('.panel-songs-record-btn')");

  assert.equal(await page.evaluate("!!document.getElementById('songsFileInput')"), true, 'Open file is offered');
  assert.equal(
    await page.evaluate("document.querySelector('.panel-songs-record-btn').textContent"),
    'Record',
    'Record is offered',
  );
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'songs', 'Songs stays open');
  assert.equal(
    await page.evaluate("document.querySelector('#mainNav button[data-route=\"songs\"]').getAttribute('aria-current')"),
    'page',
    'Songs stays the current nav destination -- the row no longer opens another panel',
  );
});

test('a recording opened from Add a song is reviewed inside Songs', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-add-song-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wavPath = threeToneWav(join(dir, 'three-notes.wav'));

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await openAddSongSection(page);
  await page.setFileInput('#songsFileInput', wavPath);
  await page.waitFor("document.querySelector('.panel-learn-result').hidden === false", 20000);

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions decoding and transcribing a recording from Add a song');
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'songs', 'the review happens without leaving Songs');
  const noteCount = await page.evaluate("document.querySelectorAll('.panel-learn-confidence-note').length");
  assert.ok(noteCount > 0, 'at least one note was transcribed: ' + noteCount);
});

test('a score opened from Add a song is reviewed, and Practise this starts the lesson', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-add-song-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const abcPath = join(dir, 'tune.abc');
  writeFileSync(abcPath, ABC, 'utf8');

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await openAddSongSection(page);
  await page.setFileInput('#songsFileInput', abcPath);
  await page.waitFor("document.querySelector('.panel-learn-result').hidden === false", 20000);

  const title = await page.evaluate("document.querySelector('.panel-learn-result h4').textContent");
  assert.equal(title, 'Add A Song Test');

  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-learn-practise-btn')).find(b => b.textContent === 'Practise this').click()",
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h3')");

  const practiceTitle = await page.evaluate("document.querySelector('.panel-songs-practice h3').textContent");
  assert.equal(practiceTitle, title, 'Practise this opens the same song\'s lesson');
});

test('an unsupported file names what Add a song accepts', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-add-song-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const badPath = join(dir, 'notes.txt');
  writeFileSync(badPath, 'just some plain text, not a song or a recording', 'utf8');

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await openAddSongSection(page);
  await page.setFileInput('#songsFileInput', badPath);
  await page.waitFor("document.querySelector('.panel-songs-msg').textContent.length > 0", 20000);

  const message = await page.evaluate("document.querySelector('.panel-songs-msg').textContent");
  assert.match(message, /recording/i);
  assert.match(message, /\.mid/i);
});

test('a blocked microphone says so in plain words and Record is not stuck', async (t) => {
  const DENY_MIC_INIT = "navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied by the user or the system.', 'NotAllowedError'));";
  const page = await launchPage(htmlPath, { initScript: DENY_MIC_INIT });
  t.after(() => page.close());

  await openAddSongSection(page);
  await page.waitFor("!!document.querySelector('.panel-songs-record-btn')");
  await page.evaluate("document.querySelector('.panel-songs-record-btn').click()");
  await page.waitFor("document.querySelector('.panel-songs-msg').textContent.indexOf('not available') >= 0", 15000);

  assert.deepEqual(page.exceptions, [], 'a denied microphone must not throw an uncaught exception');
  const message = await page.evaluate("document.querySelector('.panel-songs-msg').textContent");
  assert.match(message, /microphone is not available/i);
  const buttonText = await page.evaluate("document.querySelector('.panel-songs-record-btn').textContent");
  assert.equal(buttonText, 'Record', 'the Record button is not left stuck after a denial');
});

test('a saved draft is listed with its status', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-add-song-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wavPath = threeToneWav(join(dir, 'three-notes.wav'));

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await openAddSongSection(page);
  await page.setFileInput('#songsFileInput', wavPath);
  await page.waitFor("document.querySelector('.panel-learn-result').hidden === false", 20000);
  await page.evaluate("window.__coach.openPanel('songs')");
  // The built-in songs already make rows, so wait for the imported one:
  // refreshList() lands after the review renders, not before.
  await page.waitFor("Array.from(document.querySelectorAll('.panel-songs-row')).some(r => r.textContent.indexOf('Draft') >= 0)");

  const row = await page.evaluate(
    "(() => { var rows = Array.from(document.querySelectorAll('.panel-songs-row')); var r = rows.find(x => x.textContent.indexOf('Draft') >= 0); if (!r) return null; return { titleBtnText: r.querySelector('button').textContent, hasStatusOutsideBtn: !!r.querySelector('.panel-songs-status') }; })()",
  );
  assert.ok(row, 'a row shows a Draft status after the import');
  assert.equal(row.titleBtnText.indexOf('Draft'), -1, 'the status text is not inside the title button');
  assert.equal(row.hasStatusOutsideBtn, true, 'the status sits in its own element outside the title button');
});
