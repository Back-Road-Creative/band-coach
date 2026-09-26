// The "How to play it" panel: pick an instrument and a note, see a diagram
// plus its accessible text description, and the instrument's playable range.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

test('fingerings panel opens, shows a default fretboard diagram, and reacts to a note pick', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  // The default mod at boot (kbd) has no fingering mapping, so the panel
  // falls back to the first instrument that does have one.
  assert.equal(await page.evaluate("document.querySelector('#picker button[aria-pressed=\"true\"]').dataset.mod"), 'kbd');
  await page.evaluate("window.__coach.openPanel('fingerings')");
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'fingerings');
  assert.notEqual(await page.evaluate("document.getElementById('fingInstrument').value"), 'kbd');

  // Switch explicitly to guitar to pin the rest of the test down.
  await page.evaluate(`(function () {
    const sel = document.getElementById('fingInstrument');
    sel.value = 'gtr'; sel.dispatchEvent(new Event('change'));
  })()`);
  assert.equal(await page.evaluate("document.getElementById('fingInstrument').value"), 'gtr');
  const initialDesc = await page.evaluate("document.getElementById('fingDesc').textContent");
  assert.match(initialDesc, /open/);
  assert.ok(await page.evaluate("document.querySelectorAll('.fing-fretboard .fing-string').length") >= 6);

  // Pick a different note: the description and the highlighted fret change.
  await page.evaluate(`(function () {
    const btns = [...document.querySelectorAll('.fing-note-btn')];
    const target = btns.find(b => b.textContent === 'D3');
    target.click();
  })()`);
  const afterDesc = await page.evaluate("document.getElementById('fingDesc').textContent");
  assert.match(afterDesc, /D3/);
  assert.notEqual(afterDesc, initialDesc);
  assert.ok(await page.evaluate("document.querySelectorAll('.fing-fret.fing-hit').length") >= 1);

  // Switch instrument to the harmonica: a different diagram kind appears.
  await page.evaluate(`(function () {
    const sel = document.getElementById('fingInstrument');
    sel.value = 'harp'; sel.dispatchEvent(new Event('change'));
  })()`);
  assert.equal(await page.evaluate("document.querySelectorAll('.fing-harmonica .fing-hole').length"), 10);
  const harpDesc = await page.evaluate("document.getElementById('fingDesc').textContent");
  assert.match(harpDesc, /hole 1 blow/);

  // The instrument picker lists only instruments with a mapped fingering.
  const options = await page.evaluate("[...document.getElementById('fingInstrument').options].map(o => o.value)");
  assert.ok(options.includes('trumpet-bb'));
  assert.ok(options.includes('trombone'));
  assert.ok(options.includes('recorder-descant'));
  assert.ok(options.includes('voice'));
  assert.ok(options.includes('violin'));
  assert.ok(options.includes('tin-whistle'));
  assert.ok(!options.includes('kbd'));
  assert.ok(!options.includes('wind'));

  // Bowed instruments are fretless: switching to violin draws a plain
  // fingerboard with no fret grid, never `.fing-fretboard`.
  await page.evaluate(`(function () {
    const sel = document.getElementById('fingInstrument');
    sel.value = 'violin'; sel.dispatchEvent(new Event('change'));
  })()`);
  assert.equal(await page.evaluate("document.querySelectorAll('.fing-fingerboard').length"), 1);
  assert.equal(await page.evaluate("document.querySelectorAll('.fing-fretboard').length"), 0);
  const violinDesc = await page.evaluate("document.getElementById('fingDesc').textContent");
  assert.doesNotMatch(violinDesc, /\bfret \d/);

  // The tin whistle resolves to the whistle fingering table, not the
  // recorder's, and draws holes like the recorder diagram (no thumb hole).
  await page.evaluate(`(function () {
    const sel = document.getElementById('fingInstrument');
    sel.value = 'tin-whistle'; sel.dispatchEvent(new Event('change'));
  })()`);
  const whistleDesc = await page.evaluate("document.getElementById('fingDesc').textContent");
  assert.match(whistleDesc, /D5/);
  assert.equal(await page.evaluate("document.querySelectorAll('.fing-recorder .fing-recorder-hole').length"), 6);

  // Closing and reopening keeps the panel usable (mount tears down and remounts fresh).
  await page.evaluate('window.__coach.closePanel()');
  await page.evaluate("window.__coach.openPanel('fingerings')");
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'fingerings');
});

