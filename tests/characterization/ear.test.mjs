// CURRENT BEHAVIOUR: ear training judges by __coach.answer(id) (band-coach.html:479).
// A correct id passes ("ok"); a wrong choice fails ("no") and adds a key to
// the confusion counter state().conf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('ear training: right id passes, wrong id fails and grows the confusion map', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('ear')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const rightId = await page.evaluate('window.__coach.cur().id');
  await page.evaluate(`window.__coach.answer(${JSON.stringify(rightId)})`);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");

  await page.waitFor('window.__coach.task() && !window.__coach.task().done');
  const confBefore = await page.evaluate('Object.keys(window.__coach.state().conf).length');
  const choices = await page.evaluate('window.__coach.task().choices');
  const correct2 = await page.evaluate('window.__coach.cur().id');
  const wrongId = choices.find((c) => c !== correct2);
  assert.ok(wrongId, 'ear training offers at least two choices');

  await page.evaluate(`window.__coach.answer(${JSON.stringify(wrongId)})`);
  await page.waitFor("document.getElementById('feedback').className === 'no'");

  const confAfter = await page.evaluate('Object.keys(window.__coach.state().conf).length');
  assert.ok(confAfter > confBefore, `a wrong ear-training answer should grow state().conf (${confBefore} -> ${confAfter})`);
});
