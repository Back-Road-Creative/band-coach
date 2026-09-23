// "Record a tune" panel (src/ui/editor.js): the "More than one note at a
// time" checkbox next to the file-import picker. Off (the default), file
// import behaves exactly as tests/characterization/editor-audio-file.test.mjs
// already proves; on, a two-voice recording comes back as two parts, each
// shown as its own labelled lane in the notation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

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

// A held bass note (G2) under a two-note melody (C5 then E5), summed into
// one mono signal -- deliberately not octave/fifth multiples of each other
// (see tests/unit/transcribe-polyphonic.test.mjs for why: notes whose
// harmonic series coincide mask one another in the multipitch detector).
function twoVoiceWav(path) {
  const sr = 22050;
  const noteSamples = Math.round(0.6 * sr);
  const total = noteSamples * 2;
  const pcm = new Float32Array(total);
  const freqFor = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const bassFreq = freqFor(43);
  const melFreq1 = freqFor(72);
  const melFreq2 = freqFor(76);
  for (let i = 0; i < total; i++) {
    const melFreq = i < noteSamples ? melFreq1 : melFreq2;
    pcm[i] = 0.35 * Math.sin((2 * Math.PI * bassFreq * i) / sr) + 0.35 * Math.sin((2 * Math.PI * melFreq * i) / sr);
  }
  return writeWav(path, pcm, sr);
}

async function openEditor(page) {
  await page.evaluate("window.__coach.openPanel('editor')");
  await page.waitFor("window.__coach.panelOpen() === 'editor'");
}

test('the "More than one note at a time" checkbox is off by default and offered next to the file input', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openEditor(page);

  assert.equal(await page.evaluate("!!document.getElementById('editorPolyphonic')"), true, 'the checkbox exists');
  assert.equal(await page.evaluate("document.getElementById('editorPolyphonic').checked"), false, 'off by default');
});

test('checking it before choosing a two-voice file shows two labelled lanes', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-editor-poly-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wavPath = twoVoiceWav(join(dir, 'two-voices.wav'));

  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openEditor(page);

  await page.evaluate("document.getElementById('editorPolyphonic').checked = true");
  await page.setFileInput('#editorFileInput', wavPath);
  await page.waitFor("document.getElementById('editorCheck').hidden === false", 20000);

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions transcribing a two-voice file');

  const partCount = await page.evaluate('window.__coach.editorSong().parts.length');
  assert.equal(partCount, 2, 'the polyphonic song has two parts');

  const roles = await page.evaluate("window.__coach.editorSong().parts.map(p => p.role)");
  assert.ok(roles.includes('melody'), `melody part missing, got ${JSON.stringify(roles)}`);
  assert.ok(roles.includes('bass'), `bass part missing, got ${JSON.stringify(roles)}`);

  const needsCheck = await page.evaluate(
    "Array.from(document.getElementById('editorCheck').querySelectorAll('li')).map(li => li.textContent)",
  );
  assert.ok(needsCheck.some((line) => line.includes('I heard 2 voices')), `expected an "I heard 2 voices" line, got ${JSON.stringify(needsCheck)}`);

  // Two parts means two lanes, each with its own label row taller than a
  // single un-labelled staff -- the canvas grows to fit both rather than
  // one part silently overwriting the other's drawing.
  const canvasHeight = await page.evaluate("document.getElementById('editorCanvas').height");
  assert.ok(canvasHeight > 100, `expected a canvas tall enough for two lanes, got ${canvasHeight}`);
});

test('leaving the checkbox unchecked still transcribes a file as one part, unchanged', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-editor-poly-off-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wavPath = twoVoiceWav(join(dir, 'two-voices.wav'));

  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openEditor(page);

  await page.setFileInput('#editorFileInput', wavPath);
  await page.waitFor("document.getElementById('editorCheck').hidden === false", 20000);

  const partCount = await page.evaluate('window.__coach.editorSong().parts.length');
  assert.equal(partCount, 1, 'unchecked checkbox means the plain monophonic path, one part');
});
