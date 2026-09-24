// "Learn this" panel (originally src/ui/learn.js, unit G1a: the file door
// only). P3-6 retired the separate panel -- these tests now drive the same
// record door and review screen through Songs' own "Add a song" section
// (window.__coach.openPanel('songs') then the Add a song button), same
// precedent as tests/characterization/songs-add-a-song.test.mjs. Drives the
// built dist/band-coach.html through the DOM, same pattern as
// tests/characterization/w-songs.test.mjs -- a real headless browser, a
// real file input, a real IndexedDB, a real AudioContext decoding a real
// WAV file on disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

// Pure-Node WAV writer: 16-bit PCM mono from a plain Float32Array (same
// precedent as tests/characterization/editor-audio-file.test.mjs and
// w-playalong.test.mjs -- no binary fixture committed to the repo).
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

// Three clean 0.35s tones at 44100Hz: C4, E4, G4 -- enough for a real note
// sequence, short enough to transcribe fast.
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

// A Q: tempo field is included so this imports with no warnings (an ABC
// file missing one still imports fine, but defaults its tempo and so warns
// -- see the practiceGate coverage below, which relies on that).
const ABC = 'X:1\nT:Learn Test\nM:4/4\nL:1/8\nQ:120\nK:C\nCDEFGABc|\n';

// P3-6: the separate Learn this panel is gone -- opens the same record door
// and review screen through Songs' own Add a song section instead (no
// shared import across test files by convention here, so this duplicates
// tests/characterization/songs-add-a-song.test.mjs's openAddSongSection).
async function openAddSongSection(page) {
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelector('.add-song-row')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.add-song-row button')).find(b => b.textContent.trim() === 'Add a song').click()",
  );
}

// P3-4: the Songs panel's Add-a-song row no longer points at this panel by
// name -- it opens its own record-or-open-file section built from the same
// record-door.js/review.js this panel uses (tests/characterization/
// songs-add-a-song.test.mjs covers it in full). Renamed from "...offers a
// 'Learn this' button".
test('Add a song offers a way to record or open a recording', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelector('.add-song-row')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.add-song-row button')).find(b => b.textContent.trim() === 'Add a song').click()",
  );
  await page.waitFor("!!document.querySelector('.panel-songs-record-btn')");
  const hasRecordBtn = await page.evaluate("!!document.querySelector('.panel-songs-record-btn')");
  const hasFileInput = await page.evaluate("!!document.getElementById('songsFileInput')");
  assert.equal(hasRecordBtn, true, 'a Record button is offered');
  assert.equal(hasFileInput, true, 'an Open file input is offered');
});

test('a real .abc file dropped in becomes a practisable song, title + Play it on cards + library entry', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-learn-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const abcPath = join(dir, 'tune.abc');
  writeFileSync(abcPath, ABC, 'utf8');

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  // P3-6: Learn this is retired -- the same file door now lives in Songs'
  // Add a song section (#songsFileInput, idPrefix 'songs').
  await openAddSongSection(page);
  await page.setFileInput('#songsFileInput', abcPath);
  await page.waitFor("document.querySelector('.panel-learn-result').hidden === false", 20000);

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions importing a notation file');
  const title = await page.evaluate("document.querySelector('.panel-learn-result h4').textContent");
  assert.equal(title, 'Learn Test');

  const cardCount = await page.evaluate("document.querySelectorAll('.panel-learn-result .panel-songs-instrument-card').length");
  assert.ok(cardCount > 0, 'at least one "Play it on…" instrument card is shown');

  // Practise this -> switches to the real Songs panel, already on this
  // song's lesson (requestOpenSong() + Songs's own show()-time check).
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-learn-practise-btn')).find(b => b.textContent === 'Practise this').click()"
  );
  await page.waitFor("window.__coach.panelOpen() === 'songs'");
  await page.waitFor("document.querySelector('.panel-songs-practice h3')");
  const practiceTitle = await page.evaluate("document.querySelector('.panel-songs-practice h3').textContent");
  assert.equal(practiceTitle, 'Learn Test', 'Songs opened straight onto this song\'s lesson');
});

test('a real .wav recording dropped in transcribes to a song with a positive note count', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-learn-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wavPath = threeToneWav(join(dir, 'three-notes.wav'));

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  // P3-6: Learn this is retired -- same file door, now in Songs' Add a song.
  await openAddSongSection(page);
  await page.setFileInput('#songsFileInput', wavPath);
  await page.waitFor("document.querySelector('.panel-learn-result').hidden === false", 20000);

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions decoding and transcribing a recording');
  const noteCount = await page.evaluate("document.querySelectorAll('.panel-learn-confidence-note').length");
  assert.ok(noteCount > 0, 'at least one note was transcribed from the recording: ' + noteCount);
});

