// A learner who raises the browser's text size must get bigger text. Every font size in the stylesheet was px, so a
// 20px or 24px browser default changed nothing. This drives the RELEASE file with Chromium's standard font size set
// through CDP (Page.setFontSizes, the same setting as Chrome's "Font size" option) and reads what the page really
// computed: body, the nav buttons, the big prompt, and no sideways scroll at a laptop and a phone size. At the
// default 16px the page must look as before. Canvas text is read through fillText, wrapped before the app boots:
// the smallest font the canvas drew must grow with the root size (the px floors are scaled by it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';

const RECORD = `(() => {
  window.__fonts = [];
  const f = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (...a) { window.__fonts.push(this.font); return f.apply(this, a); };
})()`;

const VIEWS = [{ name: 'laptop', width: 1366, height: 768 }, { name: 'phone', width: 390, height: 844, mobile: true }];

async function readPage(page) {
  return page.evaluate(`(() => {
    const px = (el) => parseFloat(getComputedStyle(el).fontSize);
    const nav = document.querySelector('.main-nav button');
    return { body: px(document.body), nav: px(nav), prompt: px(document.getElementById('prompt')),
      scrollW: document.documentElement.scrollWidth, innerW: innerWidth };
  })()`);
}

for (const size of [16, 20, 24]) {
  test(`browser text size ${size}px: page text follows it, nothing overflows`, async (t) => {
    await withAcceptancePage(t, { initScript: RECORD }, async (page) => {
      await page.cdp.send('Page.setFontSizes', { fontSizes: { standard: size } });
      for (const v of VIEWS) {
        await page.setViewport({ width: v.width, height: v.height, mobile: !!v.mobile, deviceScaleFactor: 1 });
        await page.reload();
        const r = await readPage(page);
        const where = `${v.name} @${size}px`;
        if (size === 16) { assert.equal(r.body, 14, `${where}: unchanged body`); assert.equal(r.prompt, 40, `${where}: unchanged prompt`); }
        else { assert.ok(r.body >= 17.5, `${where}: body ${r.body}`); assert.ok(r.nav >= 16, `${where}: nav ${r.nav}`); }
        if (size === 20) assert.ok(r.prompt >= 50, `${where}: prompt ${r.prompt}`);
        if (size === 24) assert.ok(r.prompt >= 60, `${where}: prompt ${r.prompt}`);
        assert.ok(r.scrollW <= r.innerW, `${where}: sideways scroll ${r.scrollW} > ${r.innerW}`);
      }
    });
  });
}

test('canvas text: the smallest drawn font grows with the browser text size', async (t) => {
  const smallest = async (size) => withAcceptancePage(t, { initScript: RECORD }, async (page) => {
    await page.cdp.send('Page.setFontSizes', { fontSizes: { standard: size } });
    await page.setViewport({ width: 390, height: 844, mobile: true, deviceScaleFactor: 1 });
    await page.reload();
    await page.waitFor('window.__fonts.length > 0');
    const fonts = await page.evaluate('window.__fonts');
    return Math.min(...fonts.map((f) => parseFloat(/(\d+(?:\.\d+)?)px/.exec(f)[1])));
  });
  const a = await smallest(16), b = await smallest(24);
  assert.ok(b >= a * 1.4, `smallest canvas font ${a}px at 16 vs ${b}px at 24`);
});
