// F8 (plan L431/L440/L490-492, current code src/app.js onPitch pluck branch):
// a same-note repeat inside one exercise was missed on a ringing string — a
// note only re-fired after RMS fell under 0.006 or the pitch changed, with
// no onset detector. This drives the fix end to end through the real mic
// pipeline: window.__coach.testPluck(freq, attacksMs) schedules two real,
// exponentially-decaying attacks of the SAME pitch through the same
// analyser/AudioWorklet chain a real pluck uses (src/audio/pitch-worklet.js,
// src/audio/onset.js), with the second starting while the first is still
// ringing well above the RMS 0.006 release floor.
//
// The task is forced (via the exposed task object, same technique the F9
// characterization test uses on db()) to require the SAME target note
// twice in a row, so a passing run proves BOTH plucks were recognised as
// separate note events — the exact thing the old debounce logic collapsed
// into one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

test('F8 fixed: a same-pitch re-pluck while the string still rings above RMS 0.006 re-fires the note', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  assert.ok(info.string, 'level-1 gtr items are string/fret notes');

  // Force a second element identical to the first, so the task is not
  // "done" after the first correct pluck and stays waiting on the SAME note.
  await page.evaluate(`
    (function () {
      const t = window.__coach.task();
      t.els.push(Object.assign({}, t.els[0]));
    })()
  `);
  assert.equal(await page.evaluate('window.__coach.task().els.length'), 2);

  const freq = midiToFreq(info.midi);
  await page.evaluate(`window.__coach.testPluck(${freq}, [0, 500])`);

  await page.waitFor('window.__coach.task() && window.__coach.task().done', 8000);

  assert.equal(
    await page.evaluate('window.__coach.task().idx'),
    2,
    'both identical-pitch attacks should have been credited as separate note events'
  );
});

test('control: without a second attack, a single ringing pluck does not double-fire', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  await page.evaluate(`
    (function () {
      const t = window.__coach.task();
      t.els.push(Object.assign({}, t.els[0]));
    })()
  `);

  const freq = midiToFreq(info.midi);
  await page.evaluate(`window.__coach.testPluck(${freq}, [0])`);

  // Give it as long as the two-attack test waits, then confirm only the
  // first element was credited — the ring-out of one pluck must not be
  // mistaken for a second onset by the detector's own noise floor.
  await new Promise((r) => setTimeout(r, 2000));

  assert.equal(
    await page.evaluate('window.__coach.task().idx'),
    1,
    'a single attack should credit exactly one element, not two'
  );
  assert.equal(await page.evaluate('window.__coach.task().done'), false);
});
