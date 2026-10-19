// D4: every instrument whose provenance is null says "Not yet checked by a
// player" in the line that teaches how it works, not only the keyboard path.
// Picks each instrument through the real picker button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { en } from '../../src/core/i18n.js';
import { INSTRUMENTS } from '../../src/instruments/index.js';

test('picking any unreviewed instrument shows the review.unreviewed label beside its help text', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  const label = JSON.stringify(en['review.unreviewed']);
  const unreviewed = INSTRUMENTS.filter(r => r.provenance === null);
  assert.ok(unreviewed.length >= 3);
  let picked = 0;
  for (const rec of unreviewed) {
    const clicked = await page.evaluate(`(function () { const b = document.querySelector('#picker button[data-mod=' + JSON.stringify(${JSON.stringify(rec.id)}) + ']'); if (!b) return false; b.click(); return true; })()`);
    if (!clicked) continue;
    picked++;
    const shown = await page.evaluate(`document.getElementById('helpText').textContent.includes(${label}) && !!document.querySelector('#helpText [role=note]')`);
    assert.equal(shown, true, rec.id + ': help text must carry the unreviewed label');
  }
  assert.ok(picked >= 3, 'picked only ' + picked + ' instruments through the picker');
});
