// The "play along with a recording" panel: a learner opens an audio file,
// gets its tempo/key/chords, and can loop a section slower without changing
// pitch. Drives the built page exactly as a learner would: a real file
// picked via the OS file dialog (simulated with CDP's DOM.setFileInputFiles
// — see tests/helpers/browser.mjs's setFileInput), then DOM controls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { synthesizeProgression } from '../unit/audio-analysis-fixtures.mjs';

// Pure-Node WAV writer: 16-bit PCM mono from a plain Float32Array, no binary
// fixture committed to the repo (see tests/release/gate.test.mjs's precedent).
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

test('a learner opens a recording, sees its tempo/key/chords, loops a section slower, and it is remembered', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-playalong-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const song = synthesizeProgression({ bpm: 100, bars: 8, tonicPc: 0, mode: 'major', sr: 22050 });
  const wavPath = writeWav(join(dir, 'practice-tune.wav'), song.pcm, song.sr);

  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('playalong')");
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'playalong');

  await page.setFileInput('#paFileInput', wavPath);
  await page.waitFor("document.getElementById('paResults') && !document.getElementById('paResults').hidden", 20000);

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions while opening and analysing');
  assert.equal(
    (await page.evaluate("Array.from(document.querySelectorAll('#paFacts .stat')).map(e => e.textContent).join('|')")).includes(
      'BPM'
    ),
    true
  );
  const beatTicks = await page.evaluate("document.querySelectorAll('#paTimeline .pa-beat-tick').length");
  const chordLabels = await page.evaluate("document.querySelectorAll('#paTimeline .pa-chord').length");
  assert.ok(beatTicks > 0, 'beat marks are drawn on the timeline');
  assert.ok(chordLabels > 0, 'chord segments are drawn on the timeline');

  // Keyboard/playhead route to selecting a loop section (no drag needed).
  await page.evaluate(`(function () {
    const ph = document.getElementById('paPlayhead');
    ph.value = '0';
    ph.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('paSetStart').click();
    ph.value = '300';
    ph.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('paSetEnd').click();
  })()`);
  const loopRangeText = await page.evaluate("document.getElementById('paLoopRange').textContent");
  assert.match(loopRangeText, /^Loop: 0:00/);

  // Play the loop through the transport (WSOLA time-stretch): no exceptions,
  // and the button reflects playing state.
  await page.evaluate("document.getElementById('paSpeed').value = '70'; document.getElementById('paSpeed').dispatchEvent(new Event('input', { bubbles: true }))");
  await page.evaluate("document.getElementById('paPlayBtn').click()");
  assert.equal(await page.evaluate("document.getElementById('paPlayBtn').textContent"), 'Stop');
  await page.evaluate("document.getElementById('paPlayBtn').click()");
  assert.equal(await page.evaluate("document.getElementById('paPlayBtn').textContent"), 'Play loop');
  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions during loop playback');

  // Nothing but the file name and loop points is remembered.
  const panelData = await page.evaluate("window.__coach.db().panels.playalong");
  assert.equal(panelData.fileName, 'practice-tune.wav');
  assert.ok(typeof panelData.loopStart === 'number' && typeof panelData.loopEnd === 'number');
  assert.equal(Object.keys(panelData).sort().join(','), 'fileName,loopEnd,loopStart');

  // Reopening the panel after a reload shows the saved hint (file re-opens are manual: no
  // audio bytes are ever kept). save() debounces localStorage writes by 1200ms (src/app.js);
  // wait it out before reloading.
  await new Promise((r) => setTimeout(r, 1600));
  await page.reload();
  await page.waitFor("window.__coach && window.__coach.db().mods.kbd", 5000);
  await page.evaluate("window.__coach.openPanel('playalong')");
  const hintHidden = await page.evaluate("document.getElementById('paSavedHint').hidden");
  const hintText = await page.evaluate("document.getElementById('paSavedHint').textContent");
  assert.equal(hintHidden, false);
  assert.match(hintText, /practice-tune\.wav/);
});

test('the panel states plainly that there is no transpose (pitch-shift) control', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.openPanel('playalong')");
  const text = await page.evaluate("document.querySelector('.panel-playalong').textContent");
  assert.match(text, /No pitch change \(transpose\)/);
});
