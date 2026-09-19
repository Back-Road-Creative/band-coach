// CURRENT BEHAVIOUR: the keyboard mode's basic judging loop — a right answer
// marks the on-screen feedback "ok" and raises that item's mastery, a wrong
// answer marks it "no" and flags the current element failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('keyboard happy path: right note passes, wrong note fails', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const midi = await page.evaluate('window.__coach.cur().info.midi');
  const id = await page.evaluate('window.__coach.cur().id');
  const masteryBefore = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}]?.m ?? 0.4`);

  await page.evaluate(`window.__coach.note(${midi}, true)`);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");

  const masteryAfter = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}].m`);
  assert.ok(masteryAfter > masteryBefore, `mastery should rise after a right answer (${masteryBefore} -> ${masteryAfter})`);

  // Move to the next task, then answer it wrong on purpose.
  await page.waitFor('window.__coach.task() && !window.__coach.task().done');
  const wrongMidi = await page.evaluate('window.__coach.cur().info.midi');
  const badNote = wrongMidi === 60 ? 61 : 60; // any pitch class that is not the target
  await page.evaluate(`window.__coach.note(${badNote}, true)`);
  await page.waitFor("document.getElementById('feedback').className === 'no'");

  assert.equal(await page.evaluate('window.__coach.cur().failed'), true, 'the missed element is flagged failed');
});
