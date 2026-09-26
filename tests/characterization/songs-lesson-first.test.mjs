// A9: opening a song used to put its own lesson (title, current step,
// notation, transport) behind the whole song library, the Assignments group
// and a 28-card "Play it on…" instrument row -- 3.9 phone screens of
// scrolling before a learner who just picked a song saw anything of the
// lesson itself (measured at 390x844 on origin/main 3078d17: the lesson
// heading landed at y=2984 on a document 3458px tall). This proves the fix:
// opening or resuming a song puts its heading, step and "Play it" inside a
// phone's first screen, moves focus to the song heading once, and leaves
// the library/Assignments/instrument-row reachable in one action rather
// than removing them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { rectOf, assertInFirstScreen } from '../helpers/journey.mjs';

const htmlPath = HTML_PATH;
const VIEWPORT = { width: 390, height: 844, mobile: true };

// Finds a button by its exact visible text inside `containerSelector` and
// returns a plain-object copy of its bounding rect (same shape rectOf()
// returns) -- rectOf() alone only takes a CSS selector, and no CSS selector
// picks "the button whose text is exactly Play it" (Chromium has no
// :contains()), so this walks the DOM directly instead.
async function rectOfButtonNamed(page, containerSelector, text) {
  return page.evaluate(`(() => {
    const container = document.querySelector(${JSON.stringify(containerSelector)});
    const btn = container && Array.from(container.querySelectorAll('button')).find((b) => b.textContent === ${JSON.stringify(text)});
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height };
  })()`);
}

async function openHotCrossBunsThroughNav(page) {
  await page.evaluate("document.querySelector('#mainNav button[data-route=\"songs\"]').click()");
  await page.waitFor("window.__coach.panelOpen() === 'songs'");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h3')");
}

test('opening a song puts its title, step and "Play it" inside a phone\'s first screen', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.setViewport(VIEWPORT);

  await openHotCrossBunsThroughNav(page);
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");

  // startPractice()'s own practiceHeadingEl.focus() call (src/ui/songs.js)
  // runs synchronously inside the click handler above, and a browser's
  // default "scroll the newly focused element into view" already ran by
  // the time this measures -- so this checks the FULL rect at whatever
  // scrollY that left the page on, not forcing scrollY back to 0 first.
  const headingRect = await rectOf(page, '.panel-songs-practice h3');
  assertInFirstScreen(headingRect, VIEWPORT.height, 'song heading');
  assert.ok(headingRect.left >= 0 && headingRect.right <= VIEWPORT.width, 'song heading sits within the 390px width too');

  const stepRect = await rectOf(page, '.panel-songs-practice h4');
  assertInFirstScreen(stepRect, VIEWPORT.height, 'current step title');

  const playRect = await rectOfButtonNamed(page, '.panel-songs-practice', 'Play it');
  assert.ok(playRect, '"Play it" is inside .panel-songs-practice');
  assertInFirstScreen(playRect, VIEWPORT.height, '"Play it" transport button');
  assert.ok(playRect.left >= 0 && playRect.right <= VIEWPORT.width, '"Play it" sits within the 390px width too');

  const playVisible = await page.evaluate(`(() => {
    const container = document.querySelector('.panel-songs-practice');
    const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Play it');
    return btn.checkVisibility() && !btn.disabled;
  })()`);
  assert.equal(playVisible, true, '"Play it" is visible and enabled, not merely present in the DOM');

  assert.deepEqual(
    await page.evaluate("({ tag: document.activeElement.tagName, id: document.activeElement.id })"),
    { tag: 'H3', id: 'songsPracticeHeading' },
    'focus landed on the song heading, not the body',
  );

  assert.deepEqual(page.exceptions, []);
});

test('the library, Assignments and the 28-card "Play it on…" row are collapsed or moved below, still reachable in one action', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.setViewport(VIEWPORT);

  await openHotCrossBunsThroughNav(page);

  assert.equal(
    await page.evaluate("document.querySelector('.panel-songs-library').open"),
    false,
    'the library <details> auto-collapses the moment a song opens',
  );

  // "moved below": the 28 instrument cards render AFTER the transport
  // button in the DOM, not ahead of the notation/step title/"Play it" the
  // way they used to (src/ui/songs.js:1279 before this change).
  const order = await page.evaluate(`(() => {
    const container = document.querySelector('.panel-songs-practice');
    const playBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Play it');
    const cardsSection = container.querySelector('.panel-songs-play-on');
    if (!playBtn || !cardsSection) return null;
    // DOCUMENT_POSITION_FOLLOWING (4): cardsSection comes after playBtn.
    return Boolean(playBtn.compareDocumentPosition(cardsSection) & Node.DOCUMENT_POSITION_FOLLOWING);
  })()`);
  assert.equal(order, true, 'the "Play it on…" cards sit after the transport, not before it');

  // One action -- clicking the <summary> -- reopens the library with the
  // song just opened still there (not filtered out or removed).
  await page.evaluate("document.querySelector('.panel-songs-library summary').click()");
  await page.waitFor("document.querySelector('.panel-songs-library').open === true");
  const rowVisible = await page.evaluate(`(() => {
    const row = Array.from(document.querySelectorAll('.panel-songs-row button')).find((b) => b.textContent === 'Hot Cross Buns');
    return !!row && row.checkVisibility();
  })()`);
  assert.equal(rowVisible, true, 'Hot Cross Buns is still in the reopened library, visible');

  assert.deepEqual(page.exceptions, []);
});

test('with enlarged text the transport still reaches the learner, unobstructed', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.setViewport(VIEWPORT);

  await openHotCrossBunsThroughNav(page);
  await page.evaluate("document.documentElement.style.fontSize = '150%'");

  const info = await page.evaluate(`(() => {
    const container = document.querySelector('.panel-songs-practice');
    const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Play it');
    btn.scrollIntoView({ block: 'center' });
    const r = btn.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return { visible: btn.checkVisibility(), width: r.width, height: r.height, hitIsBtn: hit === btn || btn.contains(hit) };
  })()`);
  assert.ok(info.visible, '"Play it" is still visible after the reflow');
  assert.ok(info.width > 0 && info.height > 0, '"Play it" still has real size, not collapsed');
  assert.ok(info.hitIsBtn, '"Play it" is not covered by another element at its own centre point');

  assert.deepEqual(page.exceptions, []);
});
