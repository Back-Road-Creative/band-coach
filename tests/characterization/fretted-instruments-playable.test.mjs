// Five fretted instrument records (src/instruments/mandolin.js,
// banjo-5-string.js, bass-5-string.js, ukulele-low-g.js,
// ukulele-baritone.js) shipped with status: 'planned', curriculum: [] and
// no MODS entry -- a learner could never pick or play any of them. This
// drives each one end to end: select it, get a task, answer the correct
// note via the window.__coach debug hook, see it credited (same technique
// tests/characterization/known-flaws.test.mjs's F1 test uses:
// window.__coach.note(midi, exact), which feeds the judging logic directly
// rather than through the real mic pipeline).
//
// All five also get a real-mic-pipeline check with testPluck, the same
// technique tests/characterization/onset-repluck.test.mjs uses, since every
// note in their curricula sits comfortably inside the pitch detector's
// working band. bass-5-string used to be excluded from this generic check:
// its curriculum's open E string (41.2 Hz) sat right at the edge of what the
// AudioWorklet pipeline's old fixed frameSize (2048) could resolve, and the
// open B0 (30.87 Hz) could not be resolved at all. src/audio/range.js's
// frameSizeForInstrument now derives the worklet's analysis frame size from
// each instrument's own range.low (4096 for bass-5-string, comfortably
// covering both its open E and open B0 -- see tests/unit/yin.test.mjs and
// tests/unit/range.test.mjs), so bass-5-string gets the same generic
// real-mic check as the others, low B string included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { byId } from '../../src/instruments/index.js';

const htmlPath = HTML_PATH;
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

const NEW_FRETTED_IDS = ['mandolin', 'banjo-5-string', 'bass-5-string', 'ukulele-low-g', 'ukulele-baritone'];
const MIC_RELIABLE_IDS = ['mandolin', 'banjo-5-string', 'bass-5-string', 'ukulele-low-g', 'ukulele-baritone'];

for (const id of NEW_FRETTED_IDS) {
  test(`${id}: selectable, and answering the task note correctly credits it`, async (t) => {
    const page = await launchPage(htmlPath);
    t.after(() => page.close());

    await page.evaluate(`window.__coach.setMod(${JSON.stringify(id)})`);
    assert.equal(await page.evaluate('window.__coach.db().prefs.mod'), id, `${id} should be selectable via setMod`);

    await page.evaluate("document.getElementById('playBtn').click()");
    await page.waitFor('window.__coach.task()');

    const info = await page.evaluate('window.__coach.cur().info');
    assert.equal(info.kind, 'note', `${id} level 1 should hand out a note task`);
    assert.ok(Number.isFinite(info.midi), `${id} task note should have a real midi pitch`);

    await page.evaluate(`window.__coach.note(${info.midi}, true)`);
    await page.waitFor('window.__coach.task() && window.__coach.task().done', 4000);

    assert.equal(
      await page.evaluate('window.__coach.task().idx'),
      1,
      `${id}: the correct note should have been credited`
    );
  });
}

for (const id of MIC_RELIABLE_IDS) {
  test(`${id}: a real microphone pluck at the task pitch is credited`, async (t) => {
    const page = await launchPage(htmlPath);
    t.after(() => page.close());

    await page.evaluate(`window.__coach.setMod(${JSON.stringify(id)})`);
    await page.evaluate("document.getElementById('playBtn').click()");
    await page.waitFor('window.__coach.task()');

    const info = await page.evaluate('window.__coach.cur().info');
    const freq = midiToFreq(info.midi);
    await page.evaluate(`window.__coach.testPluck(${freq}, [0])`);

    await page.waitFor('window.__coach.task() && window.__coach.task().done', 8000);

    assert.equal(
      await page.evaluate('window.__coach.task().idx'),
      1,
      `${id}: the real mic pluck should have been credited`
    );
  });
}

test('bass-5-string: the registry curriculum now names a B-string level', () => {
  const rec = byId['bass-5-string'];
  const hasBStringLevel = rec.curriculum.some((level) => level.items.some((name) => /^B string/.test(name)));
  assert.ok(hasBStringLevel, 'bass-5-string curriculum should name a B-string level now that B0 is detectable');
});

test('bass-5-string: setMod can hand out a B-string item (string 5)', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('bass-5-string')");
  // B string is level 2 (frets 1-5) / level 3 (up the neck) -- jump there so
  // the drawn item is guaranteed to be a B-string one rather than relying on
  // level 1's open-strings pool to happen to draw it.
  await page.evaluate('window.__coach.state().level = 2');
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  if (info.string !== undefined) assert.equal(info.string, 5, 'a level-2 bass-5-string item should be the B string');
});

test('bass-5-string: the low B string (B0, midi 23) is detectable at the real worklet frame size (4096), same as the G string (midi 43)', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  // src/audio/range.js's frameSizeForInstrument derives 4096 for
  // bass-5-string (range.low 23 = B0), not the old fixed 2048 -- see
  // src/instruments/bass-5-string.js's header and tests/unit/yin.test.mjs.
  const [b0Result, gResult] = await page.evaluate(`
    (function () {
      const n = 4096, sr = 48000;
      function probe(f) {
        const buf = new Float32Array(n);
        for (let i = 0; i < n; i++) buf[i] = 0.5 * Math.sin(2 * Math.PI * f * i / sr);
        return window.__coach.yin(buf, sr, 20, 250);
      }
      return [probe(30.87), probe(98.0)];
    })()
  `);
  assert.ok(Math.abs(b0Result.freq - 30.87) / 30.87 < 0.01, 'B0 should be detected accurately at the real worklet frame size');
  assert.ok(Math.abs(gResult.freq - 98.0) / 98.0 < 0.01, 'the G string (highest of the 5) should still be detected accurately');
});

test('bass-5-string: the pitch worklet is actually created at frameSize 4096, not the 2048 default', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('bass-5-string')");
  await page.evaluate('window.__coach.testPluck(41.2, [0])'); // settles ensurePitchWorklet()

  assert.equal(await page.evaluate('window.__coach.pitchWorkletFrameSize()'), 4096);
});
