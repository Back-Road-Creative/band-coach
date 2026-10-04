// A learner who presses Stop and check must SEE the verdict next to the lesson controls, not only in
// #panelSay (above the panel, scrolled off-screen when the song opens) or the hidden Add-a-song message.
// Release file; real clicks; the keyboard is the declared fake (FAKE_MIDI_INIT, RIG_INIT).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort } from '../helpers/fake-midi.mjs';
import { RIG_INIT, RIG_LABEL, clickByText } from '../helpers/profile-seed.mjs';

const REC = 'button:has(+ .panel-songs-count)';
const SIMULATED = ['fake MIDI keyboard (FAKE_MIDI_INIT)', RIG_LABEL];

test('the Check verdict is on screen beside Your turn after Stop and check', async (t) => {
  await withAcceptancePage(t, { initScript: FAKE_MIDI_INIT + RIG_INIT, simulated: SIMULATED }, async (page) => {
    await page.clickSelector('#picker button[data-mod="kbd"]');
    await page.clickSelector('#harderBtn'); await page.clickSelector('#harderBtn');
    await midiAddPort(page, 'p1', 'Test Keys');
    await page.clickSelector('#setupBtn'); await page.clickSelector('#ioBtn');
    await page.waitFor("document.getElementById('ioBtn').hidden === true");
    await page.clickSelector('#kbdSongHandoff');
    await page.waitFor("document.querySelector('#songsPracticeHeading')");
    await clickByText(page, '.panel-songs-practice button', 'Next'); await clickByText(page, '.panel-songs-practice button', 'Next');
    // one wrong-length try: a single note, so the verdict is a correction
    await page.evaluate('window.__bcArm()');
    await page.clickSelector(REC);
    await page.waitFor("(document.querySelector('.panel-songs-count') || {}).textContent === 'Counting in…'");
    await page.evaluate('window.__bcPlay([{ midi: 64, atMs: 0 }], 2.55)');
    await page.clickSelector(REC);
    await page.waitFor("document.querySelector('.panel-songs-verdict')");
    const v = await page.evaluate(`(() => { const e = document.querySelector('.panel-songs-verdict'); const r = e.getBoundingClientRect(), b = document.querySelector(${JSON.stringify(REC)}).getBoundingClientRect(); return { text: e.textContent.trim(), say: document.getElementById('panelSay').textContent, top: r.top, bottom: r.bottom, vh: innerHeight, recTop: b.top, shown: r.height > 0 }; })()`);
    assert.ok(v.text.length > 0 && v.text === v.say, `the lesson shows what #panelSay says: "${v.text}" vs "${v.say}"`);
    assert.ok(v.shown && v.top >= 0 && v.bottom <= v.vh, `verdict within the screen: ${v.top}..${v.bottom} of ${v.vh}`);
    assert.ok(Math.abs(v.top - v.recTop) < v.vh / 2, 'the verdict sits near Your turn');
  });
});
