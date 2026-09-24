// 'Make it a lesson' (src/app.js's capUse button, mod === 'capture'): a
// captured tune now becomes a draft Song in the library, via the same
// request+switch handoff src/ui/learn.js's "Practise this" uses
// (requestOpenSong(), src/ui/songs.js) -- rather than the old behaviour of
// discarding timing and loading DB.custom's four-note drill. 'Drill the
// notes' keeps that old behaviour under its own button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

// Pushes three merged capture notes directly onto the live `cap` object the
// debug hook exposes (window.__coach.cap()), the same shape capStop()
// itself produces: { m: midi, t: startSec, d: durSec }.
async function injectCapturedNotes(page) {
  await page.evaluate(
    "window.__coach.cap().notes.push({ m: 60, t: 0, d: 0.4 }, { m: 62, t: 0.5, d: 0.4 }, { m: 64, t: 1.0, d: 0.4 })"
  );
}

test('"Make it a lesson" adds the captured tune as a song and opens it in Songs', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('capture')");
  await injectCapturedNotes(page);
  await page.waitFor("document.getElementById('capUse')");
  await page.evaluate("document.getElementById('capUse').click()");

  await page.waitFor("window.__coach.panelOpen() === 'songs'", 20000);
  // The library list fills from IndexedDB after show(); wait for the row, not just the panel.
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).some(b => /^Captured tune \\d{4}-\\d{2}-\\d{2}$/.test(b.textContent))",
    20000
  );

  const titles = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).map(b => b.textContent)"
  );
  assert.ok(titles.some(t => /^Captured tune \d{4}-\d{2}-\d{2}$/.test(t)), 'expected a "Captured tune <date>" row, got: ' + titles.join('|'));
});

test('"Drill the notes" keeps the old four-note-at-a-time behaviour', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('capture')");
  await injectCapturedNotes(page);
  await page.waitFor("document.getElementById('capDrill')");
  await page.evaluate("document.getElementById('capDrill').click()");

  const custom = await page.evaluate("window.__coach.db().custom");
  assert.deepEqual(custom, [60, 62, 64]);
});
