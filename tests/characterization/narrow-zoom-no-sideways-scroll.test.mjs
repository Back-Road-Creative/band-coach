// Real page zoom shrinks the layout width the page sees: 200% on a 390px phone
// is a ~195 CSS px layout. The 320px reflow target held, but below ~255px the
// nav's 1fr columns and the #modOpts selects had a minimum content width that
// pushed the page sideways (scrollWidth 251 in a 195px viewport). The page must
// never scroll sideways at these widths; labels wrap instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

for (const width of [195, 240]) {
  test(`at a ${width}px zoomed layout the page does not scroll sideways`, async (t) => {
    const page = await launchPage(HTML_PATH);
    t.after(() => page.close());
    await page.setViewport({ width, height: 844, mobile: true, deviceScaleFactor: 2 });
    const m = JSON.parse(await page.evaluate(`JSON.stringify({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, wide: Array.from(document.querySelectorAll('.main-nav button, #modOpts, #modOpts select')).filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).map(e => e.id || e.dataset.route || e.tagName) })`));
    assert.ok(m.sw <= m.cw, `scrollWidth ${m.sw} exceeds clientWidth ${m.cw}; too wide: ${m.wide.join(',')}`);
    assert.deepEqual(m.wide, []);
  });
}
