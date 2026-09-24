// P3-5: stopping, cancelling and leaving part-way through Add a song must
// never save a half-finished song. Companion to
// tests/characterization/songs-add-a-song.test.mjs (P3-4's happy path) --
// this proves the unhappy ones: a learner pressing Cancel mid-analysis
// (src/ui/songs.js's new panel-songs-cancel-btn), and a learner leaving
// Songs outright while a recording is still being turned into notes (mic or
// file), same real headless-browser precedent as every other characterization
// test here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

// Pure-Node WAV writer, same as tests/characterization/songs-add-a-song.test.mjs.
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

// About 20s of constantly-changing tones -- long enough that decoding and
// transcribing it is still genuinely in flight a couple of CDP round-trips
// after the file is dropped, which is the window Cancel/leaving needs to
// land inside for these tests to mean anything.
function longWav(path, seconds = 20) {
  const sr = 44100;
  const totalSamples = Math.round(seconds * sr);
  const pcm = new Float32Array(totalSamples);
  const freqFor = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const noteMidis = [60, 62, 64, 65, 67, 69, 71, 72];
  const noteSamples = Math.round(0.35 * sr);
  for (let i = 0; i < totalSamples; i++) {
    const f = freqFor(noteMidis[Math.floor(i / noteSamples) % noteMidis.length]);
    pcm[i] = 0.5 * Math.sin((2 * Math.PI * f * i) / sr);
  }
  return writeWav(path, pcm, sr);
}

async function openAddSongSection(page) {
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelector('.add-song-row')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.add-song-row button')).find(b => b.textContent.trim() === 'Add a song').click()",
  );
}

test('Cancel during analysis saves nothing', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-add-lifecycle-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wavPath = longWav(join(dir, 'long.wav'));

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await openAddSongSection(page);
  const rowsBefore = await page.evaluate("document.querySelectorAll('.panel-songs-row').length");

  await page.setFileInput('#songsFileInput', wavPath);
  await page.waitFor("!document.querySelector('.panel-songs-cancel-btn').hidden");
  await page.evaluate("document.querySelector('.panel-songs-cancel-btn').click()");

  await page.waitFor("document.querySelector('.panel-songs-msg').textContent === 'Stopped. Nothing was saved.'");
  assert.deepEqual(page.exceptions, [], 'Cancel during analysis must not throw');

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor(`document.querySelectorAll('.panel-songs-row').length === ${rowsBefore}`);
  const rowsAfter = await page.evaluate("document.querySelectorAll('.panel-songs-row').length");
  assert.equal(rowsAfter, rowsBefore, 'no song row was added after Cancel');
});

test('leaving Songs mid-analysis saves nothing and says so on return', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-add-lifecycle-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wavPath = longWav(join(dir, 'long.wav'));

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await openAddSongSection(page);
  const rowsBefore = await page.evaluate("document.querySelectorAll('.panel-songs-row').length");

  await page.setFileInput('#songsFileInput', wavPath);
  await page.evaluate("window.__coach.closePanel()");
  await page.evaluate("window.__coach.openPanel('songs')");

  await page.waitFor(
    "document.querySelector('.panel-songs-msg').textContent === 'Your last recording was stopped before it finished. Nothing was saved.'",
  );
  await page.waitFor(`document.querySelectorAll('.panel-songs-row').length === ${rowsBefore}`);
  assert.deepEqual(page.exceptions, [], 'leaving Songs mid-analysis must not throw');

  // Reopening once more (already open -- just re-shows) clears the message.
  await page.evaluate("window.__coach.openPanel('songs')");
  const message = await page.evaluate("document.querySelector('.panel-songs-msg').textContent");
  assert.equal(message, '', 'the leaving message shows once, then is cleared');
});

test('leaving Songs mid-recording turns the microphone off', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-add-lifecycle-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wavPath = threeToneWav(join(dir, 'mic-fake.wav'));

  const page = await launchPage(htmlPath, { fakeAudioFile: wavPath });
  t.after(() => page.close());

  await openAddSongSection(page);
  await page.evaluate("document.querySelector('.panel-songs-record-btn').click()");
  await page.waitFor("document.querySelector('.panel-songs-record-btn').textContent === 'Counting in…'");

  await page.evaluate("window.__coach.closePanel()");
  assert.deepEqual(page.exceptions, [], 'leaving Songs mid-recording must not throw');

  await openAddSongSection(page);
  await page.waitFor("!!document.querySelector('.panel-songs-record-btn')");
  const btnState = await page.evaluate(
    "(() => { var b = document.querySelector('.panel-songs-record-btn'); return { text: b.textContent, disabled: b.disabled }; })()",
  );
  assert.equal(btnState.text, 'Record', 'Record is idle again on return');
  assert.equal(btnState.disabled, false, 'Record is not left stuck disabled');
});

test('an analysis that finishes after leaving does not add a song', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-add-lifecycle-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wavPath = longWav(join(dir, 'long.wav'));

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await openAddSongSection(page);
  const rowsBefore = await page.evaluate("document.querySelectorAll('.panel-songs-row').length");

  await page.setFileInput('#songsFileInput', wavPath);
  await page.evaluate("window.__coach.closePanel()");
  // Longer than a 20s WAV's decode+transcribe takes, so the analysis has
  // genuinely finished in the background before Songs is reopened.
  await new Promise((r) => setTimeout(r, 6000));

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor(`document.querySelectorAll('.panel-songs-row').length === ${rowsBefore}`);
  const rowsAfter = await page.evaluate("document.querySelectorAll('.panel-songs-row').length");
  assert.equal(rowsAfter, rowsBefore, 'no song row was added by an analysis that finished after leaving');
  assert.deepEqual(page.exceptions, [], 'a stale analysis finishing after leaving must not throw');
});
