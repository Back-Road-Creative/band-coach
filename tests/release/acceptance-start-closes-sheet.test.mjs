// A first-time phone learner picks Keyboard, then presses Start (Start is hidden until a pick, and a Start
// pressed anyway is refused: see acceptance-first-visit). The sheet must stay shut and the nav must read
// "Instrument: Keyboard": otherwise the sheet's height pushes the prompt and the drawn keys below the fold
// while the answer timer runs. Release file, real tap on Start; page.evaluate only observes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';

test('Start after the pick on a fresh phone profile keeps the instrument sheet shut and the exercise on screen', async (t) => {
  await withAcceptancePage(t, {}, async (page) => {
    await page.setViewport({ width: 390, height: 844, mobile: true, deviceScaleFactor: 2 });
    await page.waitFor("document.getElementById('playBtn')");
    assert.equal(await page.evaluate("document.getElementById('picker').hidden"), false, 'a first visit opens the sheet');
    assert.equal(await page.evaluate("document.getElementById('navInstrument').textContent.trim()"), 'Choose an instrument');
    assert.equal(await page.evaluate("document.getElementById('playBtn').hidden"), true, 'Start is hidden until an instrument is chosen');
    const kb = await page.evaluate("(() => { const b = document.querySelector('#picker button[data-mod=\"kbd\"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()");
    await page.tap(kb.x, kb.y);
    // Tap Start where it sits on the first screen (clickSelector would scroll, which the app never does).
    const r = await page.evaluate("(() => { const b = document.getElementById('playBtn').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()");
    assert.ok(r.y < 844, 'Start is on the first screen');
    await page.tap(r.x, r.y);
    await page.waitFor("document.getElementById('playBtn').textContent.trim() === 'Pause'");
    assert.equal(await page.evaluate("document.getElementById('picker').hidden"), true, 'the sheet is shut once Keyboard is picked and Start is pressed');
    assert.equal(await page.evaluate("document.getElementById('navInstrument').getAttribute('aria-expanded')"), 'false');
    assert.equal(await page.evaluate("document.getElementById('navInstrument').textContent.trim()"), 'Instrument: Keyboard');
    const box = await page.evaluate("(() => { const p = document.getElementById('prompt').getBoundingClientRect(), c = document.getElementById('cv').getBoundingClientRect(); return { p: p.bottom, c: c.bottom, h: innerHeight }; })()");
    assert.ok(box.p <= box.h && box.c <= box.h, `prompt and keys are on the first screen: ${JSON.stringify(box)}`);
  });
});
