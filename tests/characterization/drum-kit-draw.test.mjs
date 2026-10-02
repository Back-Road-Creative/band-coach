// The drum kit is drawn big and in words: each piece carries its drum name
// (Kick, Snare, Hi-hat ...) with the computer key only as a small hint, and
// with no notation bar showing the kit fills the canvas height instead of
// huddling in half of it. The canvas is also taller for kit instruments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const SPY = `
  window.__texts = [];
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (s, ...r) { window.__texts.push({ s: String(s), font: this.font }); return orig.call(this, s, ...r); };
`;

test('the kit is drawn full height, each piece named, the key only a hint', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: SPY });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await page.waitFor('window.__texts.some(x => x.s === "Kick")');
  const texts = await page.evaluate('window.__texts.map(x => x.s)');
  for (const name of ['Kick', 'Snare', 'Hi-hat', 'Floor tom', 'Crash', 'Ride']) assert.ok(texts.includes(name), name + ' is drawn');
  const px = await page.evaluate('Math.min(...window.__texts.filter(x => x.s === "Kick").map(x => parseFloat(x.font.match(/([0-9.]+)px/)[1])))');
  assert.ok(px >= 13, 'drum names are at least 13px, got ' + px);
  const { s, H, cls } = await page.evaluate('({ s: window.__coach.kitBox().s, H: document.getElementById("cv").height, cls: getComputedStyle(document.getElementById("cv")).aspectRatio })');
  assert.ok(s >= 0.85 * H, 'kit box ' + s + ' of canvas height ' + H);
  assert.match(cls, /^16 \/ 10$/, 'kit canvas is taller');

  // with a notation bar showing, the staff keeps the top and the kit still gets at least 0.6 of the height
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.bar() && window.__coach.bar().staff');
  await page.waitFor('window.__coach.kitBox().s < 0.9 * document.getElementById("cv").height');
  const withBar = await page.evaluate('({ s: window.__coach.kitBox().s, H: document.getElementById("cv").height })');
  assert.ok(withBar.s >= 0.6 * withBar.H, 'kit with a bar ' + withBar.s + ' of ' + withBar.H);
});
