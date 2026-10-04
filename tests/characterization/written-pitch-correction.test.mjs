// Transposing winds: the wrong-note correction names notes in the WRITTEN key, like the prompt,
// the staff and the pass message. Before: a trumpeter asked to "Play C4" who sounded F4 was told
// "You are on F, the note is B♭" (concert names, neither of which is on the screen).
// Drives the real onPitch through the dev hook window.__coach.pitchFrame, as after-pass-ring does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const frame = (m) => ({ rms: 0.3, freq: 440 * Math.pow(2, (m - 69) / 12), midi: m, clarity: 0.95, onset: false });

async function wrongNote(t, mod, heard) {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate(`window.__coach.setMod('${mod}')`);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task() && window.__coach.cur()');
  await page.evaluate('window.__coach.task().limit = 1e9');
  const info = await page.evaluate('window.__coach.cur().info');
  // The listen check and the three frames run in ONE synchronous call: with a round trip per frame,
  // a slow runner let the app go deaf (its own sound playing) between frames and drop them, so the
  // correction never came. A call that lands while deaf sends nothing and is retried.
  await page.waitFor(`(() => { if (window.__coach.deaf()) return false; for (let k = 0; k < 3; k++) window.__coach.pitchFrame(${JSON.stringify(frame(heard(info)))}, 0.5); return document.getElementById('feedback').className === 'no'; })()`);
  return { info, text: await page.evaluate("document.getElementById('feedback').textContent") };
}

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
test('trumpet (B flat): a wrong note is named at written pitch', async (t) => {
  // sound a whole tone-and-a-half above the target: written target + 3 + 2 (the transposition) names
  const { info, text } = await wrongNote(t, 'trumpet-bb', (i) => i.midi + 3);
  assert.match(text, new RegExp('You are on ' + NAMES[(info.written + 3) % 12] + ', the note is ' + info.short.replace(/\d+$/, '') + '\\.'), text);
});
test('French horn (F): a wrong note is named at written pitch', async (t) => {
  const { info, text } = await wrongNote(t, 'horn-f', (i) => i.midi + 2);
  assert.match(text, new RegExp('You are on ' + NAMES[(info.written + 2) % 12] + ', the note is ' + info.short.replace(/\d+$/, '') + '\\.'), text);
});
