// CURRENT BEHAVIOUR (this change): every MODS entry with `staff: true` draws
// a hand-built staff and nothing else -- no lit-key diagram -- so its hint
// text must never tell a learner "a key is lit up". Before this change,
// hintFor()'s fallback line only escaped for the literal `mod === 'wind'`
// generic trainer; the ten named wind/brass instruments (trumpet-bb, horn-f,
// trombone, flute, oboe, clarinet-bb, sax-alto-eb, sax-tenor-bb,
// recorder-descant, tin-whistle), which all also set `staff: true`, fell
// through to the "lit up" fallback on a freshly-revealed item.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

// Every MODS id with `staff: true` and no lit-key diagram, read straight off
// src/app.js's own MODS block (the generic 'wind' trainer plus the ten named
// instruments built from the wind/brass/keyed-woodwind registry records).
const STAFF_ONLY_MODS = ['wind', 'trumpet-bb', 'horn-f', 'trombone', 'flute', 'oboe', 'clarinet-bb', 'sax-alto-eb', 'sax-tenor-bb', 'recorder-descant', 'tin-whistle'];

for (const id of STAFF_ONLY_MODS) {
  test(`${id}: a freshly-revealed item's hint never claims a key is lit up`, async (t) => {
    const page = await launchPage(htmlPath);
    t.after(() => page.close());

    await page.evaluate(`window.__coach.setMod(${JSON.stringify(id)})`);
    await page.evaluate("document.getElementById('playBtn').click()");
    await page.waitFor('window.__coach.task()');

    // A fresh profile's very first exposure to any item is revealed (first
    // two exposures always are -- src/core/reveal.js shouldReveal()).
    const revealed = await page.evaluate('window.__coach.cur().reveal');
    assert.equal(revealed, true, 'a brand-new item on a fresh profile should be revealed');

    const hint = await page.evaluate("document.getElementById('hint').textContent");
    assert.doesNotMatch(hint, /lit up/i, `staff-only mod "${id}" must not claim a key is lit up; got hint: ${hint}`);
  });
}
