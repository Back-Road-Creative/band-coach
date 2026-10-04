// Two learner-visible options bugs. (1) "Play in time" never named the notes:
// the prompt stayed "Get ready" and only the first key could light. The prompt
// and the screen-reader description must list every note of the take.
// (2) The Session length list must read No limit / 5 / 10 / 15 minutes as the
// README says (numeric-looking object keys used to sort first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

test('play in time names all four notes in the prompt and the screen-reader text', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.evaluate('window.__coach.grooveOn(true)');
  await page.waitFor("window.__coach.task() && window.__coach.task().kind === 'groove'", 5000);
  const names = await page.evaluate("window.__coach.task().els.map(e => e.info.short || e.info.label.split(':')[0])");
  assert.equal(names.length, 4);
  const prompt = await page.evaluate("document.getElementById('prompt').textContent");
  const desc = await page.evaluate("document.getElementById('cvDesc').textContent");
  assert.ok(prompt.includes(names.join(' → ')), `prompt lists the notes: ${prompt}`);
  assert.match(prompt, /in time/);
  assert.ok(desc.includes(names.join(', ')), `description lists the notes: ${desc}`);
  assert.deepEqual(page.exceptions, []);
});

test('the keyboard lights only the groove notes that are revealed or failed', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.evaluate('window.__coach.grooveOn(true)');
  await page.waitFor("window.__coach.task() && window.__coach.task().kind === 'groove'", 5000);
  // distinct midis so lit/unlit is unambiguous; flags set directly (reveal rule lives in core/reveal.js)
  await page.evaluate("window.__coach.task().els.forEach((x, i) => { x.info.midi = 60 + i; x.reveal = i < 2; x.failed = i === 2; })");
  await page.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))'); // let draw() run with the flags set
  const tg = await page.evaluate('window.__coach.kbdTarget()');
  assert.deepEqual([...tg].sort(), [60, 61, 62]);
  assert.ok(!tg.includes(63), 'an unrevealed, unfailed note stays dark');
  assert.deepEqual(page.exceptions, []);
});

test('the Session length list reads No limit, 5, 10, 15 minutes', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  const vals = await page.evaluate("Array.from(document.getElementById('optSessionMinutes').options).map(o => o.value)");
  assert.deepEqual(vals, ['none', '5', '10', '15']);
});
