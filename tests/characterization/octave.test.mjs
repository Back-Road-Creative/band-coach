// Proves the octave-policy fix (src/core/judge.js) end to end through a real
// microphone frame: window.__coach.testSource(freqs) feeds a synthetic tone
// into the same analyser + yin pitch-detection path a real pluck uses
// (src/app.js: wireAnalysers / listen()), rather than calling onNote directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

test('octave-exact: gtr passes a right-octave synthetic tone from the microphone', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  assert.ok(info.string, 'level-1 gtr items are string/fret notes');

  const freq = midiToFreq(info.midi);
  await page.evaluate(`window.__coach.testSource([${freq}])`);
  await page.waitFor("document.getElementById('feedback').className !== ''", 8000);

  assert.equal(
    await page.evaluate("document.getElementById('feedback').className"),
    'ok',
    'a clean tone at the target midi, in the right octave, is judged correct'
  );
});

test('octave-exact: gtr rejects the same synthetic tone one octave up', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  assert.ok(info.string, 'level-1 gtr items are string/fret notes');

  const freqUp = midiToFreq(info.midi + 12);
  await page.evaluate(`window.__coach.testSource([${freqUp}])`);
  await page.waitFor("document.getElementById('feedback').className !== ''", 8000);

  assert.equal(
    await page.evaluate("document.getElementById('feedback').className"),
    'no',
    'the same pitch class one octave up is judged incorrect'
  );
});

test('UI honesty: the string/fret hint says the mic checks octave, not the string', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  assert.ok(info.string, 'level-1 gtr items are string/fret notes');

  const hint = await page.evaluate("document.getElementById('hint').textContent");
  assert.match(hint, /mic checks the note and its octave.*not which string/);
});
