// Release acceptance record D2 "Landscape": until now no test set a
// landscape viewport. Phone landscape (844x390, touch) and tablet landscape
// (1024x768, touch) get the same bar the portrait 320/390 tests hold: no
// sideways scroll, every nav label fully readable and un-overlapped, and
// #playBtn reachable (scrolled into view it sits wholly inside the viewport
// and is the element a tap at its centre would hit, not covered by a bar).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const LANDSCAPE = {
  'phone-landscape': { width: 844, height: 390, mobile: true },
  'tablet-landscape': { width: 1024, height: 768, mobile: true },
};

for (const [name, vp] of Object.entries(LANDSCAPE)) {
  test(`${name} (${vp.width}x${vp.height}): no sideways scroll, readable nav, #playBtn reachable`, async (t) => {
    const page = await launchPage(HTML_PATH);
    t.after(() => page.close());
    await page.setViewport(vp);
    // One question first: Start appears once an instrument is chosen.
    await page.clickSelector('#picker button[data-mod="kbd"]');

    const m = JSON.parse(await page.evaluate(`JSON.stringify({
      iw: innerWidth, sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth,
      nav: Array.from(document.querySelectorAll('.main-nav button')).map(b => {
        const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);
        return { route: b.dataset.route, text: b.textContent.trim(), sw: b.scrollWidth, cw: b.clientWidth, to: cs.textOverflow, l: r.left, r: r.right, t: r.top, b: r.bottom };
      }),
    })`));
    assert.equal(m.iw, vp.width, 'viewport applied');
    assert.ok(m.sw <= m.iw, `${name}: documentElement scrollWidth ${m.sw} exceeds viewport ${m.iw} (sideways scroll)`);
    assert.ok(m.bw <= m.iw, `${name}: body scrollWidth ${m.bw} exceeds viewport ${m.iw}`);
    assert.equal(m.nav.length, 5, 'five nav buttons');
    for (const n of m.nav) {
      assert.notEqual(n.to, 'ellipsis', `${name} ${n.route}: ellipsis (${JSON.stringify(n.text)})`);
      assert.ok(n.sw <= n.cw, `${name} ${n.route}: label ${JSON.stringify(n.text)} clipped (${n.sw} > ${n.cw})`);
      assert.ok(n.l >= 0 && n.r <= m.iw, `${name} ${n.route}: button outside the viewport horizontally`);
    }
    for (let i = 0; i < m.nav.length; i++) for (let j = i + 1; j < m.nav.length; j++) {
      const a = m.nav[i], b = m.nav[j];
      assert.ok(!(a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b), `${name}: ${a.route} and ${b.route} overlap`);
    }

    const p = JSON.parse(await page.evaluate(`(() => {
      const el = document.getElementById('playBtn');
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return JSON.stringify({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, hit: !!hit && (hit === el || el.contains(hit)), sw: document.documentElement.scrollWidth, iw: innerWidth, ih: innerHeight });
    })()`));
    assert.ok(p.top >= 0 && p.bottom <= p.ih, `${name}: #playBtn (${p.top}..${p.bottom}) not wholly inside the ${p.ih}px viewport once scrolled to`);
    assert.ok(p.left >= 0 && p.right <= p.iw, `${name}: #playBtn outside the viewport horizontally`);
    assert.ok(p.hit, `${name}: a tap at #playBtn's centre lands on something else (covered)`);
    assert.ok(p.sw <= p.iw, `${name}: scrolling to #playBtn produced a sideways scroll`);
    assert.deepEqual(page.exceptions, []);
  });
}
