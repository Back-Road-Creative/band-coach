// CURRENT BEHAVIOUR: exercise choice has no randomness (band-coach.html has
// no Math.random call anywhere — grep confirms it). Two fresh profiles fed
// the identical answer script must produce the identical sequence of task
// item ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;
const N = 8;

async function runScript(page) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  const ids = [];
  for (let i = 0; i < N; i++) {
    await page.waitFor('window.__coach.task() && !window.__coach.task().done');
    const id = await page.evaluate('window.__coach.cur().id');
    ids.push(id);
    const midi = await page.evaluate('window.__coach.cur().info.midi');
    await page.evaluate(`window.__coach.note(${midi}, true)`);
    await page.waitFor("window.__coach.task().done || window.__coach.task().idx > 0");
  }
  return ids;
}

test('identical answer scripts on fresh profiles produce identical task sequences', async (t) => {
  const pageA = await launchPage(htmlPath);
  t.after(() => pageA.close());
  const idsA = await runScript(pageA);

  const pageB = await launchPage(htmlPath);
  t.after(() => pageB.close());
  const idsB = await runScript(pageB);

  assert.equal(idsA.length, N);
  assert.deepEqual(idsB, idsA, 'same script on a fresh profile must pick the same items');
});
