// Every view the learner can reach -- each nav route, each tool panel and each instrument's trainer -- must fit a narrow
// or short phone without the page scrolling sideways. Screens 600px tall or less switch .wrap to a wrapping row
// (src/styles.css, max-height: 600px), where a flex child keeps min-width: auto and grows to its widest content: the
// "How to play it" panel pushed the page to 1092px at 320x568 and at 844x390 (a phone held sideways).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const SIZES = [
  { name: '320x568', vp: { width: 320, height: 568, mobile: true, deviceScaleFactor: 2 } },
  { name: '320x844', vp: { width: 320, height: 844, mobile: true, deviceScaleFactor: 2 } },
  { name: '844x390', vp: { width: 844, height: 390, mobile: true, deviceScaleFactor: 2 } },
];
const WIDTH = 'JSON.stringify({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })';
const settle = () => new Promise((r) => setTimeout(r, 100));

for (const { name, vp } of SIZES) {
  test(`no route, tool panel or trainer scrolls the page sideways at ${name}`, async (t) => {
    const page = await launchPage(HTML_PATH);
    t.after(() => page.close());
    await page.setViewport(vp);
    const wide = [];
    const check = async (label) => {
      await settle();
      const m = JSON.parse(await page.evaluate(WIDTH));
      if (m.sw > m.cw) wide.push(`${label} (${m.sw} in ${m.cw})`);
    };
    const panels = JSON.parse(await page.evaluate("JSON.stringify([...document.querySelectorAll('#picker button[data-panel]')].map((b) => b.dataset.panel))"));
    const mods = JSON.parse(await page.evaluate("JSON.stringify([...document.querySelectorAll('#picker [data-mod]')].map((b) => b.dataset.mod))"));
    assert.ok(panels.includes('fingerings') && mods.includes('drum-kit'), `picker lists panels ${panels} and mods ${mods.length}`);
    for (const id of panels) {
      await page.evaluate(`window.__coach.openPanel(${JSON.stringify(id)})`);
      await check(`panel ${id}`);
    }
    for (const route of ['songs', 'progress', 'settings', 'instrument', 'practice']) {
      await page.evaluate(`document.querySelector('#mainNav button[data-route="${route}"]').click()`);
      await check(`route ${route}`);
    }
    for (const mod of mods) {
      await page.evaluate(`document.querySelector('#picker [data-mod="${mod}"]').click()`);
      await check(`trainer ${mod}`);
    }
    assert.deepEqual(wide, []);
  });
}
