// Item 3 (Wave W, unit w-fixes): the on-screen piano is canvas-drawn
// (drawKeys/keyRects) and only hit-testable via pointerdown -- a
// keyboard-only learner had no way to play any key. This adds a focusable
// path on the same canvas: arrow keys move a focus cursor across the
// visible keys, Enter/Space plays the focused key, the reported name is
// neutral ("white key N of M") whenever note names are hidden so it never
// gives away the answer, and a visible focus mark is drawn on the canvas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

async function start(page) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
}

test('the piano canvas is keyboard-focusable', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await start(page);

  const tabIndex = await page.evaluate("document.getElementById('cv').tabIndex");
  assert.ok(tabIndex >= 0, 'the canvas should be reachable by Tab');
});

test('arrow keys move focus and Enter plays the focused key', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await start(page);

  await page.evaluate("document.getElementById('cv').focus()");
  const before = await page.evaluate('window.__coach.kbdFocus()');
  assert.ok(before, 'a key should be focused once the canvas has focus');

  await page.evaluate(`
    document.getElementById('cv').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  `);
  const after = await page.evaluate('window.__coach.kbdFocus()');
  assert.notEqual(after.idx, before.idx, 'ArrowRight should move the focus cursor');

  await page.evaluate("document.getElementById('feedback').className = ''");
  await page.evaluate(`
    document.getElementById('cv').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  `);
  await page.waitFor("document.getElementById('feedback').className !== ''");
  const cls = await page.evaluate("document.getElementById('feedback').className");
  assert.ok(cls === 'ok' || cls === 'no', 'Enter on the focused key should register as an answer attempt');
});

test('the focused key name is neutral when note names are hidden', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await start(page);

  await page.evaluate("window.__coach.db().prefs.names = false");
  await page.evaluate("document.getElementById('cv').focus()");
  const hidden = await page.evaluate('window.__coach.kbdFocus()');
  assert.match(hidden.name, /^(white|black) key \d+ of \d+$/, `expected a neutral name, got "${hidden.name}"`);

  await page.evaluate("window.__coach.db().prefs.names = true");
  const shown = await page.evaluate('window.__coach.kbdFocus()');
  assert.ok(!/^(white|black) key/.test(shown.name), `expected a real note name once names are shown, got "${shown.name}"`);
});

test('a visible focus mark is drawn on the canvas', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await start(page);

  const pixelAt = async (x, y) => page.evaluate(`
    (function () {
      const ctx = document.getElementById('cv').getContext('2d');
      const [r, g, b] = ctx.getImageData(${x}, ${y}, 1, 1).data;
      return [r, g, b];
    })()
  `);

  const before = await page.evaluate('window.__coach.kbdFocus()');
  const unfocusedPixel = await pixelAt(Math.round(before.x + 2), Math.round(before.y + 2));

  await page.evaluate("document.getElementById('cv').focus()");
  await new Promise((r) => setTimeout(r, 100)); // let the next rAF frame draw the focus mark
  const focusedPixel = await pixelAt(Math.round(before.x + 2), Math.round(before.y + 2));

  assert.notDeepEqual(focusedPixel, unfocusedPixel, 'focusing the canvas should visibly mark the focused key');
});
