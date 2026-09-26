// Unit J1: a Light/Dark/System theme toggle. Choosing Light sets data-theme
// on <html> and changes the computed body background; the choice survives a
// reload, driven through the real #optTheme control rather than the debug
// hook, so this proves the shipped page (not just the model behind it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

// WCAG 2.x relative luminance + contrast ratio maths (no deps), same formula
// as tests/unit/stage-contrast.test.mjs and tests/unit/theme-contrast.test.mjs
// -- kept as a third copy here (rather than imported) because this file
// drives a real headless page and needs to feed it live `rgb(r, g, b)`
// strings read back from getComputedStyle, not hex literals from the CSS
// source.
function srgbToLinear(c) { const cs = c / 255; return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4); }
function relLuminanceRgb([r, g, b]) { return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b); }
function parseRgba(str) { const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s\/]+([\d.]+))?\)/.exec(str); assert.ok(m, `expected an rgb()/rgba() colour string, got ${str}`); return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])]; }
function hexToRgb(hex) { const h = hex.replace('#', ''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function contrastRatioRgb(rgbA, rgbB) {
  const l1 = relLuminanceRgb(rgbA); const l2 = relLuminanceRgb(rgbB);
  const lighter = Math.max(l1, l2); const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
// Composites an (possibly translucent) foreground colour over a solid hex
// backdrop -- simple alpha-over-opaque, used for elements like `.break`
// (background: #0a0d14f5) painted on top of the stage gradient.
function compositeOverHex(rgba, backdropHex) {
  const [r, g, b, a] = rgba; const [br, bg, bb] = hexToRgb(backdropHex);
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
}

// The `.stage` gradient's two literal stops (src/styles.css's `.stage`
// rule) -- the worse of the two is the number that matters, since a real
// person reads text somewhere between them.
const STAGE_GRADIENT_TOP = '#0d111c';
const STAGE_GRADIENT_BOTTOM = '#05070c';

// BC-10 follow-up: `.stage` re-pins --text/--muted/etc as custom properties
// for its descendants, but `body { color: var(--text) }` (src/styles.css:50)
// is the only rule that ever turns --text into a used `color` value -- once
// resolved there it is inherited as a plain colour, so an element under
// `.stage` that never sets its own `color` (","#prompt", the break card's
// `<h2>`, `#tapPad`) still shows the page-level theme colour, not the
// stage's pinned one. Only `.stage` itself (or each leaf) declaring `color:`
// explicitly fixes that -- this proves it against the real rendered page,
// not just the CSS source.
async function assertStageTextReadable(page, selector, label) {
  const q = JSON.stringify(selector);
  const colourStr = await page.evaluate(`getComputedStyle(document.querySelector(${q})).color`);
  const ownBgStr = await page.evaluate(`getComputedStyle(document.querySelector(${q})).backgroundColor`);
  const fontSize = await page.evaluate(`parseFloat(getComputedStyle(document.querySelector(${q})).fontSize)`);
  const fontWeight = await page.evaluate(`getComputedStyle(document.querySelector(${q})).fontWeight`);
  const isLarge = fontSize >= 24 || (fontSize >= 19 && Number(fontWeight) >= 700);
  const minRatio = isLarge ? 3 : 4.5;
  const [cr, cg, cb] = parseRgba(colourStr);
  const ownBg = parseRgba(ownBgStr);
  // An element that paints its own background (choice buttons after
  // answering, tapPad, the primary Start button, ...) is read against THAT
  // background, not the stage gradient behind it -- ownBg[3] (alpha) is 0
  // for the common "no background of its own" case, which falls through to
  // the gradient stops below.
  if (ownBg[3] > 0.01) {
    const backdrop = ownBg[3] >= 0.99 ? [ownBg[0], ownBg[1], ownBg[2]] : compositeOverHex(ownBg, STAGE_GRADIENT_BOTTOM);
    const ratio = contrastRatioRgb([cr, cg, cb], backdrop);
    assert.ok(ratio >= minRatio, `${label} (${selector}): computed colour ${colourStr} on own background ${ownBgStr} (font ${fontSize}px/${fontWeight}) contrasts ${ratio.toFixed(2)}:1, need >= ${minRatio}:1`);
    return;
  }
  for (const stop of [STAGE_GRADIENT_TOP, STAGE_GRADIENT_BOTTOM]) {
    const ratio = contrastRatioRgb([cr, cg, cb], hexToRgb(stop));
    assert.ok(ratio >= minRatio, `${label} (${selector}): computed colour ${colourStr} (font ${fontSize}px/${fontWeight}) contrasts ${ratio.toFixed(2)}:1 against stage stop ${stop}, need >= ${minRatio}:1`);
  }
}

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

test('stage text stays readable against the stage\'s own fixed dark gradient in both themes', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  for (const theme of ['dark', 'light']) {
    await page.evaluate(`document.getElementById('optTheme').value = ${JSON.stringify(theme)}`);
    await page.evaluate("document.getElementById('optTheme').dispatchEvent(new Event('change'))");
    assert.equal(await page.evaluate("document.documentElement.getAttribute('data-theme')"), theme);

    // Idle prompt/hint -- always on stage, no interaction needed.
    await assertStageTextReadable(page, '#prompt', `${theme} theme: idle prompt`);
    await page.evaluate("window.__coach.setMod('kbd')");
    await page.evaluate("document.getElementById('playBtn').click()");
    await page.waitFor('window.__coach.task()');
    await assertStageTextReadable(page, '#prompt', `${theme} theme: prompt during a lesson`);
    await assertStageTextReadable(page, '#hint', `${theme} theme: hint during a lesson`);

    // Break card overlay: a second Start click is a user-initiated pause,
    // the real path a11y-dialog-focus.test.mjs also uses to open it.
    await page.evaluate("document.getElementById('playBtn').click()");
    await page.waitFor("document.getElementById('breakCard').hidden === false");
    await assertStageTextReadable(page, '#breakTitle', `${theme} theme: break card title`);
    await assertStageTextReadable(page, '#breakWhy', `${theme} theme: break card body text`);
    await page.evaluate("document.getElementById('backBtn').click()");
    await page.waitFor("document.getElementById('breakCard').hidden === true");
    await page.evaluate("document.getElementById('endBtn').click()");

    // Ear training's multiple-choice buttons -- real .choices overlay.
    await page.evaluate("window.__coach.setMod('ear')");
    await page.evaluate("document.getElementById('playBtn').click()");
    await page.waitFor('window.__coach.task()');
    const choiceButtonCount = await page.evaluate("document.querySelectorAll('#choices button').length");
    assert.ok(choiceButtonCount > 0, `${theme} theme: ear training should offer choice buttons`);
    await assertStageTextReadable(page, '#choices button', `${theme} theme: unanswered choice button`);
    const rightId = await page.evaluate('window.__coach.cur().id');
    await page.evaluate(`window.__coach.answer(${JSON.stringify(rightId)})`);
    await page.waitFor("document.getElementById('feedback').className === 'ok'");
    await assertStageTextReadable(page, '.choices button.right', `${theme} theme: correct choice button`);
    await page.evaluate("document.getElementById('endBtn').click()");

    // Rhythm mode's tap pad.
    await page.evaluate("window.__coach.setMod('rhy')");
    await page.waitFor("document.getElementById('tapPad').hidden === false");
    await assertStageTextReadable(page, '#tapPad', `${theme} theme: rhythm tap pad`);
  }
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
