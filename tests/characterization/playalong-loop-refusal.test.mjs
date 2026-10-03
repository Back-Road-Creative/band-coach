// Play along: the "Set loop start/end here" buttons used to ignore a point that
// would leave the loop backwards (start after the end, end before the start) with
// no word to the learner, and "Open a recording" -- the panel's first step --
// looked like plain text. Drives the built page as a learner would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { synthesizeProgression } from '../unit/audio-analysis-fixtures.mjs';

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
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), 44 + i * 2);
  writeFileSync(path, buf);
  return path;
}

test('a loop point that would leave the loop backwards is refused out loud, and the next good one clears the message', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-playalong-refuse-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const song = synthesizeProgression({ bpm: 100, bars: 8, tonicPc: 0, mode: 'major', sr: 22050 });
  const wavPath = writeWav(join(dir, 'tune.wav'), song.pcm, song.sr);
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.openPanel('playalong')");
  await page.setFileInput('#paFileInput', wavPath);
  await page.waitFor("document.getElementById('paResults') && !document.getElementById('paResults').hidden", 20000);

  const at = (v, btn) =>
    page.evaluate(`(function () {
      const ph = document.getElementById('paPlayhead');
      ph.value = '${v}';
      ph.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('${btn}').click();
    })()`);
  const loop = () => page.evaluate("document.getElementById('paLoopRange').textContent");
  const err = () => page.evaluate("(function(){const e=document.getElementById('paError');return e.hidden?'':e.textContent;})()");

  await at(400, 'paSetEnd');
  const before = await loop();
  assert.equal(await err(), '', 'a good point shows no message');

  await at(800, 'paSetStart'); // start after the loop end
  assert.equal(await loop(), before, 'the loop is left alone');
  assert.match(await err(), /start.*before.*end/i);

  await at(0, 'paSetEnd'); // end at/before the loop start
  assert.match(await err(), /end.*after.*start/i);

  await at(200, 'paSetStart'); // a good point clears the message
  assert.equal(await err(), '');
  assert.deepEqual(page.exceptions, []);
});

test('"Open a recording" looks and behaves like a button', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.openPanel('playalong')");
  const s = await page.evaluate(`(function () {
    const c = getComputedStyle(document.querySelector('label[for=paFileInput]'));
    return { cursor: c.cursor, border: c.borderTopWidth, radius: c.borderTopLeftRadius, bg: c.backgroundColor };
  })()`);
  assert.equal(s.cursor, 'pointer');
  assert.equal(s.border, '1px');
  assert.equal(s.radius, '8px');
  assert.notEqual(s.bg, 'rgba(0, 0, 0, 0)');
});
