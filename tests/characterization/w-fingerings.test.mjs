// The "How to play it" panel: pick an instrument and a note, see a diagram
// plus its accessible text description, and the instrument's playable range.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

test('fingerings panel opens, shows a default fretboard diagram, and reacts to a note pick', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  // The default mod at boot (kbd) has no fingering mapping, so the panel
  // falls back to the first instrument that does have one.
  assert.equal(await page.evaluate("document.querySelector('#picker button[aria-pressed=\"true\"]').dataset.mod"), 'kbd');
  await page.evaluate("window.__coach.openPanel('fingerings')");
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'fingerings');
  assert.notEqual(await page.evaluate("document.getElementById('fingInstrument').value"), 'kbd');

  // Switch explicitly to guitar to pin the rest of the test down.
  await page.evaluate(`(function () {
    const sel = document.getElementById('fingInstrument');
    sel.value = 'gtr'; sel.dispatchEvent(new Event('change'));
  })()`);
  assert.equal(await page.evaluate("document.getElementById('fingInstrument').value"), 'gtr');
  const initialDesc = await page.evaluate("document.getElementById('fingDesc').textContent");
  assert.match(initialDesc, /open/);
  assert.ok(await page.evaluate("document.querySelectorAll('.fing-fretboard .fing-string').length") >= 6);

  // Pick a different note: the description and the highlighted fret change.
  await page.evaluate(`(function () {
    const btns = [...document.querySelectorAll('.fing-note-btn')];
    const target = btns.find(b => b.textContent === 'D3');
    target.click();
  })()`);
  const afterDesc = await page.evaluate("document.getElementById('fingDesc').textContent");
  assert.match(afterDesc, /D3/);
  assert.notEqual(afterDesc, initialDesc);
  assert.ok(await page.evaluate("document.querySelectorAll('.fing-fret.fing-hit').length") >= 1);

  // Switch instrument to the harmonica: a different diagram kind appears.
  await page.evaluate(`(function () {
    const sel = document.getElementById('fingInstrument');
    sel.value = 'harp'; sel.dispatchEvent(new Event('change'));
  })()`);
  assert.equal(await page.evaluate("document.querySelectorAll('.fing-harmonica .fing-hole').length"), 10);
  const harpDesc = await page.evaluate("document.getElementById('fingDesc').textContent");
  assert.match(harpDesc, /hole 1 blow/);

  // The instrument picker lists only instruments with a mapped fingering.
  const options = await page.evaluate("[...document.getElementById('fingInstrument').options].map(o => o.value)");
  assert.ok(options.includes('trumpet-bb'));
  assert.ok(options.includes('trombone'));
  assert.ok(options.includes('recorder-descant'));
  assert.ok(options.includes('voice'));
  assert.ok(!options.includes('kbd'));
  assert.ok(!options.includes('wind'));

  // Closing and reopening keeps the panel usable (mount runs once).
  await page.evaluate('window.__coach.closePanel()');
  await page.evaluate("window.__coach.openPanel('fingerings')");
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'fingerings');
});
