// F6: when the last eight clean drill notes all sit well flat (or sharp), the
// side rail says so and offers the tuner on the instrument's own strings.
// Driven through the real mic pipeline with window.__coach.testPluck, the same
// hook the F8 re-pluck test uses: the task is forced to want the same note
// eight times, and each pluck is a real decaying tone 30 cents flat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
const offer = "(() => { const n = document.getElementById('tuneDrift'); return { hidden: n.hidden, text: document.getElementById('tuneDriftText').textContent }; })()";

async function eightPlucks(t, cents) {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const info = await page.evaluate('window.__coach.cur().info');
  await page.evaluate(`(function () { const t = window.__coach.task(); const e = t.els[0]; t.els = Array.from({ length: 8 }, () => Object.assign({}, e)); })()`);
  const freq = midiToFreq(info.midi) * Math.pow(2, cents / 1200);
  // Twelve attacks for eight notes: an attack landing on a still-ringing
  // string is now and then not heard as a new pluck (6-7 of 8 credit at this
  // spacing), the same as a real player's, so a few spare ones finish the task.
  await page.evaluate(`window.__coach.testPluck(${freq}, ${JSON.stringify(Array.from({ length: 12 }, (_, i) => i * 450))})`);
  await page.waitFor('window.__coach.task() && window.__coach.task().done', 12000);
  return page;
}

test('eight plucks 30 cents flat: the rail says so, and Tune opens the tuner on the guitar', async (t) => {
  const page = await eightPlucks(t, -30);
  const got = await page.evaluate(offer);
  assert.equal(got.hidden, false, 'the tune offer shows');
  assert.match(got.text, /about (25|30|35) cents flat/i, `got: ${JSON.stringify(got.text)}`);
  await page.clickSelector('#tuneDriftGo');
  assert.equal(await page.evaluate("document.querySelector('#picker button[aria-pressed=\"true\"]').dataset.mod"), 'tuner');
  assert.equal(await page.evaluate("document.getElementById('optTune').value"), 'gtr', 'the tuner listens for the guitar strings');
  assert.equal(await page.evaluate("document.getElementById('tuneDrift').hidden"), true);
  assert.deepEqual(await page.evaluate('window.__coach.errors ? window.__coach.errors() : []'), []);
});

test('eight plucks in tune: no offer', async (t) => {
  const page = await eightPlucks(t, 0);
  assert.equal((await page.evaluate(offer)).hidden, true);
});

test('Not now hides the offer for the rest of the session', async (t) => {
  const page = await eightPlucks(t, -30);
  assert.equal((await page.evaluate(offer)).hidden, false);
  await page.clickSelector('#tuneDriftSkip');
  assert.equal((await page.evaluate(offer)).hidden, true);
  assert.equal(await page.evaluate('window.__coach.mod ? window.__coach.mod() : document.querySelector(\'#picker button[aria-pressed="true"]\').dataset.mod'), 'gtr', 'skipping stays in the drill');
});
