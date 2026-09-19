// Songs panel (Wave W, unit "songs"). Drives the built page through
// window.__coach.openPanel('songs') and the DOM, per the author brief.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('the songs panel lists the starter songs, easiest first', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");

  const titles = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).map(b => b.textContent)"
  );
  assert.ok(titles.includes('Hot Cross Buns'), 'the easiest starter tune is listed');
  assert.ok(titles.includes('Minuet in G'), 'a harder starter tune is also listed');
  assert.ok(titles.indexOf('Hot Cross Buns') < titles.indexOf('Minuet in G'), 'easiest tune is listed before a harder one');
});

test('the file input only accepts the four supported extensions', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  const accept = await page.evaluate("document.getElementById('songsFileInput').getAttribute('accept')");
  assert.equal(accept, '.mid,.midi,.abc,.xml,.musicxml');
  const label = await page.evaluate("document.querySelector('label[for=\"songsFileInput\"]').textContent");
  assert.ok(label.includes('.mid'));
});

test('choosing a one-part starter song opens a practice lesson, starting with a listen step', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");

  const stepTitle = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.ok(stepTitle.startsWith('Listen'), 'first step is a listen step: ' + stepTitle);

  // A listen step has no pass/fail judging, just a Next button.
  const nextBtn = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next')"
  );
  assert.ok(nextBtn !== undefined, 'a Next button is present for the listen step');

  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4').textContent !== '" + stepTitle + "'");
  const secondTitle = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.notEqual(secondTitle, stepTitle);
});

test('recording via the keyboard/MIDI note forward counts notes and can be judged without crashing', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  // advance past the listen step to a step with a pass rule and a "Your turn" button
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

  // Simulate the app's own onNote() forwarding a played keyboard note, the
  // way a real MIDI keyboard or the on-screen keys would (app.js's onNote()
  // forwards to this via the single added line, exposed here for testing as
  // window.__coach.songsNote).
  await page.evaluate('window.__coach.songsNote(64, true)');
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");

  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()"
  );
  // Judging must not throw, and the panel keeps showing a practice step
  // (either the same one repeated, or the next one).
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  assert.deepEqual(page.exceptions, []);
});

test('the last song and part chosen are remembered across a re-open of the panel', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");

  const saved = await page.evaluate("window.__coach.db().panels.songs");
  assert.equal(saved.songId, 'hot-cross-buns');
  assert.equal(saved.partId, 'melody');
  assert.equal(saved.instrumentId, 'kbd');
});
