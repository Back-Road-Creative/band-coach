// On a phone the instrument sheet shows each variant list as a short "More" chip. Its accessible name has to
// name the instrument ("More Ukulele variants"), not just "More", in English and in Español. Release file;
// the name is read from the browser's accessibility tree (CDP), not from our own attributes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';

async function chipName(page, mod) {
  await page.cdp.send('Accessibility.enable');
  const { result } = await page.cdp.send('Runtime.evaluate', { expression: `document.querySelector('.picker-variant-group[data-mod-group="${mod}"] > details > summary')` });
  const { nodes } = await page.cdp.send('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false });
  return nodes[0].name.value.replace(/^\s*▸/, '').replace(/\s+/g, ' ').trim(); // the closed-disclosure arrow is drawn by CSS and is part of the computed name
}

for (const [locale, want] of [['en', 'More Ukulele variants'], ['es', 'Más variantes de Ukulele']]) {
  test(`phone, ${locale}: the More chip's accessible name names its instrument`, async (t) => {
    await withAcceptancePage(t, { initScript: `localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { locale: '${locale}' } }));` }, async (page) => {
      await page.setViewport({ width: 390, height: 844, mobile: true, deviceScaleFactor: 2 });
      await page.waitFor("document.querySelector('.picker-variant-group[data-mod-group=\"uke\"] summary')");
      assert.equal(await page.evaluate("getComputedStyle(document.querySelector('.picker-variant-group[data-mod-group=\"uke\"] .variant-more')).display"), 'inline', 'the short chip is the one showing on a phone');
      assert.equal(await chipName(page, 'uke'), want);
    });
  });
}

test('Español: switching language redraws the instrument sheet (Tools label, chip name)', async (t) => {
  await withAcceptancePage(t, { initScript: "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'uke' } }));" }, async (page) => {
    await page.setViewport({ width: 390, height: 844, mobile: true, deviceScaleFactor: 2 });
    await page.clickSelector('#mainNav button[data-route="settings"]');
    await page.evaluate("(() => { const s = document.getElementById('optLocale'); s.value = 'es'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
    assert.equal(await page.evaluate("document.getElementById('pickerToolsLabel').textContent"), 'Herramientas');
    assert.equal(await page.evaluate("document.querySelector('#picker button[data-mod=\"uke\"]').getAttribute('aria-pressed')"), 'true', 'the chosen instrument stays marked');
    await page.clickSelector('#navInstrument'); // the sheet has to be open for the chip to be in the accessibility tree
    assert.match(await chipName(page, 'uke'), /^Más variantes de /);
  });
});
