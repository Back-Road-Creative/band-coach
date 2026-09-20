// Item 4 (Wave W, unit w-fixes): ensurePitchWorklet() created the
// AudioWorkletNode once with a hardcoded fmin/fmax of 36/1600, unlike the
// old main-thread listen() path which always read the CURRENT module's own
// M.fmin/M.fmax. src/audio/pitch-worklet.js's port protocol had no way to
// change the range after creation, so switching from e.g. guitar
// (fmin 70/fmax 1200) to harmonica (fmin 200/fmax 2300) left the worklet
// permanently unable to detect the top of the harmonica's range.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('setMod sends the new module range to an already-created pitch worklet', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  // testPluck() awaits ensurePitchWorklet() before scheduling audio, so the
  // worklet node exists once this resolves.
  await page.evaluate('window.__coach.testPluck(220, [0])');

  const gtrRange = await page.evaluate('window.__coach.pitchWorkletRange()');
  assert.deepEqual(gtrRange, { fmin: 70, fmax: 1200 }, 'the worklet should be created with the active module range');

  await page.evaluate("window.__coach.setMod('harp')");
  const harpRange = await page.evaluate('window.__coach.pitchWorkletRange()');
  assert.deepEqual(harpRange, { fmin: 200, fmax: 2300 }, 'switching modules should re-range the already-created worklet');
});

// src/audio/range.js's frameSizeForInstrument: the worklet's analysis frame
// size is instrument-shaped too, not just its fmin/fmax. Switching to an
// instrument whose lowest string needs a bigger analysis window (bass, open
// E 41.2 Hz) must resize the already-created worklet, and switching back
// must shrink it again -- 4096 is not allowed to become the new default for
// every instrument (see CLAUDE.md-cited latency concern in range.js).
test('setMod resizes an already-created pitch worklet\'s frameSize per instrument', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate('window.__coach.testPluck(220, [0])');
  assert.equal(await page.evaluate('window.__coach.pitchWorkletFrameSize()'), 2048, 'guitar does not need the bigger frame');

  await page.evaluate("window.__coach.setMod('bass')");
  assert.equal(await page.evaluate('window.__coach.pitchWorkletFrameSize()'), 4096, 'bass\'s open E (41.2 Hz) needs the bigger frame');

  await page.evaluate("window.__coach.setMod('gtr')");
  assert.equal(await page.evaluate('window.__coach.pitchWorkletFrameSize()'), 2048, 'switching back off bass must shrink the frame again, not leave 4096 as the new default');
});
