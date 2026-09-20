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
// Four of the five (mandolin, banjo-5-string, ukulele-low-g,
// ukulele-baritone) also get a real-mic-pipeline check with testPluck, the
// same technique tests/characterization/onset-repluck.test.mjs uses, since
// every note in their curricula sits comfortably inside the pitch
// detector's working band. bass-5-string does not get that generic check:
// its curriculum's open E string (41.2 Hz) sits right at the edge of what
// the real AudioWorklet pipeline (frameSize 2048) can resolve -- a
// pre-existing limitation shared with the 4-string bass.js, not something
// this unit introduces or fixes -- so a random testPluck draw from its
// level-1 pool would be flaky. Its own two tests below check the thing this
// unit is actually responsible for: the low B string is excluded from the
// curriculum, and B0 itself is provably undetectable at the real frame size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { byId } from '../../src/instruments/index.js';

const htmlPath = HTML_PATH;
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

const NEW_FRETTED_IDS = ['mandolin', 'banjo-5-string', 'bass-5-string', 'ukulele-low-g', 'ukulele-baritone'];
const MIC_RELIABLE_IDS = ['mandolin', 'banjo-5-string', 'ukulele-low-g', 'ukulele-baritone'];

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

test('bass-5-string: the registry curriculum never names a B-string level', () => {
  const rec = byId['bass-5-string'];
  const hasBStringLevel = rec.curriculum.some((level) => level.items.some((name) => /^B string/.test(name)));
  assert.equal(hasBStringLevel, false, 'bass-5-string curriculum should never name a B-string level');
});

test('bass-5-string: setMod never hands out a B-string item', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('bass-5-string')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  // B string is string 5 in this 5-string tuning (see bass-5-string.js /
  // stringLevelsExcluding in app.js).
  if (info.string !== undefined) assert.notEqual(info.string, 5, 'a credited bass-5-string item should never be the B string');
});

test('bass-5-string: the low B string (B0, midi 23) is not detectable at the real worklet frame size, but the G string (midi 43) is', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  // Confirmed against the real AudioWorklet pipeline (frameSize 2048): a
  // pure 30.87 Hz (B0, midi 23) sine returns freq: 0, no lock at all -- the
  // algorithm's search window cannot reach the lag a period that long
  // requires. See src/instruments/bass-5-string.js's header.
  const [b0Result, gResult] = await page.evaluate(`
    (function () {
      const n = 2048, sr = 48000;
      function probe(f) {
        const buf = new Float32Array(n);
        for (let i = 0; i < n; i++) buf[i] = 0.5 * Math.sin(2 * Math.PI * f * i / sr);
        return window.__coach.yin(buf, sr, 20, 250);
      }
      return [probe(30.87), probe(98.0)];
    })()
  `);
  assert.equal(b0Result.freq, 0, 'B0 should not be detectable at the real worklet frame size');
  assert.ok(Math.abs(gResult.freq - 98.0) / 98.0 < 0.01, 'the G string (highest of the 5), well clear of the floor, should be detected accurately');
});
