// Composes #254's Carry on feature (tests/characterization/songs-resume.test.mjs)
// across nav destinations, keyboard only, with no `.click()` on the learner
// path: a learner opens Hot Cross Buns from Songs, advances one step, leaves
// through the nav to Practice, comes back to Songs through the nav, and
// Carry on is there waiting -- proving the saved place survives a real
// navigation away and back, not just a page reload (songs-resume only
// reloads). It does not repeat songs-resume's same-panel assertions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

// tabTo() from tests/helpers/journey.mjs matches a CSS selector; the Songs
// row buttons and the practice screen's own buttons share a class with many
// siblings and are told apart only by their text (the row's song title, or
// "Next"), so this walks the browser's real Tab order the same way but
// checks activeElement's own text instead of a selector.
async function tabToText(page, selector, text, maxPresses = 60) {
  for (let i = 1; i <= maxPresses; i++) {
    await page.press('Tab');
    const ok = await page.evaluate(
      `(() => { const el = document.activeElement; return el.matches(${JSON.stringify(selector)}) && el.textContent === ${JSON.stringify(text)}; })()`
    );
    if (ok) return i;
  }
  const got = await page.evaluate('document.activeElement.outerHTML || document.activeElement.tagName');
  throw new Error(`tabToText: ${selector} "${text}" not reached within ${maxPresses} Tab presses (last landed on ${got})`);
}

// Steps 1-3 of the P7-3 journey: open Hot Cross Buns from Songs, advance one
// step (Listen -> Clap the rhythm, same as songs-resume's own helper), then
// leave to Practice and come back to Songs, both through the nav -- proving
// the saved lesson place survives a real navigation, not a page reload.
async function leaveAndReturnMidLesson(page) {
  await tabToText(page, '#mainNav button[data-route="songs"]', 'Songs');
  await page.press('Enter');
  await page.waitFor("window.__coach.panelOpen() === 'songs'");

  await tabToText(page, '.panel-songs-row button', 'Hot Cross Buns');
  await page.press('Enter');
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  assert.match(
    await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent"),
    /^Listen/,
    'Hot Cross Buns opens on its first step',
  );

  await tabToText(page, '.panel-songs-practice button', 'Next');
  await page.press('Enter');
  await page.waitFor("document.querySelector('.panel-songs-practice h4').textContent.startsWith('Clap the rhythm')");

  await tabToText(page, '#mainNav button[data-route="practice"]', 'Practice');
  await page.press('Enter');
  await page.waitFor("window.__coach.panelOpen() === null");
  assert.equal(
    await page.evaluate("document.querySelector('#mainNav button[data-route=\"practice\"]').getAttribute('aria-current')"),
    'page',
    'Practice takes over aria-current after leaving Songs',
  );
  assert.equal(
    await page.evaluate("document.querySelector('#mainNav button[data-route=\"songs\"]').getAttribute('aria-current')"),
    null,
    'Songs is no longer current once Practice is',
  );

  await tabToText(page, '#mainNav button[data-route="songs"]', 'Songs');
  await page.press('Enter');
  await page.waitFor("window.__coach.panelOpen() === 'songs'");
  assert.equal(
    await page.evaluate("document.querySelector('#mainNav button[data-route=\"songs\"]').getAttribute('aria-current')"),
    'page',
    'Songs is current again on return',
  );
  assert.equal(
    await page.evaluate("document.querySelector('#mainNav button[data-route=\"practice\"]').getAttribute('aria-current')"),
    null,
    'Practice gives up aria-current once Songs takes it back',
  );
}

test('a song left for Practice offers Carry on when you come back', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await leaveAndReturnMidLesson(page);

  await page.waitFor("document.querySelector('.panel-songs-carry-on') && !document.querySelector('.panel-songs-carry-on').hidden");
  const label = await page.evaluate("document.querySelector('.panel-songs-carry-on').textContent");
  assert.ok(label.includes('Hot Cross Buns'), 'names the lesson left mid-way: ' + label);

  await tabToText(page, '.panel-songs-carry-on', label);
  await page.press('Enter');
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  const stepTitle = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.ok(stepTitle.startsWith('Clap the rhythm'), 'Carry on lands on the step it was left on: ' + stepTitle);
  const said = await page.evaluate("document.getElementById('panelSay').textContent");
  assert.equal(said, 'Picking up where you left off.');

  assert.deepEqual(page.exceptions, []);
});

test('Carry on resumes by keyboard alone', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await leaveAndReturnMidLesson(page);

  await page.waitFor("document.querySelector('.panel-songs-carry-on') && !document.querySelector('.panel-songs-carry-on').hidden");
  const stopsToCarryOn = await tabToText(page, '.panel-songs-carry-on', await page.evaluate("document.querySelector('.panel-songs-carry-on').textContent"));
  assert.ok(stopsToCarryOn >= 1, 'Carry on is a real Tab stop, not skipped over');
  assert.equal(
    await page.evaluate("document.activeElement === document.querySelector('.panel-songs-carry-on')"),
    true,
    'focus is actually on Carry on before it is activated',
  );

  await page.press('Enter');
  await page.waitFor("document.querySelector('.panel-songs-practice h4').textContent.startsWith('Clap the rhythm')");

  assert.deepEqual(page.exceptions, []);
});
