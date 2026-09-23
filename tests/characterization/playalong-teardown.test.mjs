// Regression coverage for two Play Along teardown/drag bugs (see
// src/ui/playalong.js's destroy() and the timeline pointerdown handler):
//
//   1. Closing the panel while a take/recording is still being analysed
//      (analyse() is async and not cancellable mid-flight the way the
//      Cancel button is) must not let that abandoned analysis write the
//      store once the instance is gone -- a learner who reopens the panel,
//      loads something else, and sets a real loop must not have it
//      silently clobbered moments later by a stale write from an instance
//      that no longer exists.
//   2. A loop-selection drag that leaves the timeline strip mid-drag must
//      keep tracking the pointer (setPointerCapture), not freeze.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { synthesizeProgression } from '../unit/audio-analysis-fixtures.mjs';

// Pure-Node WAV writer: same approach as tests/characterization/w-playalong.test.mjs.
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

test('a stale analysis from a torn-down Play Along instance cannot overwrite a freshly-set loop', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-playalong-teardown-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // ~2.4 minutes of audio: this repo's own measurement (see playalong.js's
  // top-of-file comment) puts a 3-minute buffer's analyse() at ~2.6s, and
  // decodeAudioData of a multi-minute WAV adds real time on top of that --
  // comfortably longer than the short recording's whole load+loop-set below,
  // so the long analysis is still in flight when the panel is torn down and
  // still unresolved well after the short recording's loop has been saved.
  const slowSong = synthesizeProgression({ bpm: 100, bars: 60, tonicPc: 0, mode: 'major', sr: 22050 });
  const slowPath = writeWav(join(dir, 'slow-take.wav'), slowSong.pcm, slowSong.sr);
  const fastSong = synthesizeProgression({ bpm: 100, bars: 2, tonicPc: 0, mode: 'major', sr: 22050 });
  const fastPath = writeWav(join(dir, 'fast-take.wav'), fastSong.pcm, fastSong.sr);

  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('playalong')");
  // Kick off analysis of the long recording, then close the panel (hide()
  // then destroy(), same as panels.close()) before that analysis has any
  // chance to finish -- setFileInput only waits for the synchronous part of
  // the 'change' handler, which starts loadFile()/analyzeRecording() without
  // awaiting it.
  await page.setFileInput('#paFileInput', slowPath);
  await page.evaluate("window.__coach.closePanel()");

  // Reopen fresh (a brand-new mounted instance -- panels.close() drops the
  // old one), load a short recording, and give it a real, distinct loop.
  await page.evaluate("window.__coach.openPanel('playalong')");
  await page.setFileInput('#paFileInput', fastPath);
  await page.waitFor("document.getElementById('paResults') && !document.getElementById('paResults').hidden", 20000);
  await page.evaluate(`(function () {
    const ph = document.getElementById('paPlayhead');
    ph.value = '0';
    ph.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('paSetStart').click();
    ph.value = '900';
    ph.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('paSetEnd').click();
  })()`);
  const savedAfterSetup = await page.evaluate("window.__coach.db().panels.playalong");
  assert.equal(savedAfterSetup.fileName, 'fast-take.wav');

  // Give the abandoned long analysis every chance it would need to finish
  // and -- if the destroyed instance were not guarded -- clobber the store
  // with its own stale fileName/loop.
  await new Promise((r) => setTimeout(r, 6000));

  const savedAfter = await page.evaluate("window.__coach.db().panels.playalong");
  assert.equal(savedAfter.fileName, 'fast-take.wav', 'a torn-down instance must not overwrite the saved loop');
  assert.equal(savedAfter.loopStart, savedAfterSetup.loopStart);
  assert.equal(savedAfter.loopEnd, savedAfterSetup.loopEnd);
  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions from the abandoned analysis or its DOM writes');
});

test('a loop-selection drag captures the pointer so it keeps tracking off the timeline strip', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-playalong-drag-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const song = synthesizeProgression({ bpm: 100, bars: 4, tonicPc: 0, mode: 'major', sr: 22050 });
  const wavPath = writeWav(join(dir, 'drag-take.wav'), song.pcm, song.sr);

  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('playalong')");
  await page.setFileInput('#paFileInput', wavPath);
  await page.waitFor("document.getElementById('paResults') && !document.getElementById('paResults').hidden", 20000);

  await page.evaluate(`(function () {
    const tl = document.getElementById('paTimeline');
    window.__paCapturedId = null;
    tl.setPointerCapture = function (id) { window.__paCapturedId = id; };
    tl.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, pointerId: 7, bubbles: true }));
  })()`);
  assert.equal(await page.evaluate('window.__paCapturedId'), 7, 'pointerdown on the timeline captures that pointer so a drag leaving the strip keeps tracking');
  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions from a pointerdown on the timeline');
});
