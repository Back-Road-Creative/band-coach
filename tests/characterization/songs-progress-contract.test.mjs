// Song practice credits the instrument actually being practised, not
// whichever instrument happens to be showing on the main screen (fix/song-
// progress-contract). Drives the built page the same way
// tests/characterization/songs-feasibility.test.mjs does: violin is left
// showing on the main screen (setMod), but the lesson is switched to
// keyboard via the "Play it on…" card -- keyboard is the one ready
// instrument with MIDI-style input, so window.__coach.songsNote() (which
// only reaches the app's own key-press pipeline, see src/ui/songs.js's
// "Note capture during practice" header comment) can drive it without a
// real microphone. A note judged correct there must raise
// db().mods.kbd.ready, never db().mods.violin.ready.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

async function switchToKeyboardLesson(page) {
  await page.evaluate("window.__coach.setMod('violin')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelectorAll('.panel-songs-instrument-card').length > 0");
  await page.evaluate(
    "(function () { const card = Array.from(document.querySelectorAll('.panel-songs-instrument-card')).find(c => c.textContent.includes('Keyboard')); card.querySelector('button').click(); })()"
  );
  await page.waitFor("window.__coach.db().panels.songs.instrumentId === 'kbd'");
}

async function getToRecordingStep(page) {
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Next')"
  );
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()"
  );
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')"
  );
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn').click()"
  );
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Stop and check')"
  );
}

test('a correctly-played note in a keyboard song lesson credits keyboard, not the violin mod showing on the main screen', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await switchToKeyboardLesson(page);
  const before = await page.evaluate("({ violin: window.__coach.db().mods.violin.ready, kbd: window.__coach.db().mods.kbd.ready })");

  await getToRecordingStep(page);
  // Hot Cross Buns' first phrase begins on E4 (midi 64) -- a correctly
  // pitched note, same note tests/characterization/songs-heat.test.mjs's
  // getToRecordingStep flow uses.
  await page.evaluate('window.__coach.songsNote(64, true)');
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");

  const after = await page.evaluate("({ violin: window.__coach.db().mods.violin.ready, kbd: window.__coach.db().mods.kbd.ready })");
  assert.equal(after.violin, before.violin, 'the mod showing on the main screen (violin) must not move just because a keyboard lesson is open');
  assert.ok(after.kbd > before.kbd, 'the instrument actually being practised (kbd) should have its readiness credited: ' + before.kbd + ' -> ' + after.kbd);
  assert.deepEqual(page.exceptions, []);
});
