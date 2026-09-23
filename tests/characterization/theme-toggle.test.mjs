// Unit J1: a Light/Dark/System theme toggle. Choosing Light sets data-theme
// on <html> and changes the computed body background; the choice survives a
// reload, driven through the real #optTheme control rather than the debug
// hook, so this proves the shipped page (not just the model behind it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('choosing Light sets data-theme and changes the computed body background', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const beforeAttr = await page.evaluate("document.documentElement.getAttribute('data-theme')");
  assert.equal(beforeAttr, null, 'no explicit data-theme before a choice is made');

  // Pin Dark first as the known "before" reading -- the headless browser's
  // own prefers-color-scheme default is not something this test controls (it
  // has been observed to already read as light), so an explicit Dark choice
  // is the only reliable baseline to diff Light against.
  await page.evaluate("document.getElementById('optTheme').value = 'dark'");
  await page.evaluate("document.getElementById('optTheme').dispatchEvent(new Event('change'))");
  assert.equal(await page.evaluate("document.documentElement.getAttribute('data-theme')"), 'dark');
  const before = await page.evaluate("getComputedStyle(document.body).backgroundColor");

  await page.evaluate("document.getElementById('optTheme').value = 'light'");
  await page.evaluate("document.getElementById('optTheme').dispatchEvent(new Event('change'))");

  const attr = await page.evaluate("document.documentElement.getAttribute('data-theme')");
  assert.equal(attr, 'light');
  const after = await page.evaluate("getComputedStyle(document.body).backgroundColor");
  assert.notEqual(after, before, 'body background should change once Light is explicitly chosen');
  assert.equal(after, 'rgb(245, 247, 251)', 'body background should match the light palette --ground');
});

test('choosing Light survives a reload', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("document.getElementById('optTheme').value = 'light'");
  await page.evaluate("document.getElementById('optTheme').dispatchEvent(new Event('change'))");
  // save() is debounced (1.2 s) and the page may already have saved once at
  // boot, so "anything stored" is not enough: wait for the Light choice itself.
  await page.waitFor("(() => { try { return JSON.parse(localStorage.getItem('bandcoach.v1')).prefs.theme === 'light'; } catch (e) { return false; } })()", 10000);

  await page.reload();
  await page.waitFor('typeof window.__coach !== "undefined"', 8000);

  const attr = await page.evaluate("document.documentElement.getAttribute('data-theme')");
  assert.equal(attr, 'light');
  const selectValue = await page.evaluate("document.getElementById('optTheme').value");
  assert.equal(selectValue, 'light');
});

test('choosing Dark then System removes the explicit data-theme attribute', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("document.getElementById('optTheme').value = 'dark'");
  await page.evaluate("document.getElementById('optTheme').dispatchEvent(new Event('change'))");
  assert.equal(await page.evaluate("document.documentElement.getAttribute('data-theme')"), 'dark');

  await page.evaluate("document.getElementById('optTheme').value = 'system'");
  await page.evaluate("document.getElementById('optTheme').dispatchEvent(new Event('change'))");
  assert.equal(await page.evaluate("document.documentElement.getAttribute('data-theme')"), null);
});
