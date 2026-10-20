// Top navigation on narrow phones, on the release file: every nav label stays made of whole words (a word never breaks
// across lines), takes at most two lines, nothing pokes out past the viewport's right edge, and every button stays a
// 44x44 touch target. English and Spanish (longer labels), at 320x568, 390x844 and 844x390.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';

const SIZES = [
  { name: '320x568', vp: { width: 320, height: 568, mobile: true, deviceScaleFactor: 2 } },
  { name: '390x844', vp: { width: 390, height: 844, mobile: true, deviceScaleFactor: 3 } },
  { name: '844x390', vp: { width: 844, height: 390, mobile: true, deviceScaleFactor: 3 } },
];

// Observation only: per nav button, the line count of its text, the words whose letters sit on more than one line,
// and its box.
const MEASURE = `(() => [...document.querySelectorAll('#mainNav button')].map((b) => {
  const r = b.getBoundingClientRect(), tops = new Set(), split = [];
  const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode()); ) {
    const re = /\\S+/g; let m;
    while ((m = re.exec(n.nodeValue))) {
      const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
      const lines = new Set([...rg.getClientRects()].map((q) => Math.round(q.top)));
      lines.forEach((t) => tops.add(t));
      if (lines.size > 1) split.push(m[0]);
    }
  }
  return { coarse: matchMedia('(pointer: coarse)').matches, text: b.textContent.trim(), lines: tops.size, split, left: r.left, right: r.right, width: r.width, height: r.height };
}))()`;

for (const lang of ['en', 'es']) {
  for (const { name, vp } of SIZES) {
    test(`nav labels stay whole words, fit and are tappable: ${lang} at ${name}`, async (t) => {
      await withAcceptancePage(t, { initScript: "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'kbd' } }));" }, async (page) => {
        await page.setViewport(vp);
        await page.reload();
        await page.waitFor("document.getElementById('playBtn') !== null");
        if (lang === 'es') {
          await page.clickSelector('#mainNav button[data-route="settings"]');
          await page.evaluate("(() => { const s = document.getElementById('optLocale'); s.value = 'es'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
          assert.equal(await page.evaluate('document.documentElement.lang'), 'es');
          await page.clickSelector('#mainNav button[data-route="practice"]');
        }
        const items = await page.evaluate(MEASURE);
        assert.equal(items.length, 5);
        t.diagnostic(`${lang} ${name}: pointer coarse = ${items[0].coarse}; ` + items.map((i) => `${i.text} ${Math.round(i.width)}x${Math.round(i.height)} ${i.lines}L`).join(', '));
        for (const it of items) {
          const ctx = `${lang} ${name} "${it.text}"`;
          assert.deepEqual(it.split, [], `${ctx}: a word broke across lines`);
          assert.ok(it.lines <= 2, `${ctx}: ${it.lines} lines`);
          assert.ok(it.left >= -0.5 && it.right <= vp.width + 0.5, `${ctx}: box ${it.left}..${it.right} outside 0..${vp.width}`);
          assert.ok(!it.coarse || (it.width >= 44 && it.height >= 44), `${ctx}: ${it.width}x${it.height} is under 44x44`);
        }
        assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), `${lang} ${name}: page scrolls sideways`);
      });
    });
  }
}
