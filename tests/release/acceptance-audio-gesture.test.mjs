// Acceptance scenario A02: sound starts because a learner asked for it, and not
// before. Candidate e4b6fb5 was rejected on its hand test for "The AudioContext
// was not allowed to start" warnings (docs/release-acceptance-record.md,
// finding 1): its tab-return handlers created the context with no gesture. The
// ordinary harness cannot see that, so this runs the release file under normal
// autoplay policy and reads console warnings and the browser log; "did sound
// start" comes from the WebAudio domain, with no debug hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';

const AUDIO_WARNING = /AudioContext was not allowed to start/i;

const audioWarnings = (page) =>
  [...page.consoleErrors, ...page.consoleWarnings, ...page.logEntries.map((e) => `${e.level}: ${e.text}`)].filter((m) => AUDIO_WARNING.test(m));

test('A02: no AudioContext warning on load or on tab return; a real click on Start makes sound, still with no warning', async (t) => {
  await withAcceptancePage(t, {}, async (page) => {
    // 1. Loaded, nothing touched: no gesture yet. Two frames and half a second
    // first, so a warning raised late in boot is reported here, not as step 2's.
    await page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 500))))');
    assert.deepEqual(audioWarnings(page), [], 'no AudioContext warning on load');
    assert.equal(page.audio.running().length, 0, 'no sound has started on load');

    // 2. Away to another tab and back, for real: the page's own events say so.
    await page.background();
    await page.foreground();
    const visibility = await page.visibilityLog();
    assert.deepEqual(visibility.map((e) => e.state), ['hidden', 'visible'], 'the browser hid the page, then showed it');
    assert.ok(visibility.every((e) => e.trusted), 'those were the browser\'s own visibilitychange events');
    assert.deepEqual(audioWarnings(page), [], 'no AudioContext warning on tab return');
    assert.equal(page.audio.running().length, 0, 'returning to the tab does not start sound by itself');

    // 3. The control a learner presses to start: Start, with a real mouse click.
    assert.equal(await page.evaluate("document.getElementById('playBtn').textContent.trim()"), 'Start');
    await page.clickSelector('#playBtn');
    await page.audio.waitForRunning();
    assert.equal(page.audio.running().length, 1, 'one AudioContext, running, after the click');
    await page.waitFor("document.getElementById('playBtn').textContent.trim() === 'Pause'");
    assert.deepEqual(audioWarnings(page), [], 'starting sound with a click raises no AudioContext warning');
    assert.deepEqual(page.exceptions, [], 'no uncaught exceptions');
  });
});
