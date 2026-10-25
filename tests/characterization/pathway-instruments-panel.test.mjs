// F19: "Your first week" for a microphone instrument (src/ui/pathway.js
// reading src/instruments/first-week.js): the flute's options carry the
// button, the panel lists six steps each labelled practice-grade, marks the
// current one and offers ONE action -- through real clicks, so this proves
// the shipped app. The keyboard's own five-step panel is
// tests/characterization/kbd-pathway-panel.test.mjs, unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const LABEL = 'practice-grade (mic, not yet checked by a player)';
const STEPS = "Array.from(document.querySelectorAll('.pathway-steps li')).map(li => ({ step: li.getAttribute('data-step'), current: li.getAttribute('aria-current'), text: li.textContent }))";

test('flute, nothing heard yet: six labelled steps, setup is current, the action goes to the flute trainer', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('flute')");
  assert.equal(await page.evaluate("!!document.getElementById('kbdPathwayBtn')"), false, 'no keyboard path button on the flute');
  await page.evaluate("document.getElementById('pathwayBtn').click()");
  await page.waitFor("!document.getElementById('panelHost').hidden");

  const lis = await page.evaluate(STEPS);
  assert.deepEqual(lis.map((li) => li.step), ['setup', 'lesson', 'song', 'check', 'return', 'transfer'], JSON.stringify(lis));
  assert.ok(lis.every((li) => li.text.includes(LABEL)), `every step carries the label: ${JSON.stringify(lis)}`);
  assert.deepEqual(lis.filter((li) => li.current === 'step').map((li) => li.step), ['setup']);
  assert.ok(lis[0].text.includes('Flute'), lis[0].text);
  assert.match(await page.evaluate("document.getElementById('pathwayHeading').textContent"), /Flute/);

  await page.evaluate("window.__coach.db().prefs.mod = 'decoy'");
  await page.evaluate("document.getElementById('pathwayAction').click()");
  assert.equal(await page.evaluate("window.__coach.db().prefs.mod"), 'flute');
  assert.deepEqual(page.exceptions, []);
});

test('flute with a mic row and a song session: check is current, the action opens Check mode on a fitting song', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await page.evaluate(`(function () {
    const db = window.__coach.db();
    db.mods.flute = Object.assign({}, db.mods.flute, { level: 3 });
    db.events = (db.events || []).concat([{ v: 1, id: 'seed-mic', at: Date.now() - 60000, instrument: 'flute', skill: 'w60', source: 'drill', assistance: 'shown', dims: { pitch: 'ok' }, unassessed: [], activeMs: 0, input: 'mic' }]);
    db.sessions = (db.sessions || []).concat([{ d: '2020-01-01', mod: 'flute', min: 5, acc: 1, a1: 1, a2: 1, from: 3, to: 3, breaks: 0, source: 'song', songId: 'hot-cross-buns' }]);
    window.localStorage.setItem('bandcoach.v1', JSON.stringify(db));
  })()`);
  await page.reload();
  await page.evaluate("window.__coach.setMod('flute')");
  await page.evaluate("document.getElementById('pathwayBtn').click()");
  await page.waitFor("!document.getElementById('panelHost').hidden");

  const lis = await page.evaluate(STEPS);
  assert.deepEqual(lis.filter((li) => li.current === 'step').map((li) => li.step), ['check'], JSON.stringify(lis));

  await page.evaluate("document.getElementById('pathwayAction').click()");
  await page.waitFor("document.querySelector('.panel-songs-mode button[data-mode=\\\"check\\\"]')");
  assert.equal(await page.evaluate("document.querySelector('.panel-songs-mode button[data-mode=\\\"check\\\"]').getAttribute('aria-pressed')"), 'true');
  assert.equal(await page.evaluate("document.getElementById('songsPracticeHeading').textContent"), 'Hot Cross Buns');
  assert.deepEqual(page.exceptions, []);
});

test('an instrument no starter song fits (oboe) shows no path button', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('oboe')");
  assert.equal(await page.evaluate("!!document.getElementById('pathwayBtn')"), false);
  assert.deepEqual(page.exceptions, []);
});
