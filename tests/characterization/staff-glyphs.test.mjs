// The practice staff draws its clef as a vector path (src/notation/glyphs.js CLEF_PATHS),
// not a Unicode music symbol -- a device with no music font shows an empty box for U+1D11E --
// and the note-name label sits below the note instead of on top of a low notehead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { CLEF_PATHS } from '../../src/notation/glyphs.js';

const SPY = `
  window.__texts = []; window.__heads = []; window.__paths = [];
  const P = CanvasRenderingContext2D.prototype, ft = P.fillText, el = P.ellipse, P2 = window.Path2D;
  P.fillText = function (s, x, y) { window.__texts.push({ s: String(s), x, y }); return ft.apply(this, arguments); };
  P.ellipse = function (x, y, rx, ry) { window.__heads.push({ x, y, ry }); return el.apply(this, arguments); };
  window.Path2D = function (d) { window.__paths.push(d); return new P2(d); };
`;

test('clarinet practice staff: clef is a vector path and the G3 label clears its notehead', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: SPY });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('clarinet-bb')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__texts.some(x => x.s === "G3")');
  const texts = await page.evaluate('window.__texts.map(x => x.s)');
  assert.ok(!texts.includes('\u{1D11E}') && !texts.includes('\u{1D122}'), 'no Unicode clef glyph is drawn (tofu without a music font)');
  assert.ok((await page.evaluate('window.__paths')).includes(CLEF_PATHS.treble), 'the treble clef is drawn from CLEF_PATHS');
  const gap = await page.evaluate(`(() => { const l = window.__texts.filter(x => x.s === 'G3').pop(), h = window.__heads.filter(x => Math.abs(x.x - l.x) < 0.5).pop(); return h ? (l.y - 2 * h.ry) - (h.y + h.ry) : null; })()`);
  assert.notEqual(gap, null, 'the G3 label has a notehead at its x');
  assert.ok(gap >= 0, 'label top is ' + (-gap) + 'px inside the notehead');
});
