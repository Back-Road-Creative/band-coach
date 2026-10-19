// A silent (or too-quiet) audio file must not be saved as an empty Draft:
// Add a song's file door refuses a recording that transcribes to zero notes,
// the same way the mic door does (songs-silent-mic-take.test.mjs). Driven
// through the real #songsFileInput with a silent WAV.
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

test('a silent audio file saves no draft and says nothing was heard', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-silent-file-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wavPath = silentWav(join(dir, 'silence.wav'));

  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelector('.add-song-row')");
  await page.evaluate("Array.from(document.querySelectorAll('.add-song-row button')).find(b => b.textContent.trim() === 'Add a song').click()");
  await page.waitFor("!!document.getElementById('songsFileInput')");
  const rowsBefore = await page.evaluate("document.querySelectorAll('.panel-songs-row').length");

  await page.setFileInput('#songsFileInput', wavPath);
  await page.waitFor("document.querySelector('.panel-songs-msg').textContent.indexOf('Nothing was heard') === 0", 20000);

  assert.equal(await page.evaluate("document.querySelector('.panel-learn-result').hidden"), true, 'no review screen for a file with no notes');
  await page.evaluate("window.__coach.openPanel('songs')");
  const rowsAfter = await page.evaluate("document.querySelectorAll('.panel-songs-row').length");
  assert.equal(rowsAfter, rowsBefore, 'no Draft row was added');
  assert.deepEqual(page.exceptions, []);
});
