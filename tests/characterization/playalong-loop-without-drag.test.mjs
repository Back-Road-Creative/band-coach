// Release acceptance record E9 "Alternatives to dragging": the timeline loop
// is set by dragging (src/ui/playalong.js pointerdown/move), so a learner who
// cannot drag needs another route. This sets a loop start and end using ONLY
// the Playhead range input (value + input event, the same events arrow keys
// produce on a range) and the "Set loop start/end here" buttons. No pointer
// event is dispatched anywhere on the page; a listener proves it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { synthesizeProgression } from '../unit/audio-analysis-fixtures.mjs';

function writeWav(path, pcm, sampleRate) {
  const buf = Buffer.alloc(44 + pcm.length * 2);
  buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + pcm.length * 2, 4); buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii'); buf.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), 44 + i * 2);
  writeFileSync(path, buf);
  return path;
}

test('a loop start and end can be set with the playhead range and the two buttons alone, no pointer', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-loop-nodrag-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const song = synthesizeProgression({ bpm: 100, bars: 8, tonicPc: 0, mode: 'major', sr: 22050 });
  const wavPath = writeWav(join(dir, 'tune.wav'), song.pcm, song.sr);

  const page = await launchPage(HTML_PATH, {
    initScript: "window.__ptr = 0; for (const n of ['pointerdown','pointermove','pointerup','mousedown','mousemove','touchstart','touchmove']) addEventListener(n, () => { window.__ptr++; }, true);",
  });
  t.after(() => page.close());
  await page.evaluate("window.__coach.openPanel('playalong')");
  await page.setFileInput('#paFileInput', wavPath);
  await page.waitFor("document.getElementById('paResults') && !document.getElementById('paResults').hidden", 20000);

  const duration = song.pcm.length / song.sr;
  const state = async () => JSON.parse(await page.evaluate(`JSON.stringify({
    range: document.getElementById('paLoopRange').textContent,
    err: document.getElementById('paError').hidden ? '' : document.getElementById('paError').textContent,
    phTime: document.getElementById('paPlayheadTime').textContent,
    region: (() => { const r = document.querySelector('#paTimeline .pa-loop-region'); return r ? { left: parseFloat(r.style.left), width: parseFloat(r.style.width) } : null; })(),
    saved: window.__coach.db().panels.playalong,
  })`));
  const setPlayhead = (v) => page.evaluate(`(() => { const ph = document.getElementById('paPlayhead'); ph.value = '${v}'; ph.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

  // Start at 25% of the range, end at 75%.
  await setPlayhead(250);
  await page.evaluate("document.getElementById('paSetStart').click()");
  await setPlayhead(750);
  await page.evaluate("document.getElementById('paSetEnd').click()");
  await new Promise((r) => setTimeout(r, 1600)); // save() debounce

  const s = await state();
  assert.equal(s.err, '', 'no refusal shown');
  const start = duration * 0.25, end = duration * 0.75;
  assert.equal(s.range, `Loop: ${fmt(start)}–${fmt(end)}`, 'loop text matches the playhead positions');
  assert.ok(s.region, 'a loop region is drawn on the timeline');
  assert.ok(Math.abs(s.region.left - 25) < 1.5, `timeline region starts at ${s.region.left}%, expected ~25%`);
  assert.ok(Math.abs(s.region.width - 50) < 3, `timeline region is ${s.region.width}% wide, expected ~50%`);
  assert.ok(Math.abs(s.saved.loopStart - start) < 0.1 * duration / 10 + 0.1, `transport/stored loopStart ${s.saved.loopStart}, expected ~${start}`);
  assert.ok(Math.abs(s.saved.loopEnd - end) < 0.1 * duration / 10 + 0.1, `transport/stored loopEnd ${s.saved.loopEnd}, expected ~${end}`);
  assert.equal(await page.evaluate('window.__ptr'), 0, 'no pointer/mouse/touch event was dispatched');
  assert.deepEqual(page.exceptions, []);
});
