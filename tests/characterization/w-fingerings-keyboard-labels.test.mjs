// Keyboard note-name labels on a phone: every white-key label sits below the
// bottom edge of the black keys, not inside their band. Also guards that the
// trainer's How peek stays hidden on the keyboard (the canvas already is it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const SPY = `
  window.__ct = [];
  (function () {
    var proto = CanvasRenderingContext2D.prototype, orig = proto.fillText, clr = proto.clearRect;
    proto.clearRect = function () { window.__ct = []; return clr.apply(this, arguments); };
    proto.fillText = function (s) { window.__ct.push({ s: String(s), px: parseFloat(this.font.match(/([0-9.]+)px/)[1]), x: arguments[1], y: arguments[2] }); return orig.apply(this, arguments); };
  })();
`;

test('white-key name labels sit below the black keys on a phone', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: SPY });
  t.after(() => page.close());
  await page.setViewport({ width: 390, height: 844, mobile: true, deviceScaleFactor: 2 });
  await page.evaluate("document.querySelector('#picker button[data-mod=\"kbd\"]').click()");
  await page.waitFor('window.__coach.kbdKeys().length > 20 && window.__ct.length > 10');
  const d = await page.evaluate(`(() => { const keys = window.__coach.kbdKeys(), ct = window.__ct.slice(); return { keys, ct }; })()`);
  const whites = d.keys.filter(k => !k.black);
  assert.ok(whites.length >= 14);
  for (const k of whites) {
    const label = d.ct.find(c => /^[A-G]\d?$/.test(c.s) && c.x > k.x && c.x < k.x + k.w && c.y > k.y && c.y <= k.y + k.h + 1);
    assert.ok(label, 'label for key ' + k.m);
    const black = d.keys.find(b => b.black && b.row === k.row);
    assert.ok(label.y - label.px >= black.y + black.h - 0.01, `key ${k.m}: label top ${label.y - label.px} inside black band ending ${black.y + black.h}`);
  }
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor("document.querySelector('#prompt b')");
  assert.equal(await page.evaluate("document.getElementById('howPeekHost').hidden"), true);
  assert.deepEqual(page.exceptions, []);
});
