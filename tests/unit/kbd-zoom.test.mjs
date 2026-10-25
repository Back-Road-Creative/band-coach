// F18: a 320px phone cannot fit two rows of the on-screen piano at a tappable size (white keys came out
// about 43x40 CSS px, the right-hand row narrower still). Below the width where the two rows' 8-white
// right-hand row would fall under item D2's 40px floor, the keyboard zooms: one row of as many white keys as fit at 44px or more (black keys at least the
// 24px WCAG 2.5.8 floor), with "Lower keys"/"Higher keys" buttons to slide the window across C3-C5, and a
// target the coach shows is always brought into the window. A 390px phone still gets both rows, unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const GEO = `(function () {
  const cv = document.getElementById('cv'), s = cv.getBoundingClientRect().width / cv.width, k = window.__coach.kbdKeys();
  const w = k.filter(q => !q.black), b = k.filter(q => q.black), ms = k.map(q => q.m);
  return { n: k.length, lo: Math.min(...ms), hi: Math.max(...ms), whiteW: Math.min(...w.map(q => q.w * s)), whiteH: Math.min(...w.map(q => q.h * s)), blackW: b.length ? Math.min(...b.map(q => q.w * s)) : 99,
    lower: !document.getElementById('kbdLower').hidden, higher: !document.getElementById('kbdHigher').hidden,
    lowerOff: document.getElementById('kbdLower').disabled, higherOff: document.getElementById('kbdHigher').disabled };
})()`;

async function phone(page, width, height) {
  await page.setViewport({ width, height, mobile: true, deviceScaleFactor: 2 });
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.waitFor(`document.getElementById('cv').width === Math.round(document.getElementById('cv').getBoundingClientRect().width * 2) && window.__coach.kbdKeys().length > 0`);
}

test('at 320x568 the keyboard zooms to one row of 44px white keys, and the buttons slide it across C3-C5', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await phone(page, 320, 568);
  const a = await page.evaluate(GEO);
  assert.ok(a.whiteW >= 44 && a.whiteH >= 44, 'white keys are at least 44x44 CSS px: ' + JSON.stringify(a));
  assert.ok(a.blackW >= 24, 'black keys are at least 24 CSS px wide: ' + JSON.stringify(a));
  assert.ok(a.n < 25 && a.lo >= 48 && a.hi <= 72, 'one window inside C3-C5: ' + JSON.stringify(a));
  assert.ok(a.lower && a.higher, 'both slide buttons show');
  await page.evaluate("document.getElementById('kbdLower').click(); document.getElementById('kbdLower').click(); document.getElementById('kbdLower').click()");
  const low = await page.evaluate(GEO);
  assert.equal(low.lo, 48, 'Lower keys reaches C3');
  assert.ok(low.lowerOff && !low.higherOff, 'Lower keys is off at the bottom');
  await page.evaluate("for (let i = 0; i < 6; i++) document.getElementById('kbdHigher').click()");
  const high = await page.evaluate(GEO);
  assert.equal(high.hi, 72, 'Higher keys reaches C5');
  assert.ok(high.higherOff && !high.lowerOff, 'Higher keys is off at the top');
  assert.ok(high.whiteW >= 44, 'the window keeps its key size at the top');
});

test('a target the coach shows is brought into the zoomed window', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await phone(page, 320, 568);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.cur() && window.__coach.cur().info.midi');
  const target = await page.evaluate('window.__coach.cur().info.midi');
  // a first item can open already shown; hide it, then slide the window as far from the target as it goes
  await page.evaluate('(function () { const e = window.__coach.cur(); e.reveal = false; e.failed = false; })()');
  const away = target >= 60 ? 'kbdLower' : 'kbdHigher';
  await page.evaluate(`for (let i = 0; i < 6; i++) document.getElementById('${away}').click()`);
  const before = await page.evaluate(GEO);
  assert.ok(target < before.lo || target > before.hi, 'the target is out of the window first: ' + target + ' ' + JSON.stringify(before));
  await page.evaluate('window.__coach.cur().reveal = true');
  await page.waitFor(`(function () { const ms = window.__coach.kbdKeys().map(q => q.m); return ms.includes(${target}); })()`);
});

test('at 390x844 both rows stay, all 25 keys, with no slide buttons', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await phone(page, 390, 844);
  const a = await page.evaluate(GEO);
  assert.equal(a.n, 25, JSON.stringify(a));
  assert.deepEqual([a.lo, a.hi], [48, 72]);
  assert.ok(!a.lower && !a.higher, 'no slide buttons: ' + JSON.stringify(a));
});
