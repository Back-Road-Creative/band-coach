// F14: on a phone the song transport (Play it / Your turn / Next) stays on
// screen while the learner scrolls the lesson, safe-area aware; on a desktop it
// sits in the flow like any other control.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

async function openSong(page, width, height, mobile) {
  await page.setViewport({ width, height, mobile });
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()");
  await page.waitFor("document.querySelector('.panel-songs-transport')");
}
const rect = (page) => page.evaluate("(() => { const r = document.querySelector('.panel-songs-transport').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight }; })()");

test('phone: the song transport stays inside the viewport at the top and the bottom of the page', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openSong(page, 375, 667, true);
  assert.ok(await page.evaluate('document.documentElement.scrollHeight > innerHeight + 50'), 'the lesson page must scroll for this test to mean anything');
  for (const [where, y] of [['top', '0'], ['bottom', 'document.documentElement.scrollHeight']]) {
    await page.evaluate(`window.scrollTo(0, ${y})`);
    const r = await rect(page);
    assert.ok(r.top >= 0 && r.bottom <= r.h + 1, `transport inside the viewport at the ${where} (top ${r.top}, bottom ${r.bottom}, height ${r.h})`);
  }
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('.panel-songs-transport')).position"), 'fixed');
  // At the bottom nothing is hidden under the bar: the section's last child ends above the bar's top edge.
  const gap = await page.evaluate("(() => { const s = document.querySelector('.panel-songs-practice'); return document.querySelector('.panel-songs-transport').getBoundingClientRect().top - s.lastElementChild.getBoundingClientRect().bottom; })()");
  assert.ok(gap >= 0, `last child ends above the transport (gap ${gap})`);
});

test('phone: the bar is not on screen in the song list', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.setViewport({ width: 375, height: 667, mobile: true });
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  assert.equal(await page.evaluate("(() => { const e = document.querySelector('.panel-songs-transport'); return !e || !e.getClientRects().length; })()"), true);
});

test('desktop: the song transport is not fixed', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openSong(page, 1280, 800, false);
  assert.notEqual(await page.evaluate("getComputedStyle(document.querySelector('.panel-songs-transport')).position"), 'fixed');
});
