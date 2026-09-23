// "Learn this" as the one door in (plan §11.5.7, unit G1c): its result view
// hands a learned tune to the older, fuller panels rather than duplicating
// their features -- "Fix it up" opens the note-editing "Record a tune"
// panel (src/ui/editor.js) with the learned song already loaded
// (requestOpenInEditor()/checkOpenRequest(), mirroring src/ui/songs.js's own
// requestOpenSong() precedent), and "Play along with this recording" opens
// Play Along (src/ui/playalong.js) with the SAME decoded audio already
// analysed (requestPlayalongRecording(), an in-memory handoff -- audio is
// far too big for api.store's 256KB panel-data budget). Drives the built
// dist/band-coach.html through real DOM, same pattern as
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

// Three clean 0.35s tones at 44100Hz: C4, E4, G4.
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

const ABC = 'X:1\nT:Handoff Test\nM:4/4\nL:1/8\nK:C\nCDEFGABc|\n';

test('"Fix it up" opens the editor panel with the learned song loaded for editing', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-learn-handoff-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const abcPath = join(dir, 'tune.abc');
  writeFileSync(abcPath, ABC, 'utf8');

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('learn')");
  await page.setFileInput('#learnFileInput', abcPath);
  await page.waitFor("document.querySelector('.panel-learn-result').hidden === false", 20000);

  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-learn-fixitup-btn')).find(b => b.textContent === 'Fix it up').click()"
  );
  await page.waitFor("window.__coach.panelOpen() === 'editor'");
  await page.waitFor("document.getElementById('editorTitle') && document.getElementById('editorTitle').value === 'Handoff Test'", 10000);

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions handing the song to the editor');
  const title = await page.evaluate("document.getElementById('editorTitle').value");
  assert.equal(title, 'Handoff Test', 'the editor opened straight onto this song');
  const notes = await page.evaluate("window.__coach.editorSong().parts[0].notes.length");
  assert.ok(notes > 0, 'the loaded song carries its notes into the editor: ' + notes);
});

test('"Play along with this recording" opens Play Along already analysing the same decoded audio', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-learn-handoff-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wavPath = threeToneWav(join(dir, 'three-notes.wav'));

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('learn')");
  await page.setFileInput('#learnFileInput', wavPath);
  await page.waitFor("document.querySelector('.panel-learn-result').hidden === false", 20000);

  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-learn-playalong-btn')).find(b => b.textContent === 'Play along with this recording').click()"
  );
  await page.waitFor("window.__coach.panelOpen() === 'playalong'");
  await page.waitFor("document.getElementById('paResults') && !document.getElementById('paResults').hidden", 20000);

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions handing the recording to Play Along');
  const fileName = await page.evaluate("document.getElementById('paFileName').textContent");
  assert.equal(fileName, 'three-notes.wav', 'Play Along is analysing the same file the learner just dropped');
  const factsText = await page.evaluate("Array.from(document.querySelectorAll('#paFacts .stat')).map(e => e.textContent).join('|')");
  assert.match(factsText, /BPM/);
});

test('a notation import shows no "Play along with this recording" button (no decoded audio to hand over)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-learn-handoff-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const abcPath = join(dir, 'tune.abc');
  writeFileSync(abcPath, ABC, 'utf8');

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('learn')");
  await page.setFileInput('#learnFileInput', abcPath);
  await page.waitFor("document.querySelector('.panel-learn-result').hidden === false", 20000);

  const count = await page.evaluate("document.querySelectorAll('.panel-learn-playalong-btn').length");
  assert.equal(count, 0, 'a notation import never claims a hand-off the app cannot back up');
});

test('the Songs panel\'s pointer button opens Learn this', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.getElementById('songsLearnTipBtn')");
  await page.evaluate("document.getElementById('songsLearnTipBtn').click()");
  await page.waitFor("window.__coach.panelOpen() === 'learn'");

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions opening Learn this from the Songs pointer');
  assert.equal(await page.evaluate("!!document.querySelector('.panel-learn')"), true);
});
