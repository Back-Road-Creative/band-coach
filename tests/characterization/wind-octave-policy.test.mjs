// E-wind-octave: the sustained-note judging path (src/app.js onPitch, M.input
// === 'sustain') decided whether to fold cents to +/-600 (any octave counts)
// using an ad hoc `M.exactPitch` flag that only harp ever set, instead of the
// instrument's real octavePolicy (src/instruments/wind.js: 'exact', voice.js:
// 'nearest-octave', both already exported as OCTAVE_POLICY from
// src/core/judge.js and already imported into app.js for the pluck path).
// So a wind target held a whole octave off always passed, contradicting the
// instrument's own declared policy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

test('octave-exact: a wind target held one octave off is judged incorrect', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('wind')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  const freqUp = midiToFreq(info.midi + 12);
  await page.evaluate(`window.__coach.testSource([${freqUp}])`);
  await page.waitFor("document.getElementById('feedback').className !== ''", 8000);

  assert.equal(
    await page.evaluate("document.getElementById('feedback').className"),
    'no',
    'wind has octavePolicy exact: the right note a whole octave off must not pass'
  );
});

test('nearest-octave: a voice target held one octave off is judged correct', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('voice')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  const freqUp = midiToFreq(info.midi + 12);
  await page.evaluate(`window.__coach.testSource([${freqUp}])`);
  await page.waitFor("document.getElementById('feedback').className !== ''", 8000);

  assert.equal(
    await page.evaluate("document.getElementById('feedback').className"),
    'ok',
    'voice has octavePolicy nearest-octave: any octave must pass'
  );
});