test('fingerings panel: every keyed-woodwind instrument shows its own guidance, never the voice fallback', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('fingerings')");
  const pick = id => page.evaluate(`(function () {
    const sel = document.getElementById('fingInstrument');
    sel.value = '${id}'; sel.dispatchEvent(new Event('change'));
  })()`);

  // Regression: these five all fell through to the voice diagram ("Sing
  // this pitch — no fingering needed.") before the keyed-woodwind branch
  // existed in diagramFor.
  for (const id of ['flute', 'clarinet-bb', 'oboe', 'sax-alto-eb', 'sax-tenor-bb']) {
    await pick(id);
    assert.equal(await page.evaluate("document.querySelectorAll('.fing-voice').length"), 0, id + ' must not render the voice diagram');
    assert.equal(await page.evaluate("document.querySelectorAll('.fing-keyed-woodwind').length"), 1, id + ' should render the keyed-woodwind diagram');
    const desc = await page.evaluate("document.getElementById('fingDesc').textContent");
    assert.doesNotMatch(desc, /Sing this pitch/, id + ' description must not be the voice text');
    const diagramText = await page.evaluate("document.querySelector('.fing-keyed-woodwind').textContent");
    assert.doesNotMatch(diagramText, /Sing this pitch/, id + ' diagram must not contain the voice text');
  }

  // Clarinet specifically: the rendered help contains the actual keyed-
  // woodwind chart text for the current pitch (audit's G3 example uses the
  // written low-G3 fingering — same table, low C4 is this app's default
  // note and names the footjoint keys instead).
  await pick('clarinet-bb');
  const clarinetDesc = await page.evaluate("document.getElementById('fingDesc').textContent");
  assert.match(clarinetDesc, /left hand: thumb/);
  assert.doesNotMatch(clarinetDesc, /Sing this pitch/);
});

test('fingerings panel: an unreviewed instrument shows the "not yet checked by a musician" badge', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('fingerings')");
  await page.evaluate(`(function () {
    const sel = document.getElementById('fingInstrument');
    sel.value = 'gtr'; sel.dispatchEvent(new Event('change'));
  })()`);
  // Every instrument record currently ships provenance: null, so the badge
  // is visible on ordinary startup, not a rare edge case.
  const badge = await page.evaluate("document.querySelector('.fing-review-badge')?.textContent");
  assert.match(badge, /not yet checked by a musician/i);
});

test('fingerings panel: capo, alternate tuning and left-handed controls', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('fingerings')");
  await page.evaluate(`(function () {
    const sel = document.getElementById('fingInstrument');
    sel.value = 'gtr'; sel.dispatchEvent(new Event('change'));
  })()`);

  // Guitar has a capo input and a named-alternate-tuning select.
  assert.equal(await page.evaluate("!!document.getElementById('fingCapo')"), true);
  const tuningOptions = await page.evaluate("[...document.getElementById('fingTuning').options].map(o => o.value)");
  assert.ok(tuningOptions.includes('standard'));
  assert.ok(tuningOptions.includes('drop-d'));

  // Standard tuning: the lowest string reads E2. Selecting drop-D (a real
  // entry point: select + change event) changes what that same string is,
  // reflected in both the diagram's string label and the description.
  const standardLowString = await page.evaluate("document.querySelectorAll('.fing-fretboard .fing-string-label')[5].textContent");
  assert.equal(standardLowString, 'E2');
  await page.evaluate(`(function () {
    const sel = document.getElementById('fingTuning');
    sel.value = 'drop-d'; sel.dispatchEvent(new Event('change'));
  })()`);
  const dropDLowString = await page.evaluate("document.querySelectorAll('.fing-fretboard .fing-string-label')[5].textContent");
  assert.equal(dropDLowString, 'D2');

  // Setting a capo re-describes the same note relative to the capo.
  await page.evaluate(`(function () {
    const sel = document.getElementById('fingTuning');
    sel.value = 'standard'; sel.dispatchEvent(new Event('change'));
  })()`);
  await page.evaluate(`(function () {
    const btns = [...document.querySelectorAll('.fing-note-btn')];
    const target = btns.find(b => b.textContent === 'F♯3');
    target.click();
  })()`);
  await page.evaluate(`(function () {
    const capo = document.getElementById('fingCapo');
    capo.value = '2'; capo.dispatchEvent(new Event('change'));
  })()`);
  const capoDesc = await page.evaluate("document.getElementById('fingDesc').textContent");
  assert.match(capoDesc, /capo/);

  // A note behind the capo says so plainly instead of just "not found".
  await page.evaluate(`(function () {
    const btns = [...document.querySelectorAll('.fing-note-btn')];
    const target = btns.find(b => b.textContent === 'E2');
    target.click();
  })()`);
  const belowCapoDesc = await page.evaluate("document.getElementById('fingDesc').textContent");
  assert.match(belowCapoDesc, /below the capo/);

  // Left-handed mirrors the fret diagram's string order.
  await page.evaluate(`(function () {
    const capo = document.getElementById('fingCapo');
    capo.value = '0'; capo.dispatchEvent(new Event('change'));
  })()`);
  const rightHandedOrder = await page.evaluate("[...document.querySelectorAll('.fing-fretboard .fing-string-label')].map(el => el.textContent)");
  await page.evaluate(`(function () {
    document.getElementById('fingLeftHanded').click();
  })()`);
  const leftHandedOrder = await page.evaluate("[...document.querySelectorAll('.fing-fretboard .fing-string-label')].map(el => el.textContent)");
  assert.deepEqual(leftHandedOrder, [...rightHandedOrder].reverse());

  // Left-handed also applies to a fretless fingerboard instrument, but the
  // fingerboard has neither a capo nor a tuning picker.
  await page.evaluate(`(function () {
    const sel = document.getElementById('fingInstrument');
    sel.value = 'violin'; sel.dispatchEvent(new Event('change'));
  })()`);
  assert.equal(await page.evaluate("!!document.getElementById('fingCapo')"), false);
  assert.equal(await page.evaluate("!!document.getElementById('fingTuning')"), false);
  assert.equal(await page.evaluate("!!document.getElementById('fingLeftHanded')"), true);
  const violinRight = await page.evaluate("[...document.querySelectorAll('.fing-fingerboard .fing-string-label')].map(el => el.textContent)");
  await page.evaluate(`(function () {
    document.getElementById('fingLeftHanded').click();
  })()`);
  const violinLeft = await page.evaluate("[...document.querySelectorAll('.fing-fingerboard .fing-string-label')].map(el => el.textContent)");
  assert.deepEqual(violinLeft, [...violinRight].reverse());

  // A harmonica has none of these controls at all.
  await page.evaluate(`(function () {
    const sel = document.getElementById('fingInstrument');
    sel.value = 'harp'; sel.dispatchEvent(new Event('change'));
  })()`);
  assert.equal(await page.evaluate("!!document.getElementById('fingCapo')"), false);
  assert.equal(await page.evaluate("!!document.getElementById('fingTuning')"), false);
  assert.equal(await page.evaluate("!!document.getElementById('fingLeftHanded')"), false);
});

