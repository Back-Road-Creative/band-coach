// Mallet percussion draws a row of bars (naturals in front, accidentals raised behind, shorter
// with pitch), not black/white piano keys; the treble staff can be turned on; the hint says "bar".
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

async function open(t, width) {
  const page = await launchPage(HTML_PATH, { initScript: SPY });
  t.after(() => page.close());
  await page.setViewport({ width, height: 844, mobile: width < 500, deviceScaleFactor: 2 });
  await page.evaluate("window.__coach.setMod('mallet-percussion')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task() && window.__coach.kbdKeys().length > 10');
  return page;
}

test('desktop: one row of bars, accidentals raised behind, lengths shrink with pitch', async (t) => {
  const page = await open(t, 1200);
  const k = await page.evaluate('window.__coach.kbdKeys()');
  const nat = k.filter(b => !b.black).sort((a, b) => a.m - b.m), acc = k.filter(b => b.black);
  assert.equal(nat.length, 15); assert.equal(acc.length, 10);
  for (let i = 1; i < nat.length; i++) assert.ok(nat[i].h < nat[i - 1].h, 'bar ' + nat[i].m + ' shorter than the one below');
  // A piano's keys all share one top and height; bars do not.
  assert.ok(new Set(nat.map(b => Math.round(b.h))).size > 5);
  for (const a of acc) { const n = nat.find(b => b.m === a.m - 1); assert.ok(a.y < n.y, 'accidental ' + a.m + ' sits behind (above) its natural'); }
  assert.deepEqual(page.exceptions, []);
});

test('phone: two rows, every bar at least 24 CSS px wide, labels readable', async (t) => {
  const page = await open(t, 390);
  const d = await page.evaluate(`(() => ({ k: window.__coach.kbdKeys(), r: document.getElementById('cv').getBoundingClientRect().width / document.getElementById('cv').width, ct: window.__ct.slice() }))()`);
  const nat = d.k.filter(b => !b.black);
  assert.equal(nat.length, 15);
  assert.equal(new Set(nat.map(b => Math.round(b.y))).size >= 2, true);
  for (const b of nat) assert.ok(b.w * d.r >= 24, `bar ${b.m} is ${b.w * d.r} css px wide`);
  const labels = d.ct.filter(c => /^[A-G]\d?$/.test(c.s));
  assert.ok(labels.length >= 15);
  for (const c of labels) assert.ok(c.px * d.r >= 9, 'label ' + c.s + ' ' + c.px * d.r + ' css px');
});

test('the staff option is offered and drawn for mallet percussion; the hint says bar', async (t) => {
  const page = await open(t, 1200);
  assert.equal(await page.evaluate("!!document.getElementById('optNotate')"), true);
  await page.evaluate("window.__coach.setNotate('staff')");
  await page.waitFor("window.__coach.lastStaff() && window.__coach.lastStaff().clef === 'treble'");
  const hint = await page.evaluate("document.getElementById('hint').textContent");
  assert.doesNotMatch(hint, /\bkey\b/i);
  assert.deepEqual(page.exceptions, []);
});
