// "My progress" panel (src/ui/history.js): summarizes DB.sessions in plain
// words, shows per-item strongest/weakest/due entries, and offers a
// clipboard-or-select copy of a teacher summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

async function seed(page) {
  await page.evaluate(`(function () {
    const db = window.__coach.db();
    db.sessions = [
      { d: '2026-09-10', mod: 'kbd', min: 12, acc: 0.7, a1: 0.6, a2: 0.7, from: 1, to: 2, breaks: 0 },
      { d: '2026-09-17', mod: 'kbd', min: 15, acc: 0.9, a1: 0.8, a2: 0.95, from: 2, to: 3, breaks: 0 },
      { d: '2026-09-18', mod: 'gtr', min: 8, acc: 0.5, a1: 0.4, a2: 0.5, from: 1, to: 1, breaks: 1 },
    ];
    db.mods.kbd.item = {
      n60: { m: 0.95, n: 10, last: Date.now() - 86400000, seen: 5 },
      n62: { m: 0.2, n: 6, last: Date.now() - 30 * 86400000, seen: 5 },
    };
    window.localStorage.setItem('bandcoach.v1', JSON.stringify(db));
  })()`);
  await page.reload();
  await page.waitFor('window.__coach && window.__coach.db().mods.kbd', 5000);
}

test('the history panel shows practice time, accuracy trend and strongest/weakest/due items', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await seed(page);
  await page.evaluate('window.__coach.openPanel("history")');
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'history');

  const text = await page.evaluate("document.getElementById('panelHost').textContent");
  assert.match(text, /27\s*min|12\s*min/); // kbd minutes appear somewhere in the summary
  assert.match(text, /Keyboard/);
  assert.match(text, /Guitar/);
  // A strongest and a weakest keyboard item should be named in plain words.
  assert.match(text, /C4/); // n60
  assert.match(text, /D4/); // n62
});

test('copy-for-teacher falls back to selecting the text when the clipboard is refused', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await seed(page);
  await page.evaluate('window.__coach.openPanel("history")');
  await page.evaluate("document.getElementById('historyCopyBtn').click()");
  await page.waitFor("document.getElementById('historyCopyText') && !document.getElementById('historyCopyText').hidden", 5000);
  const value = await page.evaluate("document.getElementById('historyCopyText').value");
  assert.match(value, /Band Coach progress report/);
  assert.match(value, /Sessions logged: 3/);
});

test('a learner name is remembered across a reload via DB.panels.history', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await seed(page);
  await page.evaluate('window.__coach.openPanel("history")');
  await page.evaluate(`(function () {
    const input = document.getElementById('historyNameInput');
    input.value = 'Ada';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await page.waitFor("window.__coach.db().panels.history && window.__coach.db().panels.history.learnerName === 'Ada'", 5000);
  // save() debounces to localStorage on a 1200ms timer; wait it out before reloading.
  await page.waitFor("JSON.parse(localStorage.getItem('bandcoach.v1') || 'null')?.panels?.history?.learnerName === 'Ada'", 3000);
  await page.reload();
  await page.waitFor('window.__coach && window.__coach.db().mods.kbd', 5000);
  await page.evaluate('window.__coach.openPanel("history")');
  assert.equal(await page.evaluate("document.getElementById('historyNameInput').value"), 'Ada');
});