test('fingerings panel: capo, tuning and left-handed are remembered per instrument across a reload', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('fingerings')");
  await page.evaluate(`(function () {
    const sel = document.getElementById('fingInstrument');
    sel.value = 'gtr'; sel.dispatchEvent(new Event('change'));
  })()`);
  await page.evaluate(`(function () {
    const capo = document.getElementById('fingCapo');
    capo.value = '3'; capo.dispatchEvent(new Event('change'));
  })()`);
  await page.evaluate(`(function () {
    const sel = document.getElementById('fingTuning');
    sel.value = 'drop-d'; sel.dispatchEvent(new Event('change'));
  })()`);
  await page.evaluate("document.getElementById('fingLeftHanded').click()");

  // A different instrument keeps its own, unrelated remembered values --
  // switching to it and back to guitar must not bleed one into the other.
  await page.evaluate(`(function () {
    const sel = document.getElementById('fingInstrument');
    sel.value = 'violin'; sel.dispatchEvent(new Event('change'));
  })()`);
  assert.equal(await page.evaluate("document.getElementById('fingLeftHanded').checked"), false);

  await page.evaluate(`(function () {
    const sel = document.getElementById('fingInstrument');
    sel.value = 'gtr'; sel.dispatchEvent(new Event('change'));
  })()`);
  assert.equal(await page.evaluate("document.getElementById('fingCapo').value"), '3');
  assert.equal(await page.evaluate("document.getElementById('fingTuning').value"), 'drop-d');
  assert.equal(await page.evaluate("document.getElementById('fingLeftHanded').checked"), true);

  // save() debounces panel-store writes at 1200ms (src/app.js); outlast it
  // before reloading, the same margin w-fixes-bar2-persist.test.mjs uses.
  await new Promise((r) => setTimeout(r, 1600));
  await page.reload();

  await page.evaluate("window.__coach.openPanel('fingerings')");
  await page.evaluate(`(function () {
    const sel = document.getElementById('fingInstrument');
    sel.value = 'gtr'; sel.dispatchEvent(new Event('change'));
  })()`);
  assert.equal(await page.evaluate("document.getElementById('fingCapo').value"), '3', 'capo should survive a reload');
  assert.equal(await page.evaluate("document.getElementById('fingTuning').value"), 'drop-d', 'tuning should survive a reload');
  assert.equal(await page.evaluate("document.getElementById('fingLeftHanded').checked"), true, 'left-handed should survive a reload');

  // Violin, never touched above, still has no remembered left-handed choice.
  await page.evaluate(`(function () {
    const sel = document.getElementById('fingInstrument');
    sel.value = 'violin'; sel.dispatchEvent(new Event('change'));
  })()`);
  assert.equal(await page.evaluate("document.getElementById('fingLeftHanded').checked"), false, 'an untouched instrument should not inherit another one’s remembered value');
});

test('fingerings panel: a capo typed past the 11th fret is kept as 11, not silently forgotten', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('fingerings')");
  const pick = id => page.evaluate(`(function () {
    const sel = document.getElementById('fingInstrument');
    sel.value = '${id}'; sel.dispatchEvent(new Event('change'));
  })()`);
  await pick('gtr');
  await page.evaluate(`(function () {
    const capo = document.getElementById('fingCapo');
    capo.value = '15'; capo.dispatchEvent(new Event('change'));
  })()`);
  await pick('violin');
  await pick('gtr');
  assert.equal(await page.evaluate("document.getElementById('fingCapo').value"), '11');
});
