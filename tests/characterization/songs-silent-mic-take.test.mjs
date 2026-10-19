// A silent (or too-quiet) microphone take must not be saved as an empty
// Draft: src/ui/songs/record-door.js refuses a take that transcribes to zero
// notes, says so in plain words, and leaves Record usable again. Driven
// through the real Record button with a silent fake audio input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

function silentWav(path, seconds = 6) {
  const sr = 44100;
  const dataSize = Math.round(seconds * sr) * 2;
  const buf = Buffer.alloc(44 + dataSize); // zero-filled data = digital silence
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  writeFileSync(path, buf);
  return path;
}

test('a silent recording saves no draft and says nothing was heard', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-silent-take-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wavPath = silentWav(join(dir, 'silence.wav'));

  const page = await launchPage(HTML_PATH, { fakeAudioFile: wavPath });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelector('.add-song-row')");
  await page.evaluate("Array.from(document.querySelectorAll('.add-song-row button')).find(b => b.textContent.trim() === 'Add a song').click()");
  await page.waitFor("!!document.querySelector('.panel-songs-record-btn')");
  const rowsBefore = await page.evaluate("document.querySelectorAll('.panel-songs-row').length");

  await page.evaluate("document.querySelector('.panel-songs-record-btn').click()");
  await page.waitFor("document.querySelector('.panel-songs-record-btn').textContent === 'Stop'", 15000);
  await new Promise((r) => setTimeout(r, 3000));
  await page.evaluate("document.querySelector('.panel-songs-record-btn').click()");
  await page.waitFor("document.querySelector('.panel-songs-msg').textContent.indexOf('Nothing was heard') === 0", 20000);

  // The advice fits the door the learner used.
  const said = await page.evaluate("document.querySelector('.panel-songs-msg').textContent");
  assert.match(said, /closer to the mic/, said);
  assert.doesNotMatch(said, /different recording/, said);
  assert.equal(await page.evaluate("document.querySelector('.panel-learn-result').hidden"), true, 'no review screen for a take with no notes');
  const btn = await page.evaluate("(() => { var b = document.querySelector('.panel-songs-record-btn'); return { text: b.textContent, disabled: b.disabled }; })()");
  assert.equal(btn.disabled, false, 'Record is usable again');
  assert.equal(btn.text, 'Record');

  await page.evaluate("window.__coach.openPanel('songs')");
  const rowsAfter = await page.evaluate("document.querySelectorAll('.panel-songs-row').length");
  assert.equal(rowsAfter, rowsBefore, 'no Draft row was added');
  assert.deepEqual(page.exceptions, []);
});
