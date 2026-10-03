// Acceptance: a learner on a microphone drill switches tabs and comes back.
// Hiding the tab releases the microphone on purpose (README, "Switching away
// from the tab"), so on return the input line says "not connected" and the
// Paused card is shown. The bug: pressing "I'm back, resume" then ran the drill
// with the pitch worklet still wired to the stopped stream, whose all-zero
// frames made the coach say "I'm not hearing anything at all. Check that the
// right microphone is selected and that it isn't muted." -- blaming a mic the
// app had itself released. The coach must instead say the mic was released and
// to press Connect. Real clicks and a real tab switch; the page is only read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';
import { writeLoopWav } from '../fixtures/acceptance/live-capture-wav.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BLAME = /not hearing anything|isn't muted/;

test('resuming after a tab hide says the mic was released and never blames the learner\'s mic', async (t) => {
  const plucks = [];
  for (let i = 0; i < 10; i++) plucks.push({ at: 0.2 + i * 0.8, midis: [[52, 55, 57, 59, 60, 62, 64, 67][i % 8]], gain: 0.5, decay: 0.999 });
  await withAcceptancePage(t, { fakeAudioFile: writeLoopWav('mic-resume', plucks, {}) }, async (page) => {
    await page.grant(['microphone']);
    await page.clickSelector('#picker button[data-mod="gtr"]');
    await page.clickSelector('#setupBtn');
    await page.clickSelector('#ioBtn');
    await page.waitFor("/Listening/.test(document.getElementById('ioText').textContent)");
    await page.clickSelector('#playBtn');
    await sleep(2500);
    await page.background();
    await sleep(1500);
    await page.foreground();
    await page.waitFor("!document.getElementById('breakCard').hidden");
    await page.evaluate("window.__coachLog = []; new MutationObserver(() => window.__coachLog.push(document.getElementById('coach').textContent)).observe(document.getElementById('coach'), { childList: true, subtree: true, characterData: true })");
    await page.clickSelector('#backBtn');
    await sleep(4000);
    const log = JSON.parse(await page.evaluate('JSON.stringify(window.__coachLog)'));
    const coach = await page.evaluate("document.getElementById('coach').textContent");
    assert.deepEqual(log.filter((l) => BLAME.test(l)), [], 'the coach blamed the learner\'s microphone after resume');
    assert.match(coach, /Connect microphone/, 'the coach tells the learner how to get the mic back: ' + coach);
  });
});
