// Starting the captured-melody drill must not replace the coach line with the level plan
// (which also promises "tomorrow's plan builds from it" for a drill that does not count).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

test('Start on the captured-melody drill keeps the drill wording, no level plan', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('capture')");
  await page.evaluate("window.__coach.cap().notes.push({ m: 60, t: 0, d: 0.4 }, { m: 62, t: 0.5, d: 0.4 }, { m: 64, t: 1, d: 0.4 })");
  await page.waitFor("document.getElementById('capDrill')");
  await page.evaluate("document.getElementById('capDrill').click()");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor("document.getElementById('playBtn').textContent === 'Pause'");
  const coach = await page.evaluate("document.getElementById('coach').textContent");
  assert.doesNotMatch(coach, /tomorrow|Level \d/);
  assert.match(coach, /captured/i);
});
