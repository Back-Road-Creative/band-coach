// The kit is drawn once. The set-up sheet and the "How to play it" panel are the same drawing (same shapes, icons and
// words for the same prefs, a saved placement and left-handed included), and the trainer canvas takes its words and its
// icon outlines from the same place. Words and the pieces come from the pictures themselves, never from src/**.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchPage } from '../helpers/browser.mjs';
import { HTML_PATH } from '../helpers/html-path.mjs';

const SPY = `
  window.__texts = []; window.__paths = [];
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (s, ...r) { window.__texts.push(String(s)); return orig.call(this, s, ...r); };
  const P2 = window.Path2D; window.Path2D = function (d) { window.__paths.push(String(d)); return new P2(d); };
`;
const PIECES = ['kick', 'snare', 'hihat-closed', 'hihat-open', 'hihat-pedal', 'tom-high', 'tom-mid', 'tom-floor', 'crash', 'ride'];
const read = (sel) => `Object.fromEntries([...document.querySelectorAll('${sel} [data-piece]')].map(el => {
  const root = el.closest('svg'), id = el.dataset.piece, ic = root.querySelector('[data-icon="' + id + '"]'), lab = root.querySelector('[data-label="' + id + '"]');
  return [id, { tag: el.tagName, geo: ['cx', 'cy', 'r', 'x', 'y', 'width', 'height'].map(a => el.getAttribute(a)).join(','), d: ic && ic.getAttribute('d'), word: lab && lab.textContent }];
}))`;

for (const [name, prefs] of [['default', {}], ['saved placement, left-handed', { leftHanded: true, placements: { snare: { x: 0.6, y: 0.5, scale: 1.2 } } }], ['compact', { preset: 'compact' }]]) {
  test(`the set-up picture and the panel are one drawing (${name}), and the trainer reuses its words and icons`, async t => {
    const page = await launchPage(HTML_PATH, { initScript: SPY });
    t.after(() => page.close());
    await page.setViewport({ width: 390, height: 844, mobile: true });
    await page.evaluate(`window.__coach.db().prefs.kit = ${JSON.stringify(prefs)}; window.__coach.setMod('drum-kit')`);
    await page.waitFor('window.__texts.includes("Kick")');
    await page.evaluate("document.getElementById('setupBtn').click()");
    await page.waitFor("!!document.querySelector('#kitPreview [data-piece=\"snare\"]')");
    await page.evaluate("window.__coach.openPanel('fingerings')");
    await page.waitFor("document.querySelector('.fing-drumkit [data-piece=\"snare\"]')");
    const sheet = await page.evaluate(read('#kitPreview')), panel = await page.evaluate(read('.fing-drumkit'));
    assert.deepEqual(Object.keys(panel).sort(), PIECES.slice().sort());
    for (const id of PIECES) {
      assert.ok(sheet[id].d && sheet[id].word, id + ' has an icon and a name on the set-up sheet');
      assert.equal(panel[id].d, sheet[id].d, id + ' has the same icon on the panel');
      assert.equal(panel[id].word, sheet[id].word, id + ' has the same name on the panel');
      assert.equal(panel[id].tag, sheet[id].tag, id + ' is the same shape on the panel');
    }
    // the trainer draws each icon outline from the same path string, and writes each piece's words (a tom may split over two lines)
    const canvas = await page.evaluate('({ texts: window.__texts, paths: window.__paths })');
    for (const id of PIECES) assert.ok(canvas.paths.includes(sheet[id].d), id + ' icon is drawn on the trainer from the same path');
    for (const id of PIECES) {
      const w = sheet[id].word;
      assert.ok(canvas.texts.includes(w) || (w.includes(' ') && canvas.texts.includes(w.split(' ')[0]) && canvas.texts.includes(w.split(' ').slice(1).join(' '))), id + ' is named "' + w + '" on the trainer');
    }
  });
}

test('on the panel a cymbal is an outline and a drum is filled, as they were before the kit was one drawing', async t => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.setViewport({ width: 390, height: 844, mobile: true });
  await page.evaluate("window.__coach.setMod('drum-kit'); window.__coach.openPanel('fingerings')");
  await page.waitFor("document.querySelector('.fing-drumkit [data-piece=\"snare\"]')");
  const fills = await page.evaluate(`Object.fromEntries([...document.querySelectorAll('.fing-drumkit [data-piece]:not(.fing-hit)')].map(el => [el.dataset.piece, getComputedStyle(el).fill]))`);
  assert.equal(fills.ride, 'none');
  assert.equal(fills.crash, 'none');
  assert.notEqual(fills['tom-floor'], 'none');
});
