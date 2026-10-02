// The drum kit is drawn big and in words: each piece carries its drum name
// (Kick, Snare, Hi-hat ...) with the computer key only as a small hint, and
// with no notation bar showing the kit fills the canvas height instead of
// huddling in half of it. The canvas is also taller for kit instruments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { kitLayout, spreadX } from '../../src/instruments/how/drum-kit.js';
import { launchPage } from '../helpers/browser.mjs';

const SPY = `
  window.__texts = [];
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (s, ...r) { window.__texts.push({ s: String(s), font: this.font }); return orig.call(this, s, ...r); };
`;

test('the kit is drawn full height, each piece named, the key only a hint', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: SPY });
  t.after(() => page.close());
  await page.setViewport({ width: 1440, height: 1200 });
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await page.waitFor('window.__texts.some(x => x.s === "Kick")');
  const texts = await page.evaluate('window.__texts.map(x => x.s)');
  for (const name of ['Kick', 'Snare', 'Hi-hat', 'Floor tom', 'Crash', 'Ride']) assert.ok(texts.includes(name), name + ' is drawn');
  const px = await page.evaluate('Math.min(...window.__texts.filter(x => x.s === "Kick").map(x => parseFloat(x.font.match(/([0-9.]+)px/)[1])))');
  assert.ok(px >= 13, 'drum names are at least 13px, got ' + px);
  const { b, W, H, cls } = await page.evaluate('({ b: window.__coach.kitBox(), W: document.getElementById("cv").width, H: document.getElementById("cv").height, cls: getComputedStyle(document.getElementById("cv")).aspectRatio })');
  assert.ok(b.h >= 0.85 * H, 'kit box ' + b.h + ' of canvas height ' + H);
  assert.ok(b.w >= 0.9 * W, 'kit box ' + b.w + ' of canvas width ' + W);
  assert.match(cls, /^16 \/ 10$/, 'kit canvas is taller');

  // with a notation bar showing, the staff keeps the top and the kit still gets at least 0.6 of the height
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.bar() && window.__coach.bar().staff');
  await page.waitFor('window.__coach.kitBox().h < 0.9 * document.getElementById("cv").height');
  const d = await page.evaluate('({ b: window.__coach.kitBox(), W: document.getElementById("cv").width, H: document.getElementById("cv").height, labels: window.__coach.kitLabels() })');
  assert.ok(d.b.h >= 0.6 * d.H, 'kit with a bar ' + d.b.h + ' of ' + d.H);
  const m = Math.min(d.b.w, d.b.h);
  assert.equal(d.labels.length, 10, 'every piece has a label box');
  for (let i = 0; i < d.labels.length; i++) for (let j = i + 1; j < d.labels.length; j++) { const a = d.labels[i], c = d.labels[j]; assert.ok(a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h <= c.y || c.y + c.h <= a.y, a.id + ' and ' + c.id + ' labels overlap'); }
  for (const l of d.labels) for (const p of kitLayout()) { if (p.id === l.id) continue; const cx = d.b.x + spreadX(p.x) * d.b.w, cy = d.b.y + p.y * d.b.h, nx = Math.max(l.x, Math.min(cx, l.x + l.w)), ny = Math.max(l.y, Math.min(cy, l.y + l.h)); assert.ok(Math.hypot(cx - nx, cy - ny) > p.r * m, l.id + ' label runs into the ' + p.id + ' drum'); }
  for (const l of d.labels) { assert.ok(l.x >= 0 && l.x + l.w <= d.W && l.y >= 0 && l.y + l.h <= d.H, l.id + ' label is inside the canvas'); }
  for (const p of kitLayout()) { const x = d.b.x + spreadX(p.x) * d.b.w, y = d.b.y + p.y * d.b.h, r = p.r * m; assert.ok(r >= 0.055 * m, p.id + ' radius ' + r); assert.ok(x - r >= 0 && x + r <= d.W && y - r >= 0 && y + r <= d.H, p.id + ' is inside the canvas'); }
});
