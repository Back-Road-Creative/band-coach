// A variant family in #picker (Bass, Ukulele, Wind and brass, Violin, ...)
// is one flex item: the parent button with a small "Variants: ..." disclosure
// under it. styles.css says that item "takes only as much row width as the
// parent button needs" -- but the disclosure's summary lists every variant
// name on one line, so the item grew to the width of that list (Wind and
// brass: 11 names, ~840px at 1440px) and the button sat at the left of a wide
// empty box. On screen that pushed Voice and Mandolin to the far right, left
// big holes in each row, and on a phone stranded Bass and Violin on rows of
// their own. This pins the stated intent: no family is wider than its
// parent button, at the desktop and phone sizes `npm run shots` captures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { SHOTS } from '../../build/shots.mjs';

test('each variant family is no wider than its parent button', async () => {
  const page = await launchPage(HTML_PATH);
  try {
    for (const { name, width, height, mobile } of SHOTS) {
      await page.setViewport({ width, height, mobile });
      const rows = await page.evaluate(`JSON.stringify([...document.querySelectorAll('#picker .picker-variant-group')].map(g => {
        const b = g.querySelector(':scope > button');
        return { id: g.dataset.modGroup, group: Math.round(g.getBoundingClientRect().width), button: Math.round(b.getBoundingClientRect().width) };
      }))`);
      const groups = JSON.parse(rows);
      assert.ok(groups.length > 0, `${name}: no variant families rendered`);
      for (const g of groups) {
        assert.ok(g.group <= g.button + 1, `${name}: ${g.id} family is ${g.group}px wide but its button is ${g.button}px`);
      }
    }
  } finally {
    await page.close();
  }
});

test('a shortened variant summary still names every variant for hover and screen readers', async () => {
  const page = await launchPage(HTML_PATH);
  try {
    const titles = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll('#picker .picker-variant-group')].map(g => ({
      title: g.querySelector('.variant-toggle > summary').title,
      names: [...g.querySelectorAll('.variant-buttons button strong, .variant-buttons button')].map(b => b.firstChild && b.firstChild.textContent.trim()).filter(Boolean),
    })))`));
    for (const t of titles) {
      assert.match(t.title, /^Variants: /);
      for (const n of t.names) assert.ok(t.title.includes(n), `summary title "${t.title}" is missing "${n}"`);
    }
  } finally {
    await page.close();
  }
});

// text-overflow only draws its "..." on a block container. The summary was
// display:flex (for the 24px tap target), so the clipped label stopped
// mid-letter with no sign that more variants were listed.
test('a clipped variant summary ends in an ellipsis and keeps a 24px tap target', async () => {
  const page = await launchPage(HTML_PATH);
  try {
    const rows = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll('#picker .variant-toggle > summary')].map(s => {
      const cs = getComputedStyle(s);
      return { text: s.textContent, display: cs.display, textOverflow: cs.textOverflow, clipped: s.scrollWidth > s.clientWidth, h: s.getBoundingClientRect().height };
    }))`));
    assert.ok(rows.length > 0, 'no variant summaries rendered');
    assert.ok(rows.some(r => r.clipped), 'expected at least one summary to be clipped');
    for (const r of rows) {
      assert.equal(r.textOverflow, 'ellipsis', `${r.text}: text-overflow`);
      assert.ok(!/flex|grid/.test(r.display), `${r.text}: display ${r.display} stops text-overflow drawing the ellipsis`);
      assert.ok(r.h >= 24, `${r.text}: tap target ${r.h}px is under 24px`);
    }
  } finally {
    await page.close();
  }
});
