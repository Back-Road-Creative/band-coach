// Acceptance: the Practice screen after a learner ends a session, and the two
// level buttons. On the release file with real clicks and computer-key presses;
// only DOM text is asserted. A seeded profile stands in for "skipped ahead,
// then came back" (the initScript re-seeds on each document load).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';

const KEY_FOR = { C: 'a', D: 's', E: 'd', F: 'f', G: 'g', A: 'h', B: 'j', 'C (high)': 'k' };
const LEVEL_3_SEED = `localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'kbd' }, mods: { kbd: { level: 3 } } }));`;
const text = (page, id) => page.evaluate(`document.getElementById(${JSON.stringify(id)}).textContent.trim()`);
const hidden = (page, id) => page.evaluate(`document.getElementById(${JSON.stringify(id)}).hidden`);

test('a profile above level 1 with no answers yet says its own level, not "Level 1"', async (t) => {
  await withAcceptancePage(t, { initScript: LEVEL_3_SEED }, async (page) => {
    await page.waitFor("/^Press Start\\./.test(document.getElementById('coach').textContent)");
    assert.equal(await text(page, 'levelNum'), 'Level 3');
    assert.match(await text(page, 'coach'), /^Press Start\. Level 3: /);
  });
});

test('Make it easier at level 1 says it is already the easiest level', async (t) => {
  await withAcceptancePage(t, {}, async (page) => {
    await page.clickSelector('#picker button[data-mod="kbd"]');
    const before = await text(page, 'coach');
    await page.clickSelector('#easierBtn');
    await page.waitFor("/already on level 1/.test(document.getElementById('coach').textContent)");
    assert.notEqual(await text(page, 'coach'), before);
    assert.equal(await text(page, 'levelNum'), 'Level 1');
  });
});

test('End session clears the answer card, the time bar, the how-to peek and the seconds stat', async (t) => {
  await withAcceptancePage(t, {}, async (page) => {
    await page.clickSelector('#picker button[data-mod="kbd"]');
    await page.clickSelector('#playBtn');
    await page.waitFor("document.querySelector('#prompt b')");
    const label = await text(page, 'prompt').then((p) => p.replace(/^Play /, ''));
    await page.press(KEY_FOR[label], { text: KEY_FOR[label] });
    await page.waitFor("document.getElementById('feedback').textContent.trim() !== ''");
    await page.clickSelector('#endBtn');
    await page.waitFor("document.getElementById('playBtn').textContent.trim() === 'Start'");
    assert.equal(await text(page, 'feedback'), '', 'the last answer is not left under PRESS START');
    assert.equal(await hidden(page, 'feedbackCard'), true);
    assert.equal(await page.evaluate("document.getElementById('timeFill').style.width"), '0%', 'the answer-time bar is empty');
    assert.equal(await hidden(page, 'showMeBtn'), true, 'Show me has no note to show');
    assert.equal(await hidden(page, 'howPeekHost'), true, 'no how-to-play peek for a note no longer asked');
    assert.notEqual(await text(page, 'sRt'), '0.0', 'no answers in view is not "0.0 sec"');
  });
});

test('Skip ahead after an answer clears the old answer card', async (t) => {
  await withAcceptancePage(t, {}, async (page) => {
    await page.clickSelector('#picker button[data-mod="kbd"]');
    await page.clickSelector('#playBtn');
    await page.waitFor("document.querySelector('#prompt b')");
    const label = await text(page, 'prompt').then((p) => p.replace(/^Play /, ''));
    await page.press(KEY_FOR[label], { text: KEY_FOR[label] });
    await page.waitFor("document.getElementById('feedback').textContent.trim() !== ''");
    await page.clickSelector('#harderBtn');
    assert.equal(await text(page, 'feedback'), '', 'the old answer is not left under the new level');
    assert.equal(await hidden(page, 'feedbackCard'), true);
  });
});

test('the keyboard path panel keeps Practice highlighted and spaces its button from the steps', async (t) => {
  await withAcceptancePage(t, {}, async (page) => {
    await page.clickSelector('#picker button[data-mod="kbd"]');
    await page.clickSelector('#kbdPathwayBtn');
    await page.waitFor("document.getElementById('pathwayAction')");
    assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"practice\"]').getAttribute('aria-current')"), 'page', 'reached from Practice, so Practice stays current');
    const gap = await page.evaluate("document.getElementById('pathwayAction').getBoundingClientRect().top - document.querySelector('.pathway-steps').getBoundingClientRect().bottom");
    assert.ok(gap >= 8, 'the action button is not flush against the last step (gap ' + gap + 'px)');
    const widths = await page.evaluate("[document.querySelector('.pathway-steps').getBoundingClientRect().width, document.querySelector('.panel-pathway').getBoundingClientRect().width]");
    assert.ok(widths[0] >= widths[1] - 1, 'the step list spans the panel (' + widths[0] + ' of ' + widths[1] + 'px)');
    await page.clickSelector('#mainNav button[data-route="practice"]');
    assert.equal(await hidden(page, 'panelHost'), true, 'pressing Practice from the path panel goes back to the exercise');
  });
});
