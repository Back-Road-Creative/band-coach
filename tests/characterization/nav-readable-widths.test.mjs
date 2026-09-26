// P2a/P2b nav bar at real phone widths (320-390 CSS px): the old
// `text-overflow: ellipsis` rule (see the P2a/P2b comment above
// `.main-nav` in src/styles.css) traded readability for a single row --
// measured against this build, at 390px Practice/Songs/Progress/Instrument/
// Settings rendered as truncated fragments (`Pr…`, `S…`, `Pr…`, a name-
// bearing `C…`/`I…`, `S…`) with two pairs indistinguishable from each other.
// This proves every label stays fully readable -- no ellipsis, no
// overlapping buttons, nothing clipped by the nav -- at both 320 and 390,
// and that a long instrument name (real or simulated) never brings the
// ellipsis back, without breaking the first-phone-screen contract that
// journey-first-visit.test.mjs pins for #playBtn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { rectOf, assertInFirstScreen } from '../helpers/journey.mjs';

const htmlPath = HTML_PATH;

// Every pairwise pair of `.main-nav button` rects, so a caller can assert
// "nothing overlaps" without hand-writing combinations.
function overlaps(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

async function navButtonRects(page) {
  const json = await page.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('.main-nav button')).map(b => {
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    return {
      route: b.dataset.route,
      text: b.textContent.trim(),
      scrollWidth: b.scrollWidth,
      clientWidth: b.clientWidth,
      textOverflow: cs.textOverflow,
      top: r.top, bottom: r.bottom, left: r.left, right: r.right,
    };
  }))`);
  return JSON.parse(json);
}

for (const width of [320, 390]) {
  test(`at ${width}px, Practice/Songs/Progress stay fully readable with no ellipsis and no overlap`, async (t) => {
    const page = await launchPage(htmlPath);
    t.after(() => page.close());
    await page.setViewport({ width, height: 844, mobile: true });

    const rects = await navButtonRects(page);
    assert.equal(rects.length, 5, 'five nav buttons');

    for (const route of ['practice', 'songs', 'progress']) {
      const r = rects.find((x) => x.route === route);
      assert.ok(r, `${route} button exists`);
      assert.notEqual(r.textOverflow, 'ellipsis', `${width}px ${route}: text-overflow must not be ellipsis (label was ${JSON.stringify(r.text)})`);
      assert.ok(r.scrollWidth <= r.clientWidth, `${width}px ${route}: scrollWidth ${r.scrollWidth} exceeds clientWidth ${r.clientWidth} -- label ${JSON.stringify(r.text)} is clipped`);
    }

    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        assert.ok(!overlaps(rects[i], rects[j]), `${width}px: ${rects[i].route} and ${rects[j].route} bounding boxes overlap`);
      }
    }

    const navRect = await page.evaluate("(() => { const r = document.getElementById('mainNav').getBoundingClientRect(); return JSON.stringify({ top: r.top, bottom: r.bottom, left: r.left, right: r.right }); })()").then(JSON.parse);
    const navOverflow = await page.evaluate("getComputedStyle(document.getElementById('mainNav')).overflow");
    assert.notEqual(navOverflow, 'hidden', 'the nav container must not clip its own buttons');
    for (const r of rects) {
      assert.ok(r.top >= navRect.top - 1 && r.bottom <= navRect.bottom + 1, `${width}px ${r.route}: button rect falls outside the nav container (clipped)`);
    }
  });
}

test('the current-instrument and Settings buttons keep a visible or accessible name at 320px', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());
  await page.setViewport({ width: 320, height: 844, mobile: true });

  const instrumentAccessibleName = await page.evaluate("(document.getElementById('navInstrument').getAttribute('aria-label') || document.getElementById('navInstrument').textContent).trim()");
  assert.match(instrumentAccessibleName, /guitar/i, 'the instrument button names the saved instrument somewhere a screen reader reaches');

  const settingsAccessibleName = await page.evaluate("(() => { const b = document.querySelector('#mainNav button[data-route=\"settings\"]'); return (b.getAttribute('aria-label') || b.textContent).trim(); })()");
  assert.ok(settingsAccessibleName.length > 0, 'Settings has a non-empty visible or accessible name');
});

test('a long instrument name does not reintroduce ellipsis or overlap at 320px', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.setViewport({ width: 320, height: 844, mobile: true });

  // Simulates the longest real instrument record name
  // (src/instruments/mallet-percussion.js: 'Mallet percussion (bells)')
  // run through the same 'nav.instrument' template app.js's
  // updateNavInstrumentLabel() uses, without needing a real picker pick.
  await page.evaluate("document.getElementById('navInstrument').textContent = 'Instrument: Mallet percussion (bells)'");

  const rects = await navButtonRects(page);
  for (const r of rects) {
    assert.notEqual(r.textOverflow, 'ellipsis', `long-name case: ${r.route} text-overflow is ellipsis (label ${JSON.stringify(r.text)})`);
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      assert.ok(!overlaps(rects[i], rects[j]), `long-name case: ${rects[i].route} and ${rects[j].route} overlap`);
    }
  }
});

test('the fresh first paint at 390x844 still keeps #playBtn in the first screen with the new nav layout', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.setViewport({ width: 390, height: 844, mobile: true });
  assertInFirstScreen(await rectOf(page, '#playBtn'), 844, 'fresh first paint, 390px, new nav layout');
});

test('the fresh first paint at 320x844 still keeps #playBtn in the first screen with the new nav layout', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.setViewport({ width: 320, height: 844, mobile: true });
  assertInFirstScreen(await rectOf(page, '#playBtn'), 844, 'fresh first paint, 320px, new nav layout');
});
