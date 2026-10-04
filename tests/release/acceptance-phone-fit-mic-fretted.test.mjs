// Phone fit for the instruments the keyboard/kit policy (acceptance-phone-practice.test.mjs) does not cover:
// at 390x844, after Start, the learner sees the prompt and the whole drawing (#cv) without scrolling for
// (a) a microphone instrument with its "Set up input" sheet open (it shows Connect status, so it stays usable)
// and (b) a fretted instrument. The release file, real Start tap at the top of the page; page.evaluate only observes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';
import { quietRoom, writeFixture } from '../fixtures/acceptance/mic-journey.mjs';

const VP = { width: 390, height: 844, mobile: true, deviceScaleFactor: 3 };
const raf = (page) => page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
const rects = (page) => page.evaluate(`(() => { const b = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; }; return { ih: innerHeight, sy: scrollY, prompt: b('prompt'), cv: b('cv'), sheet: b('setupSheet') }; })()`);

async function session(t, mod, { setup }) {
  await withAcceptancePage(t, { fakeAudioFile: writeFixture('quiet-room', quietRoom()) }, async (page) => {
    await page.grant(['microphone']);
    await page.setViewport(VP);
    await page.reload();
    await page.waitFor("document.querySelector('#picker button') !== null");
    // the first boot saved a choice, so after the reload the sheet is shut: open it from the nav like a learner
    if (await page.evaluate("document.getElementById('picker').hidden")) await page.clickSelector('#navInstrument');
    await page.clickSelector(`#picker button[data-mod="${mod}"]`);
    if (setup) {
      await page.clickSelector('#setupBtn');
      await page.clickSelector('#ioBtn');
      await page.waitFor("document.getElementById('ioText').textContent.includes('Listening')");
    }
    await page.evaluate('scrollTo(0, 0)');
    await raf(page);
    const p = await page.evaluate("(() => { const r = document.getElementById('playBtn').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()");
    await page.tap(p[0], p[1]);
    await page.waitFor("document.getElementById('playBtn').textContent.trim() === 'Pause'");
    await page.waitFor("document.getElementById('prompt').textContent.length > 0");
    await raf(page);
    const m = await rects(page);
    if (setup) assert.ok(m.sheet[1] > m.sheet[0], `the setup sheet is open: ${JSON.stringify(m)}`);
    assert.equal(m.sy, 0, `no scrolling happened: ${JSON.stringify(m)}`);
    assert.ok(m.prompt[1] <= m.ih, `${mod} setup=${setup}: #prompt bottom ${m.prompt[1]} is past ${m.ih}: ${JSON.stringify(m)}`);
    assert.ok(m.cv[1] <= m.ih, `${mod} setup=${setup}: #cv bottom ${m.cv[1]} is past ${m.ih}: ${JSON.stringify(m)}`);
  });
}

test('390x844: a fretted instrument (guitar) fits after Start, no setup', (t) => session(t, 'gtr', { setup: false }));
test('390x844: a fretted instrument (guitar) fits after Start, mic connected, setup sheet open', (t) => session(t, 'gtr', { setup: true }));
