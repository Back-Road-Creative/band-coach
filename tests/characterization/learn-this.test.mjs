// "Learn this" panel (src/ui/learn.js, unit G1a: the file door only).
//
// This panel is not wired into src/app.js yet -- that wiring (and retiring
// the older Record a tune / Play Along / Songs-file-button panels it
// replaces) is a separate, later unit. So instead of driving the built
// dist/band-coach.html (which does not register this panel yet), this test
// bundles src/ui/panels.js + src/ui/learn.js + src/ui/songs.js on their own
// into a small throwaway harness page with a panel-picker bar that mirrors
// src/app.js's own buildPanelPicker()/openPanel() (one <button
// data-panel="…"> per registered panel, each opening it via panels.open())
// closely enough that clicking "Songs" here exercises the exact real
// mechanism, not a stand-in. A real headless browser still drives it: a
// real file input, a real IndexedDB, a real AudioContext decoding a real
// WAV file on disk (tests/helpers/browser.mjs's setFileInput, same pattern
// tests/characterization/w-songs.test.mjs and editor-audio-file.test.mjs
// use against the full app).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuildBuild } from 'esbuild';
import { launchPage } from '../helpers/browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

async function buildHarness() {
  const entry = `
import { createPanels } from ${JSON.stringify(join(root, 'src/ui/panels.js'))};
import { register as registerLearn } from ${JSON.stringify(join(root, 'src/ui/learn.js'))};
import { register as registerSongs } from ${JSON.stringify(join(root, 'src/ui/songs.js'))};
import { byId as instrumentById } from ${JSON.stringify(join(root, 'src/instruments/index.js'))};

const panels = createPanels();
registerLearn(panels);
registerSongs(panels);

// A real ready instrument current in the main trainer (the app always has
// one once a learner has picked anything) -- matches the real app.js
// panelApi's instrument()/mod(), so startPractice() below behaves exactly
// as it would in the shipped app instead of hitting its own
// "pick an instrument first" guard.
let currentMod = 'kbd';
const db = { panels: {} };
const api = {
  db: () => db,
  save: () => {},
  mod: () => currentMod,
  setMod: (m) => { currentMod = m; },
  instrument: (id) => instrumentById[id || currentMod] || null,
  audio: () => { if (!window.__actx) window.__actx = new (window.AudioContext || window.webkitAudioContext)(); return window.__actx; },
  openMic: () => Promise.reject(new Error('no microphone in this harness')),
  analysers: () => ({}),
  gates: () => ({ pitch: 0.01 }),
  tone: () => {},
  click: () => {},
  now: () => performance.now(),
  say: () => {},
  coach: () => {},
  recordError: (scope, e) => { window.__errors = window.__errors || []; window.__errors.push(scope + ': ' + (e && e.message)); },
  store: (id) => ({
    get: () => (db.panels && db.panels[id]) || null,
    set: (v) => { if (!db.panels) db.panels = {}; db.panels[id] = v; },
  }),
  creditNote: () => {},
};

const host = document.getElementById('panelHost');
const picker = document.getElementById('panelPicker');
function openPanel(id) {
  panels.open(id, host, api);
  document.querySelectorAll('#panelPicker button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.panel === id)));
}
panels.list().forEach((p) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.panel = p.id;
  b.textContent = p.name;
  b.addEventListener('click', () => openPanel(p.id));
  picker.appendChild(b);
});
window.__openPanel = openPanel;
window.__panelOpen = () => panels.current();
document.documentElement.setAttribute('data-coach-ready', '1');
`;
  const result = await esbuildBuild({
    stdin: { contents: entry, resolveDir: root, loader: 'js' },
    bundle: true,
    format: 'iife',
    target: 'es2020',
    write: false,
  });
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="panelPicker"></div>
<div id="panelHost"></div>
<script>${js}</script>
</body></html>`;
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-learn-harness-'));
  const htmlPath = join(dir, 'harness.html');
  writeFileSync(htmlPath, html, 'utf8');
  return { htmlPath, dir };
}

// Pure-Node WAV writer: 16-bit PCM mono from a plain Float32Array (same
// precedent as tests/characterization/editor-audio-file.test.mjs and
// w-playalong.test.mjs -- no binary fixture committed to the repo).
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

// Three clean 0.35s tones at 44100Hz: C4, E4, G4 -- enough for a real note
// sequence, short enough to transcribe fast.
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

const ABC = 'X:1\nT:Learn Test\nM:4/4\nL:1/8\nK:C\nCDEFGABc|\n';

test('a real .abc file dropped in becomes a practisable song, title + Play it on cards + library entry', async (t) => {
  const { htmlPath, dir } = await buildHarness();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const abcPath = join(dir, 'tune.abc');
  writeFileSync(abcPath, ABC, 'utf8');

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__openPanel('learn')");
  await page.setFileInput('#learnFileInput', abcPath);
  await page.waitFor("document.querySelector('.panel-learn-result').hidden === false", 20000);

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions importing a notation file');
  const title = await page.evaluate("document.querySelector('.panel-learn-result h4').textContent");
  assert.equal(title, 'Learn Test');

  const cardCount = await page.evaluate("document.querySelectorAll('.panel-learn-result .panel-songs-instrument-card').length");
  assert.ok(cardCount > 0, 'at least one "Play it on…" instrument card is shown');

  // Practise this -> switches to the real Songs panel, already on this
  // song's lesson (requestOpenSong() + Songs's own show()-time check).
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-learn-practise-btn')).find(b => b.textContent === 'Practise this').click()"
  );
  await page.waitFor("window.__panelOpen() === 'songs'");
  await page.waitFor("document.querySelector('.panel-songs-practice h3')");
  const practiceTitle = await page.evaluate("document.querySelector('.panel-songs-practice h3').textContent");
  assert.equal(practiceTitle, 'Learn Test', 'Songs opened straight onto this song\'s lesson');
});

test('a real .wav recording dropped in transcribes to a song with a positive note count', async (t) => {
  const { htmlPath, dir } = await buildHarness();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wavPath = threeToneWav(join(dir, 'three-notes.wav'));

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__openPanel('learn')");
  await page.setFileInput('#learnFileInput', wavPath);
  await page.waitFor("document.querySelector('.panel-learn-result').hidden === false", 20000);

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions decoding and transcribing a recording');
  const noteCount = await page.evaluate("document.querySelectorAll('.panel-learn-confidence-note').length");
  assert.ok(noteCount > 0, 'at least one note was transcribed from the recording: ' + noteCount);
});

test('an unsupported file shows a plain-words message naming what this panel accepts', async (t) => {
  const { htmlPath, dir } = await buildHarness();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const badPath = join(dir, 'notes.txt');
  writeFileSync(badPath, 'just some plain text, not a song or a recording', 'utf8');

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__openPanel('learn')");
  await page.setFileInput('#learnFileInput', badPath);
  await page.waitFor("document.querySelector('.panel-learn-status').textContent.length > 0", 20000);

  const message = await page.evaluate("document.querySelector('.panel-learn-status').textContent");
  assert.match(message, /\.mid|\.abc|\.musicxml|\.wav|recording/i);
  assert.equal(await page.evaluate("document.querySelector('.panel-learn-result').hidden"), true, 'no result is shown for an unsupported file');
});
