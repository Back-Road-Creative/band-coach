// Descant recorder and tin whistle (src/instruments/recorder-descant.js,
// tin-whistle.js) ship status: 'ready' with their own MODS['recorder-descant']
// / MODS['tin-whistle'] entries in src/app.js -- this drives each one end to
// end the same way tests/characterization/mallet-percussion-playable.test.mjs
// does for mallet percussion: select it, get a task, answer the correct note
// through the window.__coach debug hook and see it credited, then confirm the
// real audio pipeline (testSource, the same held-tone technique
// tests/characterization/wind-octave-policy.test.mjs uses for MODS.wind/voice,
// since both instruments are input: 'sustain' -- a blown note is held, not
// struck, so testPluck's attack/decay envelope does not apply here) detects a
// task note too.
//
// Both records sound a full octave above how beginner method books notate
// them (see recorder-descant.js's header) -- these tests exercise the record
// and MODS entry's SOUNDING pitch (range 72-86 for recorder, 74-86 for the
// whistle's first octave), which is what the microphone actually hears.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { byId } from '../../src/instruments/index.js';

const htmlPath = HTML_PATH;
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

const IDS = ['recorder-descant', 'tin-whistle'];

for (const id of IDS) {
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

  test(`${id}: a real (synthesized-tone) microphone hold at the task pitch is credited`, async (t) => {
    const page = await launchPage(htmlPath);
    t.after(() => page.close());

    await page.evaluate(`window.__coach.setMod(${JSON.stringify(id)})`);
    await page.evaluate("document.getElementById('playBtn').click()");
    await page.waitFor('window.__coach.task()');

    const info = await page.evaluate('window.__coach.cur().info');
    const freq = midiToFreq(info.midi);
    await page.evaluate(`window.__coach.testSource([${freq}])`);

    await page.waitFor('window.__coach.task() && window.__coach.task().done', 8000);

    assert.equal(
      await page.evaluate('window.__coach.task().idx'),
      1,
      `${id}: the real audio pipeline should have credited the held tone`
    );
  });
}

test('recorder-descant and tin-whistle: the registry range is sounding pitch, an octave above the written B-A-G / D-E-F# beginner range', () => {
  const recorder = byId['recorder-descant'];
  const whistle = byId['tin-whistle'];
  assert.equal(recorder.range.low, 72, 'descant recorder sounding low: C5');
  assert.equal(recorder.transposition, 12, 'written = sounding - 12');
  assert.equal(whistle.range.low, 74, 'D tin whistle sounding low: D5');
  assert.equal(whistle.transposition, 12, 'written = sounding - 12');
});

test('high whistle pitches (587-1175 Hz, the D5-D6 first octave) are detectable by the real pitch detector at the mod\'s own frame size', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const results = await page.evaluate(`
    (function () {
      const n = 2048, sr = 48000;
      function probe(f) {
        const buf = new Float32Array(n);
        for (let i = 0; i < n; i++) buf[i] = 0.5 * Math.sin(2 * Math.PI * f * i / sr);
        return window.__coach.yin(buf, sr, 300, 1600);
      }
      return [probe(587.33), probe(1174.66)];
    })()
  `);
  assert.ok(Math.abs(results[0].freq - 587.33) / 587.33 < 0.01, 'D5 (587Hz, the whistle\'s lowest note) should be detected accurately');
  assert.ok(Math.abs(results[1].freq - 1174.66) / 1174.66 < 0.01, 'D6 (1175Hz, the whistle\'s first-octave top note) should be detected accurately');
});
