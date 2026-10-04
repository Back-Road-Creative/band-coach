// Settings that change how the app looks or reads have to take effect
// everywhere at once, on the release file a person downloads: the practice
// 'Show' control owns up to names turned off in Settings, a theme switch
// repaints the accent ink, a language switch re-words the model-pack line,
// the form fields follow the dark theme, and the hands-together prompt uses
// the note names the learner picked. State is seeded through localStorage
// (as acceptance-midi does); the changes are real change events on the
// Settings controls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';

const seed = (obj) => `localStorage.setItem('bandcoach.v1', JSON.stringify(${JSON.stringify(obj)}));`;
const textOf = (page, id) => page.evaluate(`document.getElementById(${JSON.stringify(id)}).textContent.trim()`);
const go = (page, route) => page.clickSelector(`#mainNav button[data-route="${route}"]`);
const pick = (page, id, value) => page.evaluate(`(() => { const s = document.getElementById(${JSON.stringify(id)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const showOptions = (page) => page.evaluate("[...document.querySelectorAll('#optNotate option')].map(o => o.textContent)");

test('Show names off in Settings: the practice Show control says so instead of "Note names (today)"', async (t) => {
  await withAcceptancePage(t, { initScript: seed({ prefs: { mod: 'kbd', names: false } }) }, async (page) => {
    await go(page, 'practice');
    const opts = await showOptions(page);
    assert.equal(opts.length, 3);
    assert.doesNotMatch(opts.join('|'), /Note names \(today\)|Staff and names$/, `labels: ${opts}`);
    assert.match(opts[0], /off in Settings/);
    assert.match(opts[2], /off in Settings/);
  });
});

test('Show names on: the Show control keeps its plain labels', async (t) => {
  await withAcceptancePage(t, { initScript: seed({ prefs: { mod: 'kbd' } }) }, async (page) => {
    await go(page, 'practice');
    assert.deepEqual(await showOptions(page), ['Note names (today)', 'Staff', 'Staff and names']);
  });
});

test('Switching to Dark in Settings repaints the accent ink at once, no reload', async (t) => {
  await withAcceptancePage(t, { initScript: seed({ prefs: { mod: 'kbd', theme: 'light' } }) }, async (page) => {
    const vars = () => page.evaluate("(() => { const s = document.documentElement.style; return { ink: s.getPropertyValue('--accent-ink'), accent: s.getPropertyValue('--accent'), display: s.getPropertyValue('--accent-display') }; })()");
    const light = await vars();
    assert.notEqual(light.ink, light.accent, 'light theme darkens the ink');
    await go(page, 'settings');
    await pick(page, 'optTheme', 'dark');
    const dark = await vars();
    assert.equal(dark.ink, dark.accent, `dark ink is the bright accent: ${JSON.stringify(dark)}`);
    assert.equal(dark.display, dark.accent);
    await pick(page, 'optTheme', 'light');
    assert.deepEqual(await vars(), light, 'and back to light');
  });
});

test('Switching language re-words the model-pack status at once, both ways', async (t) => {
  await withAcceptancePage(t, { initScript: seed({ prefs: { mod: 'kbd' } }) }, async (page) => {
    await go(page, 'settings');
    await page.waitFor("document.getElementById('modelPackStatus').textContent.trim() !== ''");
    assert.equal(await textOf(page, 'modelPackStatus'), 'Not downloaded.');
    await pick(page, 'optLocale', 'es');
    await page.waitFor(`document.getElementById('modelPackStatus').textContent.trim() === ${JSON.stringify('Sin descargar.')}`);
    await pick(page, 'optLocale', 'en');
    await page.waitFor(`document.getElementById('modelPackStatus').textContent.trim() === ${JSON.stringify('Not downloaded.')}`);
  });
});

test('Dark theme: the number and text fields on Progress and Songs are dark, not browser white', async (t) => {
  await withAcceptancePage(t, { initScript: seed({ prefs: { mod: 'kbd', theme: 'dark' } }) }, async (page) => {
    const bg = (id) => page.evaluate(`getComputedStyle(document.getElementById(${JSON.stringify(id)})).backgroundColor`);
    await go(page, 'progress');
    assert.equal(await bg('historyGoalInput'), await bg('historyNameInput'));
    assert.notEqual(await bg('historyGoalInput'), 'rgb(255, 255, 255)');
    await go(page, 'songs');
    assert.notEqual(await bg('challengeTitleInput'), 'rgb(255, 255, 255)');
  });
});

test('Level 13 with Do-Re-Mi chosen: the prompt and the hint use the same name', async (t) => {
  const state = { prefs: { mod: 'kbd', noteNaming: { system: 'solfege', accidentals: 'flats' } }, mods: { kbd: { level: 13, item: { j1: { reps: 1, seen: 1, stability: 1, difficulty: 0.3, lastSeen: Date.now() } } } } };
  await withAcceptancePage(t, { initScript: seed(state) }, async (page) => {
    await go(page, 'practice');
    await page.clickSelector('#playBtn');
    await page.waitFor("/both hands together/.test(document.getElementById('prompt').textContent)");
    const prompt = await textOf(page, 'prompt'), hint = await textOf(page, 'hint');
    const name = /^Play (Do|Re|Mi|Fa|Sol), both hands together/.exec(prompt);
    assert.ok(name, `the prompt names the note in Do-Re-Mi: ${prompt}`);
    assert.ok(hint.includes(name[1]), `and the hint uses the same name: ${hint}`);
  });
});
