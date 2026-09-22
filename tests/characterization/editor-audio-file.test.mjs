// "Record a tune" panel (src/ui/editor.js): choosing an audio file instead
// of using the microphone. Drives the built page exactly as a learner would
// — a real file picked via the OS file dialog (simulated with CDP's
// DOM.setFileInputFiles — see tests/helpers/browser.mjs's setFileInput) —
// through the same transcribe() -> loadTranscription() path Listen/Stop
// uses, landing in the same mandatory "check these" step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

// Pure-Node WAV writer: 16-bit PCM mono from a plain Float32Array, no binary
// fixture committed to the repo (same precedent as w-playalong.test.mjs).
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

// Two clean 0.4s tones at 44100Hz: C4 (midi 60) then E4 (midi 64).
function twoToneWav(path) {
  const sr = 44100;
  const noteSamples = Math.round(0.4 * sr);
  const pcm = new Float32Array(noteSamples * 2);
  const freqFor = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const f1 = freqFor(60);
  const f2 = freqFor(64);
  for (let i = 0; i < noteSamples; i++) pcm[i] = 0.5 * Math.sin((2 * Math.PI * f1 * i) / sr);
  for (let i = 0; i < noteSamples; i++) pcm[noteSamples + i] = 0.5 * Math.sin((2 * Math.PI * f2 * i) / sr);
  return writeWav(path, pcm, sr);
}

async function openEditor(page) {
  await page.evaluate("window.__coach.openPanel('editor')");
  await page.waitFor("window.__coach.panelOpen() === 'editor'");
}

test('choosing an audio file transcribes it through the same check-list path as the mic', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-editor-file-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wavPath = twoToneWav(join(dir, 'two-notes.wav'));

  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openEditor(page);

  assert.equal(await page.evaluate("!!document.getElementById('editorFileInput')"), true, 'a file input is offered alongside Listen');

  await page.setFileInput('#editorFileInput', wavPath);
  await page.waitFor("document.getElementById('editorCheck').hidden === false", 20000);

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions while decoding and transcribing a file');
  const notes = await page.evaluate('window.__coach.editorSong().parts[0].notes.map(n => Math.round(n.midi))');
  assert.equal(notes[0], 60, 'first note is C4');
  assert.equal(notes[notes.length - 1], 64, 'last note is E4');
});

test('an unreadable file shows a plain-words message instead of a dead end', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-editor-file-bad-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const badPath = join(dir, 'not-audio.wav');
  writeFileSync(badPath, Buffer.from('this is not an audio file, just plain text bytes'));

  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openEditor(page);

  await page.setFileInput('#editorFileInput', badPath);
  await page.waitFor("document.querySelector('.editor-say').textContent.length > 0", 20000);

  const message = await page.evaluate("document.querySelector('.editor-say').textContent");
  assert.match(message, /could not/i);
});
