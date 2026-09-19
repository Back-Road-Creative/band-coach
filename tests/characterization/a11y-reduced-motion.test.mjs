// New behaviour (unit 7.7 item 6 / plan flaw: canvas flashes ignore
// prefers-reduced-motion, CSS only was covered): the wrong/right-note canvas
// border flash (and its non-colour glyph) is skipped entirely when the OS
// asks for reduced motion, emulated here over CDP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

const SPY_INIT = `
  window.__glyphs = [];
  const origFillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
    window.__glyphs.push(text);
    return origFillText.call(this, text, ...rest);
  };
`;

test('a wrong note flashes a non-colour glyph on the canvas by default', async (t) => {
  const page = await launchPage(htmlPath, { initScript: SPY_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const midi = await page.evaluate('window.__coach.cur().info.midi');
  const badNote = midi === 60 ? 61 : 60;
  await page.evaluate(`window.__coach.note(${badNote}, true)`);
  await page.waitFor("document.getElementById('feedback').className === 'no'");

  await page.waitFor('window.__glyphs.includes("✗")', 2000);
  assert.ok(true);
});

test('with prefers-reduced-motion, the canvas flash (and its glyph) is skipped', async (t) => {
  // reducedMotion is set before navigation so the app's own boot-time read
  // of matchMedia already sees it — see tests/helpers/browser.mjs.
  const page = await launchPage(htmlPath, { initScript: SPY_INIT, reducedMotion: true });
  t.after(() => page.close());

  assert.equal(await page.evaluate('window.__coach.reducedMotion()'), true);
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const midi = await page.evaluate('window.__coach.cur().info.midi');
  const badNote = midi === 60 ? 61 : 60;
  await page.evaluate(`window.__coach.note(${badNote}, true)`);
  await page.waitFor("document.getElementById('feedback').className === 'no'");

  // Give it a window well past the (now-skipped) 220ms flash before checking.
  await new Promise((r) => setTimeout(r, 400));
  const glyphs = await page.evaluate('window.__glyphs');
  assert.ok(!glyphs.includes('✗'), 'no cross glyph should have been drawn while reduced motion is on');
});
