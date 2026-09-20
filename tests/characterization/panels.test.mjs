// The feature-panel frame (src/ui/panels.js wired in app.js): a registered
// panel gets a button, opening it swaps the trainer out, and picking an
// instrument swaps it back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

test('a registered panel opens in place of the trainer and an instrument closes it', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate(`window.__coach.registerPanel({ id: 'demo', name: 'Demo', tag: 'test',
    mount: el => { el.innerHTML = '<p id="demoBody">hello</p>'; window.__demoShown = 0; return { show: () => window.__demoShown++ }; } })`);
  assert.equal(await page.evaluate("document.getElementById('panelPicker').hidden"), false);
  await page.evaluate("document.querySelector('#panelPicker button[data-panel=\"demo\"]').click()");
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'demo');
  assert.equal(await page.evaluate("document.getElementById('mainArea').hidden"), true);
  assert.equal(await page.evaluate("document.getElementById('demoBody').textContent"), 'hello');
  assert.equal(await page.evaluate('window.__demoShown'), 1);

  await page.evaluate("document.querySelector('#picker button[data-mod=\"gtr\"]').click()");
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), null);
  assert.equal(await page.evaluate("document.getElementById('mainArea').hidden"), false);
  assert.equal(await page.evaluate("document.getElementById('panelHost').hidden"), true);
});

test('panel data survives a reload and garbage in it is dropped', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate(`(function () {
    const db = window.__coach.db(); db.panels = { songs: { picked: 'ode-to-joy' }, ear: 'garbage' };
    localStorage.setItem('bandcoach.v1', JSON.stringify(db));
  })()`);
  await page.reload();
  await page.waitFor('window.__coach && window.__coach.db().mods.kbd', 5000);
  assert.deepEqual(await page.evaluate('window.__coach.db().panels'), { songs: { picked: 'ode-to-joy' } });
});

test('opening a second panel tears down the first one\'s DOM instead of stacking it', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  // Mirrors how real panels (theory.js, editor.js) mount: appendChild into
  // the shared host without clearing it first, which is exactly what lets
  // one panel's DOM stack underneath the next rather than replace it.
  await page.evaluate(`window.__coach.registerPanel({ id: 'stackA', name: 'StackA', tag: 'test',
    mount: el => { const p = document.createElement('p'); p.id = 'stackAMarker'; p.textContent = 'a'; el.appendChild(p); return {}; } })`);
  await page.evaluate(`window.__coach.registerPanel({ id: 'stackB', name: 'StackB', tag: 'test',
    mount: el => { const p = document.createElement('p'); p.id = 'stackBMarker'; p.textContent = 'b'; el.appendChild(p); return {}; } })`);

  await page.evaluate("window.__coach.openPanel('stackA')");
  assert.equal(await page.evaluate("!!document.getElementById('stackAMarker')"), true);

  await page.evaluate("window.__coach.openPanel('stackB')");
  assert.equal(await page.evaluate("!!document.getElementById('stackBMarker')"), true, 'the second panel mounted');
  assert.equal(
    await page.evaluate("!!document.getElementById('stackAMarker')"),
    false,
    "the first panel's DOM must be torn down, not left stacked underneath the second"
  );
  assert.equal(
    await page.evaluate("document.getElementById('panelHost').children.length"),
    1,
    'the shared panel host holds exactly one panel at a time'
  );
});

test('closing a panel releases a resource its mount() holds beyond DOM', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate(`window.__coach.registerPanel({ id: 'leaky', name: 'Leaky', tag: 'test',
    mount: el => {
      el.innerHTML = '<p id="leakyMarker">leaky</p>';
      window.__leakyDestroyed = false;
      return { destroy: () => { window.__leakyDestroyed = true; } };
    } })`);
  await page.evaluate("window.__coach.openPanel('leaky')");
  assert.equal(await page.evaluate('window.__leakyDestroyed'), false);
  await page.evaluate('window.__coach.closePanel()');
  assert.equal(await page.evaluate('window.__leakyDestroyed'), true, 'an optional destroy() hook must run on close, for cleanup beyond DOM removal');
  assert.equal(await page.evaluate("!!document.getElementById('leakyMarker')"), false);
});

test('a panel reopens cleanly after being closed', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate(`window.__coach.registerPanel({ id: 'reopenable', name: 'Reopenable', tag: 'test',
    mount: el => { el.innerHTML = '<p id="reopenMarker">hi</p>'; return {}; } })`);
  await page.evaluate("window.__coach.openPanel('reopenable')");
  assert.equal(await page.evaluate("!!document.getElementById('reopenMarker')"), true);
  await page.evaluate('window.__coach.closePanel()');
  assert.equal(await page.evaluate("!!document.getElementById('reopenMarker')"), false);
  await page.evaluate("window.__coach.openPanel('reopenable')");
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'reopenable');
  assert.equal(await page.evaluate("!!document.getElementById('reopenMarker')"), true, 'the panel remounts fresh after a close');
});

test('a message from an open panel is visible outside the panel body', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate(`window.__coach.registerPanel({ id: 'talky', name: 'Talky',
    mount: (el, api) => { el.innerHTML = '<button type="button" id="talkyBtn">say it</button>';
      document.getElementById('talkyBtn').addEventListener('click', () => api.say('well done', 'ok')); } })`);
  await page.evaluate("window.__coach.openPanel('talky')");
  await page.evaluate("document.getElementById('talkyBtn').click()");
  assert.equal(await page.evaluate("document.getElementById('panelSay').textContent"), 'well done');
  assert.equal(await page.evaluate("document.getElementById('panelSay').hidden"), false);
  // the trainer's own feedback line is hidden behind #mainArea while a panel is open
  assert.equal(await page.evaluate("document.getElementById('mainArea').hidden"), true);
  await page.evaluate('window.__coach.closePanel()');
  assert.equal(await page.evaluate("document.getElementById('panelSay').hidden"), true);
});
