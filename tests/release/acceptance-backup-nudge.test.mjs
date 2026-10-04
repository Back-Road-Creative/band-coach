// The backup reminder says "You have been practising a while", so it may only
// appear after a session the app itself logged (8 judged answers), never after
// a few seconds on a fresh profile. Driven with real clicks and computer keys on
// the release file; the page is only read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';

const KEY_FOR = { C: 'a', D: 's', E: 'd', F: 'f', G: 'g', A: 'h', B: 'j', 'C (high)': 'k' };
// Counts every new prompt target and every rewrite of #feedback, so each wait is on something the screen did.
const WATCH = `(() => {
  const seen = new WeakSet(); window.__targets = 0; window.__feedback = 0;
  const scan = () => { const b = document.querySelector('#prompt b'); if (b && !seen.has(b)) { seen.add(b); window.__targets++; } };
  new MutationObserver((records) => { scan(); for (const m of records) if (m.target.id === 'feedback') window.__feedback++; }).observe(document, { childList: true, subtree: true });
})()`;
const read = (page, expr) => page.evaluate(expr);

async function playAnswers(page, count) {
  for (let i = 0; i < count; i++) {
    await page.waitFor(`window.__targets > ${i}`);
    const label = await read(page, "document.querySelector('#prompt b').textContent");
    const n = await read(page, 'window.__feedback');
    await page.press(KEY_FOR[label], { text: KEY_FOR[label] });
    await page.waitFor(`window.__feedback > ${n}`);
  }
}
async function startKeyboard(page) {
  await page.clickSelector('#picker button[data-mod="kbd"]');
  await page.clickSelector('#playBtn');
}

test('a first session too short to log does not claim "practising a while"', async (t) => {
  await withAcceptancePage(t, { initScript: WATCH }, async (page) => {
    await startKeyboard(page);
    await playAnswers(page, 1);
    await page.clickSelector('#endBtn');
    await page.waitFor("/^Session /.test(document.getElementById('coach').textContent)");
    assert.equal(await read(page, "document.getElementById('coach').textContent.trim()"), 'Session ended. Too short to log.');
    assert.equal(await read(page, "document.getElementById('backupNudge').hidden"), true, 'no backup reminder after an unlogged session');
  });
});

test('a logged session on a profile with no backup does show the reminder', async (t) => {
  await withAcceptancePage(t, { initScript: WATCH }, async (page) => {
    await startKeyboard(page);
    await playAnswers(page, 8);
    await page.clickSelector('#endBtn');
    await page.waitFor("/^Session done/.test(document.getElementById('coach').textContent)");
    assert.equal(await read(page, "document.getElementById('backupNudge').hidden"), false, 'the reminder appears once a session was logged');
  });
});