test('an unsupported file shows a plain-words message naming what this panel accepts', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-learn-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const badPath = join(dir, 'notes.txt');
  writeFileSync(badPath, 'just some plain text, not a song or a recording', 'utf8');

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  // P3-6: Learn this is retired -- the same file door's status line is now
  // Songs' own importMsg (.panel-songs-msg), not .panel-learn-status.
  await openAddSongSection(page);
  await page.setFileInput('#songsFileInput', badPath);
  await page.waitFor("document.querySelector('.panel-songs-msg').textContent.length > 0", 20000);

  const message = await page.evaluate("document.querySelector('.panel-songs-msg').textContent");
  assert.match(message, /\.mid|\.abc|\.musicxml|\.wav|recording/i);
  assert.equal(await page.evaluate("document.querySelector('.panel-learn-result').hidden"), true, 'no result is shown for an unsupported file');
});

// ---- the mic door (unit G1b): Record -> a four-beat count-in -> capture ->
// Stop -> the SAME result view the file door above already proved. Drives
// the REAL getUserMedia() chain via Chromium's `--use-file-for-fake-audio-
// capture` (launchPage's `fakeAudioFile`), the same technique
// playalong-take-recorder.test.mjs and mic-channel-mono.test.mjs already use
// elsewhere in this suite -- not the window.__coach debug hook, so this
// proves the real capture path a learner's own mic would drive.

// A steady repeating three-tone loop, long enough (a little over 4s) that
// whatever few seconds the recorder happens to capture -- after the
// count-in has already spent time playing the fake file from its start --
// still contains real pitched audio to transcribe, however that lands.
function loopingThreeToneWav(path) {
  const sr = 44100;
  const noteSamples = Math.round(0.3 * sr);
  const freqFor = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const cycle = [60, 64, 67];
  const totalNotes = 16; // ~4.8s
  const pcm = new Float32Array(noteSamples * totalNotes);
  for (let n = 0; n < totalNotes; n++) {
    const f = freqFor(cycle[n % cycle.length]);
    for (let j = 0; j < noteSamples; j++) pcm[n * noteSamples + j] = 0.5 * Math.sin((2 * Math.PI * f * j) / sr);
  }
  return writeWav(path, pcm, sr);
}

test('Record counts in four beats, then Stop turns the mic capture into a practisable song', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-learn-mic-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wavPath = loopingThreeToneWav(join(dir, 'loop.wav'));

  const page = await launchPage(htmlPath, { fakeAudioFile: wavPath });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  // P3-6: Learn this is retired -- the mic door now lives in Songs' Add a
  // song section (idPrefix 'songs': songsBpm, .panel-songs-beat,
  // .panel-songs-record-btn; the shared review screen stays .panel-learn-*).
  await openAddSongSection(page);

  // A fast tempo (still inside the 40-200 range the field enforces) so the
  // count-in this test waits through is short, not because the app's own
  // default (90bpm) is wrong.
  await page.evaluate(
    "(() => { const b = document.getElementById('songsBpm'); b.value = '200'; b.dispatchEvent(new Event('input', { bubbles: true })); })()"
  );
  await page.evaluate("document.querySelector('.panel-songs-record-btn').click()");

  await page.waitFor("document.querySelector('.panel-songs-beat').textContent === '4'", 15000);
  await page.waitFor("document.querySelector('.panel-songs-record-btn').textContent === 'Stop'", 10000);

  // Let a couple of real seconds of the fake mic stream actually get
  // captured before stopping.
  await new Promise((r) => setTimeout(r, 2000));

  await page.evaluate("document.querySelector('.panel-songs-record-btn').click()");
  await page.waitFor("document.querySelector('.panel-learn-result').hidden === false", 20000);

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions counting in and capturing from the mic');
  const noteCount = await page.evaluate("document.querySelectorAll('.panel-learn-confidence-note').length");
  assert.ok(noteCount > 0, 'at least one note was transcribed from the mic capture: ' + noteCount);

  const buttonText = await page.evaluate("document.querySelector('.panel-songs-record-btn').textContent");
  assert.equal(buttonText, 'Record', 'the Record button resets once a take has been analysed');
});

test('a blocked or missing microphone says so in plain words, with no crash', async (t) => {
  const DENY_MIC_INIT = "navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied by the user or the system.', 'NotAllowedError'));";
  const page = await launchPage(htmlPath, { initScript: DENY_MIC_INIT });
  t.after(() => page.close());

  // P3-6: Learn this is retired -- same mic door, now Songs' Add a song
  // section; the status line is Songs' own importMsg (.panel-songs-msg).
  await openAddSongSection(page);
  await page.evaluate("document.querySelector('.panel-songs-record-btn').click()");
  await page.waitFor("document.querySelector('.panel-songs-msg').textContent.indexOf('not available') >= 0", 15000);

  assert.deepEqual(page.exceptions, [], 'a denied microphone must not throw an uncaught exception');
  const message = await page.evaluate("document.querySelector('.panel-songs-msg').textContent");
  assert.match(message, /microphone is not available/i);
  assert.match(message, /drop a recording instead/i);
  const buttonText = await page.evaluate("document.querySelector('.panel-songs-record-btn').textContent");
  assert.equal(buttonText, 'Record', 'the Record button is not left stuck disabled after a denial');
});
