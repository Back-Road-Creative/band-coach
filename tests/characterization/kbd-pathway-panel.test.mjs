// The "Your keyboard path" panel (src/ui/pathway.js): a kbd-only button in
// the trainer's options opens a panel listing the five
// src/core/pathway.js steps, marks the current one, and offers ONE action
// that goes there -- proven through real clicks/page reloads, not the
// __coach hook alone, so this proves the shipped app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('song step: the current step is "song", one action opens Hot Cross Buns', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate(`(function () {
    const db = window.__coach.db();
    db.mods.kbd.level = 2;
    db.events = (db.events || []).concat([{ v: 1, id: 'seed-midi', at: Date.now() - 60000, instrument: 'kbd', skill: 'C4', source: 'drill', assistance: 'shown', dims: { pitch: 'ok' }, unassessed: [], activeMs: 0, input: 'midi' }]);
    window.localStorage.setItem('bandcoach.v1', JSON.stringify(db));
  })()`);
  await page.reload();
  await page.evaluate("window.__coach.setMod('kbd')");

  await page.evaluate("document.getElementById('kbdPathwayBtn').click()");
  await page.waitFor("!document.getElementById('panelHost').hidden");

  const lis = await page.evaluate(
    "Array.from(document.querySelectorAll('.pathway-steps li')).map(li => ({ step: li.getAttribute('data-step'), current: li.getAttribute('aria-current'), text: li.textContent }))"
  );
  assert.equal(lis.length, 5, `expected 5 pathway steps, got: ${JSON.stringify(lis)}`);
  const current = lis.filter((li) => li.current === 'step');
  assert.equal(current.length, 1, `expected exactly one current step, got: ${JSON.stringify(lis)}`);
  assert.equal(current[0].step, 'song', `expected current step "song", got: ${JSON.stringify(lis)}`);
  assert.ok(current[0].text.includes('Not yet checked by a player'), `expected the unreviewed label, got: ${current[0].text}`);

  await page.evaluate("document.getElementById('pathwayAction').click()");
  await page.waitFor("document.getElementById('songsPracticeHeading')");
  const heading = await page.evaluate("document.getElementById('songsPracticeHeading').textContent");
  assert.equal(heading, 'Hot Cross Buns', `expected Hot Cross Buns lesson to open, got: ${heading}`);
  assert.deepEqual(page.exceptions, []);
});

test('check step: a logged song session moves the current step to "check", and the action opens Check mode', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate(`(function () {
    const db = window.__coach.db();
    db.mods.kbd.level = 2;
    db.events = (db.events || []).concat([{ v: 1, id: 'seed-midi', at: Date.now() - 60000, instrument: 'kbd', skill: 'C4', source: 'drill', assistance: 'shown', dims: { pitch: 'ok' }, unassessed: [], activeMs: 0, input: 'midi' }]);
    db.sessions = (db.sessions || []).concat([{ d: '2020-01-01', mod: 'kbd', min: 5, acc: 1, a1: 1, a2: 1, from: 2, to: 2, breaks: 0, source: 'song', songId: 'hot-cross-buns' }]);
    window.localStorage.setItem('bandcoach.v1', JSON.stringify(db));
  })()`);
  await page.reload();
  await page.evaluate("window.__coach.setMod('kbd')");

  await page.evaluate("document.getElementById('kbdPathwayBtn').click()");
  await page.waitFor("!document.getElementById('panelHost').hidden");

  const current = await page.evaluate(
    "(document.querySelector('.pathway-steps li[aria-current=\\\"step\\\"]') || {}).getAttribute && document.querySelector('.pathway-steps li[aria-current=\\\"step\\\"]').getAttribute('data-step')"
  );
  assert.equal(current, 'check', `expected current step "check"`);

  await page.evaluate("document.getElementById('pathwayAction').click()");
  await page.waitFor("document.querySelector('.panel-songs-mode button[data-mode=\\\"check\\\"]')");
  const pressed = await page.evaluate(
    "document.querySelector('.panel-songs-mode button[data-mode=\\\"check\\\"]').getAttribute('aria-pressed')"
  );
  assert.equal(pressed, 'true', 'expected Check mode to already be pressed');
  assert.deepEqual(page.exceptions, []);
});

test('setup step: no proof at all, the action goes to the trainer and closes the panel', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.state().level = 2");
  await page.evaluate("window.__coach.setMod('kbd')");

  await page.evaluate("document.getElementById('kbdPathwayBtn').click()");
  await page.waitFor("!document.getElementById('panelHost').hidden");

  const current = await page.evaluate(
    "(document.querySelector('.pathway-steps li[aria-current=\\\"step\\\"]') || {}).getAttribute && document.querySelector('.pathway-steps li[aria-current=\\\"step\\\"]').getAttribute('data-step')"
  );
  assert.equal(current, 'setup', `expected current step "setup"`);

  await page.evaluate("document.getElementById('pathwayAction').click()");
  await page.waitFor("window.__coach.panelOpen() === null");
  const mod = await page.evaluate("window.__coach.db().prefs.mod");
  assert.equal(mod, 'kbd', 'expected the mod to still be kbd after the trainer hand-off');
  assert.deepEqual(page.exceptions, []);
});
