// P2a: one always-visible, plain-language nav bar (Practice/Songs/Progress)
// so a learner never has to discover "More ways to practise" (removed for
// good in P2b-3) to find their songs or their practice history. routeTo()
// is the nav's only entry point; openPanel()/closePanel() keep the nav
// honest no matter how a panel was actually reached (old picker, a panel's
// own back control, or the nav itself).
// P2b-1: a fourth button, Instrument, joins the row -- it opens/shuts the
// instrument chooser sheet (#picker) rather than routing to a panel, so it
// never claims aria-current and never disturbs whatever panel is open.
// P2b-2: a fifth button, Settings, joins the row -- unlike Instrument it IS
// a real destination (see tests/characterization/settings-view.test.mjs for
// its own behaviour); this file only proves it takes its place in the bar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('the nav bar shows exactly Practice, Songs, Progress, Instrument in order, Practice current at boot', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const labels = await page.evaluate("Array.from(document.querySelectorAll('#mainNav button')).map(b => b.textContent.trim())");
  assert.equal(labels.length, 5);
  assert.deepEqual(labels.slice(0, 3), ['Practice', 'Songs', 'Progress']);
  assert.match(labels[3], /^(Choose an instrument|Instrument: )/, 'the fourth button is the Instrument control: ' + JSON.stringify(labels[3]));
  assert.equal(labels[4], 'Settings', 'the fifth button is Settings');
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"practice\"]').getAttribute('aria-current')"), 'page');
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"songs\"]').getAttribute('aria-current')"), null);
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"progress\"]').getAttribute('aria-current')"), null);
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"instrument\"]').getAttribute('aria-current')"), null, 'Instrument is never "current" -- it opens a sheet, not a destination');
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"settings\"]').getAttribute('aria-current')"), null);
});

test('clicking Songs opens the songs panel and marks Songs current', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("document.querySelector('#mainNav button[data-route=\"songs\"]').click()");
  assert.equal(await page.evaluate("document.getElementById('mainArea').hidden"), true);
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'songs');
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"songs\"]').getAttribute('aria-current')"), 'page');
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"practice\"]').getAttribute('aria-current')"), null);
});

test('clicking Progress opens the history panel and marks Progress current', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("document.querySelector('#mainNav button[data-route=\"progress\"]').click()");
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'history');
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"progress\"]').getAttribute('aria-current')"), 'page');
});

test('clicking Practice closes whatever panel is open and marks Practice current', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("document.querySelector('#mainNav button[data-route=\"songs\"]').click()");
  await page.waitFor("window.__coach.panelOpen() === 'songs'");

  await page.evaluate("document.querySelector('#mainNav button[data-route=\"practice\"]').click()");
  const openPanel = await page.evaluate('window.__coach.panelOpen()');
  assert.ok(openPanel === null || openPanel === undefined, `panelOpen() should be null/undefined, was ${JSON.stringify(openPanel)}`);
  assert.equal(await page.evaluate("document.getElementById('mainArea').hidden"), false);
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"practice\"]').getAttribute('aria-current')"), 'page');
});

test('a panel opened through the instrument sheet\'s Tools group (not a nav destination) leaves no nav button current, and closing it restores Practice', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());

  await page.evaluate("document.getElementById('navInstrument').click()");
  await page.waitFor("document.getElementById('picker').hidden === false");
  await page.evaluate("document.querySelector('#picker .picker-tools button[data-panel=\"theory\"]').click()");
  await page.waitFor("window.__coach.panelOpen() === 'theory'");
  const anyCurrent = await page.evaluate("!!document.querySelector('#mainNav button[aria-current]')");
  assert.equal(anyCurrent, false, 'no nav button should claim to be current for a panel the nav does not route to');

  await page.evaluate('window.__coach.closePanel()');
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"practice\"]').getAttribute('aria-current')"), 'page');
});

test('clicking Instrument while Songs is open opens the sheet but leaves Songs current and its panel open', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());

  await page.evaluate("document.querySelector('#mainNav button[data-route=\"songs\"]').click()");
  await page.waitFor("window.__coach.panelOpen() === 'songs'");

  await page.evaluate("document.getElementById('navInstrument').click()");

  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'songs', 'Songs panel stays open');
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"songs\"]').getAttribute('aria-current')"), 'page', 'Songs stays current');
  assert.equal(await page.evaluate("document.getElementById('picker').hidden"), false, 'the instrument sheet opens');
});

// browser.mjs's page handle has no real keyboard-dispatch primitive (only
// evaluate/waitFor/etc -- see tests/helpers/browser.mjs), so this proves the
// thing an un-tricked Tab order actually depends on: the nav's buttons sit
// earlier in plain DOM/focusable order than #picker's, with no tabindex
// override that could fake or break that order.
test('the nav buttons sit before #picker in DOM/focus order, with no tabindex tricks', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const navTabindexes = await page.evaluate("Array.from(document.querySelectorAll('#mainNav button')).map(b => b.getAttribute('tabindex'))");
  navTabindexes.forEach((tv) => assert.equal(tv, null, 'a nav button must not carry a tabindex override'));

  const order = await page.evaluate(`(function () {
    var all = Array.from(document.querySelectorAll('button, [href], input, select, textarea, [tabindex]'));
    return {
      navFirst: all.findIndex(function (el) { return el.closest('#mainNav'); }),
      pickerFirst: all.findIndex(function (el) { return el.closest('#picker'); }),
    };
  })()`);
  assert.ok(order.navFirst > -1, 'the nav has at least one focusable element');
  assert.ok(order.pickerFirst > -1, '#picker has at least one focusable element');
  assert.ok(order.navFirst < order.pickerFirst, "the nav's buttons must come before #picker's in tab order");
});
