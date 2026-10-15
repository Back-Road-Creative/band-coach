// Release acceptance record E9 "Focus visibility and non-obscuration": a
// REAL Tab walk (Input.dispatchKeyEvent via page.press) through the first
// paint and the Songs, Progress and Settings panels, at desktop and phone
// widths. Every element Tab lands on must (a) show a visible focus
// indicator -- a computed outline with a real style and non-zero width, or a
// non-none box-shadow -- and (b) not be covered: document.elementFromPoint
// at its centre returns the element or a descendant (so no fixed/sticky bar
// sits over it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const SIZES = {
  desktop: { width: 1280, height: 800, mobile: false },
  phone: { width: 390, height: 844, mobile: true },
};
const STATES = ['first-paint', 'songs', 'progress', 'settings'];

async function inspectFocus(page) {
  return JSON.parse(await page.evaluate(`(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return JSON.stringify({ body: true });
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return JSON.stringify({
      id: el.id || '', tag: el.tagName, text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30),
      outlineStyle: cs.outlineStyle, outlineWidth: parseFloat(cs.outlineWidth), boxShadow: cs.boxShadow,
      focusVisible: el.matches(':focus-visible'),
      inView: r.width > 0 && r.height > 0 && cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight,
      hit: !!hit && (hit === el || el.contains(hit)), hitDesc: hit ? hit.tagName + '#' + hit.id + '.' + hit.className : null,
      key: el.tagName + '#' + el.id + '|' + (el.getAttribute('data-route') || '') + '|' + (el.textContent || '').trim().slice(0, 20),
    });
  })()`));
}

for (const [size, vp] of Object.entries(SIZES)) {
  test(`${size}: every Tab stop across the main states shows a focus indicator and is not covered`, async (t) => {
    const page = await launchPage(HTML_PATH);
    t.after(() => page.close());
    await page.setViewport(vp);
    let stops = 0;
    for (const state of STATES) {
      if (state !== 'first-paint') {
        await page.evaluate(`document.querySelector('#mainNav button[data-route="${state}"]').click()`);
        await page.waitFor(`document.querySelector('#mainNav button[data-route="${state}"]').getAttribute('aria-current') === 'page'`);
        await page.evaluate('document.activeElement && document.activeElement.blur()');
        await page.evaluate('window.scrollTo(0, 0)');
      }
      const seen = new Set();
      for (let i = 0; i < 80; i++) {
        await page.press('Tab');
        const f = await inspectFocus(page);
        if (f.body) break; // focus left the document: the walk wrapped
        if (seen.has(f.key)) break;
        seen.add(f.key);
        stops++;
        const label = `${size}/${state} stop ${i + 1} <${f.tag} ${f.id || f.text}>`;
        const ring = (f.outlineStyle !== 'none' && f.outlineWidth > 0) || (f.boxShadow && f.boxShadow !== 'none');
        assert.ok(ring, `${label}: no visible focus indicator (outline ${f.outlineStyle} ${f.outlineWidth}px, box-shadow ${f.boxShadow})`);
        assert.ok(f.inView, `${label}: focused element is not inside the viewport`);
        assert.ok(f.hit, `${label}: covered at its centre by ${f.hitDesc}`);
      }
      assert.ok(seen.size >= 3, `${size}/${state}: Tab reached only ${seen.size} stops`);
    }
    assert.ok(stops >= 20, `${size}: only ${stops} tab stops checked in total`);
    assert.deepEqual(page.exceptions, []);
  });
}
