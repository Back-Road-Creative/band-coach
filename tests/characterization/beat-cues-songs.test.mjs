// Songs: during a try, a beat guide shows the count and a runway of the notes
// coming toward a "now" line. Read from the canvas's own data-* attributes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { skipDemo } from '../helpers/songs-demo.mjs';
import { starterById } from '../../src/song/starter/index.js';

const GUIDE = "document.querySelector('.panel-songs-beat-guide')";
const btn = (text) => `Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === '${text}')`;

async function toTurn(page, mod, mode, title = 'Hot Cross Buns') {
  await page.evaluate(`window.__coach.setMod('${mod}')`);
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(`Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === ${JSON.stringify(title)}).click()`);
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  if (mode) {
    await page.evaluate(`document.querySelector('.panel-songs-mode [data-mode="${mode}"]').click()`);
    await page.waitFor(`document.querySelector('.panel-songs-mode [data-mode="${mode}"]').getAttribute('aria-pressed') === 'true'`);
  }
  while (!(await page.evaluate(`!!${btn('Your turn')}`))) {
    await page.evaluate(`${btn('Next')}.click()`);
    await skipDemo(page);
    await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  }
}

test('a try shows the count, then a runway of notes, then goes away when it stops', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await toTurn(page, 'kbd');
  assert.equal(await page.evaluate(`!!${GUIDE}`), false, 'no guide before a try');
  await page.evaluate(`${btn('Your turn')}.click()`);
  await page.waitFor(`${GUIDE} && ${GUIDE}.dataset.phase === 'count' && ${GUIDE}.dataset.beat === '2'`, 10000);
  assert.ok(await page.evaluate(`${GUIDE}.getAttribute('aria-label').length > 0`), 'the canvas is named for a screen reader');
  await page.waitFor(`${GUIDE}.dataset.phase === 'play' && Number(${GUIDE}.dataset.blocks) > 0`, 10000);
  assert.equal(await page.evaluate(`${GUIDE}.dataset.runway`), 'on');
  await page.waitFor(`Number(${GUIDE}.dataset.clicks) > 0`, 5000);
  await page.evaluate(`${btn('Stop and check')}.click()`);
  await page.waitFor(`!${GUIDE}`, 5000);
  assert.deepEqual(page.exceptions, []);
});

test('closing the panel ends the try, so the guide cannot keep clicking behind it', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await toTurn(page, 'kbd');
  await page.evaluate(`${btn('Your turn')}.click()`);
  await page.waitFor(`${GUIDE} && ${GUIDE}.dataset.phase === 'play'`, 10000);
  await page.evaluate('window.__coach.closePanel()');
  await page.waitFor(`!${GUIDE}`, 5000);
  assert.deepEqual(page.exceptions, []);
});

test('Check keeps its no-help promise: the count-in shows, then nothing to follow', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await toTurn(page, 'kbd', 'check');
  await page.evaluate(`${btn('Your turn')}.click()`);
  await page.waitFor(`${GUIDE} && ${GUIDE}.dataset.phase === 'count'`, 10000);
  assert.equal(await page.evaluate(`${GUIDE}.dataset.runway`), 'off');
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')", 10000);
  await page.waitFor(`${GUIDE}.dataset.phase === 'done'`, 5000);
  assert.equal(await page.evaluate(`${GUIDE}.dataset.blocks`), '0');
  assert.equal(await page.evaluate(`${GUIDE}.dataset.clicks`), '0', 'no click to lean on');
});

test('the drums-in-order step has no clock, so it counts in and shows nothing to keep time with', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await toTurn(page, 'drum-kit', null, starterById('groove-rock').title);
  assert.match(await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent"), /^Play the drums in order/);
  await page.evaluate(`${btn('Your turn')}.click()`);
  await page.waitFor(`${GUIDE} && ${GUIDE}.dataset.phase === 'count'`, 10000);
  assert.equal(await page.evaluate(`${GUIDE}.dataset.runway`), 'off');
  await page.waitFor(`${GUIDE}.dataset.phase === 'done'`, 10000);
  assert.equal(await page.evaluate(`${GUIDE}.hidden`), true, 'nothing is left on screen once the count-in ends');
});

test('a mic instrument gets the runway but no clicks, which the mic would hear as notes', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await toTurn(page, 'gtr');
  await page.evaluate(`${btn('Your turn')}.click()`);
  await page.waitFor(`${GUIDE} && ${GUIDE}.dataset.phase === 'play' && Number(${GUIDE}.dataset.index) >= 1`, 15000);
  assert.equal(await page.evaluate(`${GUIDE}.dataset.runway`), 'on');
  assert.equal(await page.evaluate(`${GUIDE}.dataset.clicks`), '0');
});

test('reduced motion: the runway steps by the beat instead of sliding', async (t) => {
  const page = await launchPage(HTML_PATH, { reducedMotion: true });
  t.after(() => page.close());
  await toTurn(page, 'kbd');
  await page.evaluate(`${btn('Your turn')}.click()`);
  await page.waitFor(`${GUIDE} && ${GUIDE}.dataset.phase === 'play'`, 10000);
  assert.equal(await page.evaluate(`${GUIDE}.dataset.motion`), 'step');
});

// Seen on screen: the page-wide canvas rule stretched this strip to 16:8.2 and
// squashed its text, and on a long step the strip started below the fold.
for (const [name, size] of [['desktop', { width: 800, height: 600 }], ['phone', { width: 390, height: 700, mobile: true }]]) {
  test(`${name}: the guide keeps its own shape and is on screen, clear of the transport`, async (t) => {
    const page = await launchPage(HTML_PATH);
    t.after(() => page.close());
    await page.setViewport(size);
    await toTurn(page, 'kbd');
    await page.evaluate(`${btn('Your turn')}.click()`);
    await page.waitFor(`${GUIDE} && ${GUIDE}.dataset.phase === 'count'`, 10000);
    const { ratio, drawn, top, bottom, limit, pageWide, viewport } = await page.evaluate(`(() => {
      const c = ${GUIDE}, r = c.getBoundingClientRect(), bar = document.querySelector('.panel-songs-transport');
      const fixed = bar && getComputedStyle(bar).position === 'fixed';
      return { ratio: c.width / c.height, drawn: r.width / r.height, top: r.top, bottom: r.bottom, limit: fixed ? bar.getBoundingClientRect().top : innerHeight, pageWide: document.documentElement.scrollWidth, viewport: innerWidth };
    })()`);
    assert.ok(Math.abs(drawn - ratio) < 0.05, `drawn at ${drawn}:1, the canvas is ${ratio}:1`);
    assert.ok(top >= 0 && bottom <= limit, `guide spans ${top}..${bottom}, the visible area ends at ${limit}`);
    assert.ok(pageWide <= viewport, 'the page does not scroll sideways');
  });
}
