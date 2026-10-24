// Release acceptance record "Target size" and "Text enlargement" rows.
// On a 320x568 phone, with a mouse every visible control is at least 24 CSS px
// in its smaller dimension (WCAG 2.5.8 AA), and on a finger-driven screen
// (pointer: coarse) at least 44 (the product goal). Text is set in rem, so the
// browser's own text-size setting enlarges it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const STATES = ['first-paint', 'kbd-chosen', 'songs', 'progress', 'settings'];
const PHONE = { width: 320, height: 568 };
const TARGETS = `JSON.stringify([...document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,label,summary,[role=button],[tabindex]:not([tabindex="-1"])')]
  .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]'); })
  .map((e) => { const r = e.getBoundingClientRect(); return { who: (e.id || e.tagName.toLowerCase() + '.' + e.className) + ' "' + (e.textContent || '').trim().slice(0, 24) + '"', w: Math.round(r.width), h: Math.round(r.height) }; }))`;

async function measure(coarse) {
  const page = await launchPage(HTML_PATH);
  try {
    await page.setViewport({ ...PHONE, mobile: coarse });
    if (coarse) await page.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    assert.equal(await page.evaluate("matchMedia('(pointer: coarse)').matches"), coarse, 'pointer type applied');
    const small = {};
    const floor = coarse ? 44 : 24;
    for (const route of STATES) {
      if (route === 'kbd-chosen') await page.clickSelector('#picker button[data-mod="kbd"]');
      else if (route !== 'first-paint') {
        await page.evaluate(`document.querySelector('#mainNav button[data-route="${route}"]').click()`);
        await page.waitFor(`document.querySelector('#mainNav button[data-route="${route}"]').getAttribute('aria-current') === 'page'`);
      }
      const boxes = JSON.parse(await page.evaluate(TARGETS));
      assert.ok(boxes.length >= 10, `${route}: only ${boxes.length} targets measured`);
      small[route] = boxes.filter((b) => Math.min(b.w, b.h) < floor).map((b) => `${b.who} ${b.w}x${b.h}`);
    }
    assert.deepEqual(page.exceptions, []);
    return small;
  } finally {
    await page.close();
  }
}

test('320x568 with a mouse: every visible control is at least 24 CSS px', async () => {
  const small = await measure(false);
  assert.deepEqual(small, Object.fromEntries(STATES.map((r) => [r, []])), 'controls under 24 px');
});

test('320x568 with touch: every visible control is at least 44 CSS px', async () => {
  const small = await measure(true);
  assert.deepEqual(small, Object.fromEntries(STATES.map((r) => [r, []])), 'controls under 44 px');
});

test('text is sized in rem, so the browser text-size setting enlarges it', async () => {
  const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const px = css.split('\n').filter((l) => /font(-size)?\s*:[^;}]*\d(\.\d+)?px/.test(l));
  assert.deepEqual(px, [], 'font sizes written in px');
  const page = await launchPage(HTML_PATH);
  try {
    await page.setViewport({ ...PHONE, mobile: true });
    const sizes = {};
    for (const px of [16, 32]) {
      await page.cdp.send('Page.setFontSizes', { fontSizes: { standard: px, fixed: Math.round((px * 13) / 16) } });
      sizes[px] = JSON.parse(await page.evaluate("JSON.stringify({ body: parseFloat(getComputedStyle(document.body).fontSize), button: parseFloat(getComputedStyle(document.querySelector('button')).fontSize), sideways: document.documentElement.scrollWidth - innerWidth })"));
    }
    assert.equal(sizes[32].body, sizes[16].body * 2, 'body text doubles with the default font size');
    assert.equal(sizes[32].button, sizes[16].button * 2, 'button text doubles with the default font size');
    assert.ok(sizes[32].sideways <= 0, `page scrolls sideways by ${sizes[32].sideways}px at the largest text size`);
  } finally {
    await page.close();
  }
});
