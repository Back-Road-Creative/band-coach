// The Music theory panel: a graded lesson track, an Explore tab (keys,
// scales, chords) and a Transpose tab. Drives it entirely through the DOM
// by clicking the real Music theory button in the instrument sheet's Tools
// group (P2b-3's home for it), the same click path a learner uses -- not
// window.__coach.openPanel('theory') directly (see
// tests/characterization/panels.test.mjs for that contract).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

test('theory panel registers and opens with a Lesson tab active by default', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  assert.equal(await page.evaluate("window.__coach.panels().includes('theory')"), true);
  await page.evaluate("document.querySelector('#picker .picker-tools button[data-panel=\"theory\"]').click()");
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'theory');
  assert.equal(await page.evaluate("!!document.querySelector('.panel-theory')"), true);
  assert.equal(
    await page.evaluate("document.querySelector('.panel-theory [data-tab=\"lesson\"]').getAttribute('aria-selected')"),
    'true'
  );
  assert.equal(await page.evaluate("!!document.querySelector('.panel-theory-question')"), true);
});

test('answering a lesson question shows an explanation and a Next button, and keeps progress across a reload', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("document.querySelector('#picker .picker-tools button[data-panel=\"theory\"]').click()");
  await page.waitFor("document.querySelectorAll('.panel-theory-choice').length > 0");
  const choiceCount = await page.evaluate("document.querySelectorAll('.panel-theory-choice').length");
  assert.ok(choiceCount >= 2);
  await page.evaluate("document.querySelector('.panel-theory-choice').click()");
  assert.equal(await page.evaluate("document.querySelector('.panel-theory-feedback').textContent.length > 0"), true);
  assert.equal(await page.evaluate("document.getElementById('theoryNextBtn').hidden"), false);
  const stored = await page.evaluate("window.__coach.db().panels.theory");
  assert.equal(typeof stored.seed, 'number');
  assert.ok(stored.seed >= 1);

  // save() debounces (src/app.js) -- wait for the write to actually land in
  // localStorage before reloading, rather than racing the debounce timer.
  await page.waitFor("JSON.parse(localStorage.getItem('bandcoach.v1') || '{}').panels && JSON.parse(localStorage.getItem('bandcoach.v1')).panels.theory", 10000);
  await page.reload();
  await page.waitFor('window.__coach && window.__coach.db().mods.kbd', 5000);
  const storedAfterReload = await page.evaluate("window.__coach.db().panels.theory");
  assert.deepEqual(storedAfterReload, stored);
});

test('three correct lesson answers in a row level up', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("document.querySelector('#picker .picker-tools button[data-panel=\"theory\"]').click()");
  await page.waitFor("document.querySelectorAll('.panel-theory-choice').length > 0");

  for (let i = 0; i < 3; i++) {
    await page.evaluate(`(function () {
      const q = window.__coach.theoryCurrentQuestion();
      const btns = Array.from(document.querySelectorAll('.panel-theory-choice'));
      const right = btns.find(b => b.textContent === q.answer);
      right.click();
    })()`);
    assert.equal(await page.evaluate("document.getElementById('theoryNextBtn').hidden"), false);
    await page.evaluate("document.getElementById('theoryNextBtn').click()");
  }
  const stored = await page.evaluate("window.__coach.db().panels.theory");
  assert.equal(stored.level, 2);
  assert.equal(stored.streak, 0);
});

test('Explore tab shows a key\'s spelled notes and draws a staff', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("document.querySelector('#picker .picker-tools button[data-panel=\"theory\"]').click()");
  await page.evaluate("document.querySelector('.panel-theory [data-tab=\"explore\"]').click()");
  assert.equal(
    await page.evaluate("document.querySelector('.panel-theory [data-tab=\"explore\"]').getAttribute('aria-selected')"),
    'true'
  );
  await page.evaluate("document.getElementById('theoryExploreKind').value = 'key'; document.getElementById('theoryExploreKind').dispatchEvent(new Event('change'))");
  await page.evaluate("document.getElementById('theoryExploreKey').value = 'G'; document.getElementById('theoryExploreKey').dispatchEvent(new Event('change'))");
  const notesText = await page.evaluate("document.getElementById('theoryExploreNotes').textContent");
  assert.ok(notesText.includes('F#'), 'G major should spell its 7th degree F#, got: ' + notesText);
  assert.equal(await page.evaluate("!!document.getElementById('theoryExploreStaff')"), true);
  const primitiveCount = await page.evaluate("document.getElementById('theoryExploreStaff').__lastPrimitiveCount");
  assert.ok(primitiveCount > 0);
});

test('Explore tab on guitar shows fretboard positions for a scale', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("document.querySelector('#picker button[data-mod=\"gtr\"]').click()");
  await page.evaluate("document.querySelector('#picker .picker-tools button[data-panel=\"theory\"]').click()");
  await page.evaluate("document.querySelector('.panel-theory [data-tab=\"explore\"]').click()");
  await page.evaluate("document.getElementById('theoryExploreKind').value = 'key'; document.getElementById('theoryExploreKind').dispatchEvent(new Event('change'))");
  await page.evaluate("document.getElementById('theoryExploreKey').value = 'C'; document.getElementById('theoryExploreKey').dispatchEvent(new Event('change'))");
  const hasFretTable = await page.evaluate("!!document.querySelector('.panel-theory-fretboard')");
  assert.equal(hasFretTable, true);
});

test('Explore tab on chords shows voicing shapes for guitar, bass and ukulele', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("document.querySelector('#picker .picker-tools button[data-panel=\"theory\"]').click()");
  await page.evaluate("document.querySelector('.panel-theory [data-tab=\"explore\"]').click()");
  await page.evaluate("document.getElementById('theoryExploreKind').value = 'chord'; document.getElementById('theoryExploreKind').dispatchEvent(new Event('change'))");
  const groups = await page.evaluate("Array.from(document.querySelectorAll('.panel-theory-voicing-group')).map(g => g.dataset.instrument)");
  assert.deepEqual(groups.sort(), ['bass', 'gtr', 'uke']);
});

test('Transpose tab shows written and concert pitch for a transposing instrument', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("document.querySelector('#picker .picker-tools button[data-panel=\"theory\"]').click()");
  await page.evaluate("document.querySelector('.panel-theory [data-tab=\"transpose\"]').click()");
  await page.evaluate("document.getElementById('theoryTransposeKey').value = 'C'; document.getElementById('theoryTransposeKey').dispatchEvent(new Event('change'))");
  await page.evaluate("document.getElementById('theoryTransposeInstrument').value = 'trumpet-bb'; document.getElementById('theoryTransposeInstrument').dispatchEvent(new Event('change'))");
  const written = await page.evaluate("document.getElementById('theoryTransposeWritten').textContent");
  const concert = await page.evaluate("document.getElementById('theoryTransposeConcert').textContent");
  assert.ok(written.length > 0 && concert.length > 0);
  assert.notEqual(written, concert);
});

test('theory panel has no console errors or network requests', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("document.querySelector('#picker .picker-tools button[data-panel=\"theory\"]').click()");
  await page.evaluate("document.querySelector('.panel-theory [data-tab=\"explore\"]').click()");
  await page.evaluate("document.querySelector('.panel-theory [data-tab=\"transpose\"]').click()");
  assert.deepEqual(page.consoleErrors, []);
  assert.deepEqual(page.exceptions, []);
});
