// The Capture tool must never go quiet on the learner: a message said while the tool is open
// has to be VISIBLE (the tools hide the side cards with an inline display:none, which .hidden
// cannot override), Listen needs a connected mic, the note count is live while listening, and
// pressing 'Make it a lesson' twice on one capture saves one song, not identical copies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { writeDecayWav } from '../fixtures/acceptance/decay-wav.mjs';

const VISIBLE_FEEDBACK = "(function () { var c = document.getElementById('feedbackCard'); return !c.hidden && getComputedStyle(c).display !== 'none' && document.getElementById('feedback').getBoundingClientRect().height > 0 ? document.getElementById('feedback').textContent : ''; })()";
const openCapture = async page => { await page.clickSelector('#picker button[data-mod="capture"]'); await page.waitFor("document.getElementById('capGo')"); };

for (const id of ['capUse', 'capDrill', 'capPlay']) {
  test(`${id} with nothing captured says so, visibly`, async (t) => {
    const page = await launchPage(HTML_PATH);
    t.after(() => page.close());
    await openCapture(page);
    await page.evaluate(`document.getElementById('${id}').click()`);
    assert.match(await page.evaluate(VISIBLE_FEEDBACK), /Nothing captured yet/);
  });
}

test('Listen without a connected mic does not start, and says to connect first', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openCapture(page);
  await page.evaluate("document.getElementById('capGo').click()");
  assert.equal(await page.evaluate("document.getElementById('capGo').textContent"), 'Listen');
  assert.match(await page.evaluate(VISIBLE_FEEDBACK), /Connect/);
});

test('the note count climbs while listening, before Stop', async (t) => {
  const wav = writeDecayWav(join(mkdtempSync(join(tmpdir(), 'band-coach-wav-')), 'a4.wav'));
  const page = await launchPage(HTML_PATH, { fakeAudioFile: wav });
  t.after(() => page.close());
  await page.grant(['microphone']);
  await openCapture(page);
  await page.clickSelector('#setupBtn');
  await page.clickSelector('#ioBtn');
  await page.waitFor("/Listening/.test(document.getElementById('ioText').textContent)");
  await page.evaluate("document.getElementById('capGo').click()");
  await page.waitFor("document.getElementById('capGo').textContent === 'Stop'");
  await page.waitFor("/^[1-9]\\d* note/.test(document.getElementById('capTo').parentElement.textContent)", 15000);
});

test('"Make it a lesson" twice on one capture saves one song', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('capture')");
  await page.evaluate("window.__coach.cap().notes.push({ m: 60, t: 0, d: 0.4 }, { m: 62, t: 0.5, d: 0.4 })");
  await page.waitFor("document.getElementById('capUse')");
  await page.evaluate("document.getElementById('capUse').click()");
  await page.waitFor("window.__coach.panelOpen() === 'songs'", 20000);
  await page.evaluate("window.__coach.setMod('capture')");
  await page.waitFor("document.getElementById('capUse')");
  await page.evaluate("document.getElementById('capUse').click()");
  await page.waitFor("window.__coach.panelOpen() === 'songs'", 20000);
  // Count the stored songs (not list rows, which a separate refresh race can double).
  await page.evaluate("window.__capKeys = null; indexedDB.open('bandcoach-songs').onsuccess = e => { const r = e.target.result.transaction('kv').objectStore('kv').getAllKeys(); r.onsuccess = () => { window.__capKeys = r.result.filter(k => /^meta:capture-/.test(k)).length; }; }");
  await page.waitFor('window.__capKeys !== null', 10000);
  assert.equal(await page.evaluate('window.__capKeys'), 1);
});
