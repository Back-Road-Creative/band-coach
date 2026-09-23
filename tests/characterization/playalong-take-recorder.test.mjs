// I3 "duet with yourself": the play-along panel (src/ui/playalong.js) can
// record a take from the real mic and use it as backing the same way an
// opened file is, through the SAME "real getUserMedia + a fake audio file"
// technique tests/characterization/w-playalong.test.mjs's siblings use
// elsewhere in this suite (mic-channel-mono.test.mjs, mic-device.test.mjs) —
// `--use-file-for-fake-audio-capture` streams a real WAV into whatever the
// page's own getUserMedia() call opens, so this drives the real capture path
// (AnalyserNode polling — see playalong.js's startRecordingCapture), not the
// window.__coach debug hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { synthesizeProgression } from '../unit/audio-analysis-fixtures.mjs';

// Same pure-Node WAV writer as w-playalong.test.mjs (no binary fixture
// committed to the repo).
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

test('recording a take from the mic feeds the same analyse/loop path an opened file does', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-playalong-take-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const song = synthesizeProgression({ bpm: 120, bars: 4, tonicPc: 0, mode: 'major', sr: 22050 });
  const wavPath = writeWav(join(dir, 'my-take-source.wav'), song.pcm, song.sr);

  const page = await launchPage(HTML_PATH, { fakeAudioFile: wavPath });
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('playalong')");
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'playalong');

  // Press once to start recording (mic permission requested only now).
  await page.evaluate("document.getElementById('paRecordBtn').click()");
  await page.waitFor("document.getElementById('paRecordBtn').textContent === 'Stop recording'", 10000);

  // Let a few seconds of the fake mic stream actually get captured.
  await new Promise((r) => setTimeout(r, 3000));

  // Press again to stop; this hands the captured PCM into the same
  // analyse()/loop path an opened file goes through.
  await page.evaluate("document.getElementById('paRecordBtn').click()");
  await page.waitFor("document.getElementById('paRecordBtn').textContent === 'Record a take'", 5000);

  await page.waitFor(
    "(document.getElementById('paResults') && !document.getElementById('paResults').hidden) || (document.getElementById('paError') && !document.getElementById('paError').hidden)",
    20000
  );

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions while recording and analysing a take');
  const errorHidden = await page.evaluate("document.getElementById('paError').hidden");
  assert.equal(errorHidden, true, 'a several-second take with real signal should analyse, not error out');

  const fileNameShown = await page.evaluate("document.getElementById('paFileName').textContent");
  assert.match(fileNameShown, /^My take \(/);

  const panelData = await page.evaluate("window.__coach.db().panels.playalong");
  assert.match(panelData.fileName, /^My take \(/);
  assert.ok(typeof panelData.loopStart === 'number' && typeof panelData.loopEnd === 'number');
});

test('a second press stops a take before analysis begins on the earlier partial take', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.openPanel('playalong')");

  await page.evaluate("document.getElementById('paRecordBtn').click()");
  await page.waitFor("document.getElementById('paRecordBtn').textContent === 'Stop recording'", 10000);
  await page.evaluate("document.getElementById('paRecordBtn').click()");
  await page.waitFor("document.getElementById('paRecordBtn').textContent === 'Record a take'", 5000);

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions on a quick start/stop with no real signal');
});
