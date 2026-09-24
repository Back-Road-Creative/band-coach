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

// P3-6: the separate Learn this panel is gone -- opens the same record door
// and review screen through Songs' own Add a song section instead (same
// duplicate-not-import precedent as tests/characterization/learn-this.
// test.mjs's own copy).
async function openAddSongSection(page) {
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelector('.add-song-row')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.add-song-row button')).find(b => b.textContent.trim() === 'Add a song').click()",
  );
}

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

// P3-4 renamed the button's label "Fix it up" -> "Edit notes" (class kept),
// so this test looks for the new label; the test name and behavior are
// unchanged.
test('"Edit notes" opens the editor panel with the learned song loaded for editing', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-learn-handoff-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const abcPath = join(dir, 'tune.abc');
  writeFileSync(abcPath, ABC, 'utf8');

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  // P3-6: Learn this is retired -- same file door, now in Songs' Add a song.
  await openAddSongSection(page);
  await page.setFileInput('#songsFileInput', abcPath);
  await page.waitFor("document.querySelector('.panel-learn-result').hidden === false", 20000);

  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-learn-fixitup-btn')).find(b => b.textContent === 'Edit notes').click()"
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
  // P3-6: Learn this is retired -- same file door, now in Songs' Add a song.
  await openAddSongSection(page);
  await page.setFileInput('#songsFileInput', wavPath);
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
  // P3-6: Learn this is retired -- same file door, now in Songs' Add a song.
  await openAddSongSection(page);
  await page.setFileInput('#songsFileInput', abcPath);
  await page.waitFor("document.querySelector('.panel-learn-result').hidden === false", 20000);

  const count = await page.evaluate("document.querySelectorAll('.panel-learn-playalong-btn').length");
  assert.equal(count, 0, 'a notation import never claims a hand-off the app cannot back up');
});

// P3-4 renamed the button's label "Fix it up" -> "Edit notes" (class kept);
// this test's own name is left describing the old label to match the
// scenario title, only the selector text below changed.
test('a recording with unresolved check items disables "Practise this" and "Edit notes" carries the check list to the editor', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-learn-handoff-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wavPath = threeToneWav(join(dir, 'three-notes.wav'));

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  // P3-6: Learn this is retired -- same file door, now in Songs' Add a song.
  await openAddSongSection(page);
  await page.setFileInput('#songsFileInput', wavPath);
  await page.waitFor("document.querySelector('.panel-learn-result').hidden === false", 20000);

  // Every transcription (mic or audio file) carries at least one check
  // item (transcribe()'s own key-profile caveat), so "Practise this" is
  // disabled with a plain-language reason next to it, and "Fix it up" is
  // the way forward.
  const practiseDisabled = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-learn-practise-btn')).find(b => b.textContent === 'Practise this').disabled"
  );
  assert.equal(practiseDisabled, true, 'Practise this is disabled while check items are unresolved');
  const reason = await page.evaluate("(document.querySelector('.panel-learn-practise-gate-reason') || {}).textContent || ''");
  assert.match(reason, /fix/i, 'a plain-language reason is shown next to the disabled button');

  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-learn-fixitup-btn')).find(b => b.textContent === 'Edit notes').click()"
  );
  await page.waitFor("window.__coach.panelOpen() === 'editor'");
  await page.waitFor("document.getElementById('editorCheck') && !document.getElementById('editorCheck').hidden", 10000);

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions handing the check list to the editor');
  const checkItemCount = await page.evaluate("document.getElementById('editorCheck').querySelectorAll('li').length");
  assert.ok(checkItemCount > 0, 'the editor shows the SAME check list the learner was just shown, not an empty one');
});

// P3-4: the Songs panel's pointer to this panel (#songsLearnTipBtn) is gone
// -- Songs now has its own "Add a song" button that reveals the SAME record
// door in place, without leaving Songs at all
// (tests/characterization/songs-add-a-song.test.mjs covers that route in
// full). Renamed from "...pointer button opens Learn this".
test('the Songs panel\'s "Add a song" button reveals the record door in Songs, without opening Learn this', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelector('.add-song-row')");
  assert.equal(await page.evaluate("!!document.getElementById('songsLearnTipBtn')"), false, 'the old pointer button is gone');
  await page.evaluate(
    "Array.from(document.querySelectorAll('.add-song-row button')).find(b => b.textContent.trim() === 'Add a song').click()",
  );
  await page.waitFor("!!document.querySelector('.panel-songs-record-btn')");

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions revealing the record door from Songs');
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'songs', 'Learn this is never opened -- the record door lives in Songs itself');
});
