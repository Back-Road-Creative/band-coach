// CURRENT BEHAVIOUR (post-declutter, U3): the flat #picker row used to mix 24
// peer buttons -- real instruments and the two-tag-'tool' entries (Tuner,
// Capture a melody) plus the two pseudo-mods (Ear training, Rhythm reading)
// -- with nothing telling them apart. This pins three things: (a) a tool
// button is visually distinguishable from an instrument button via its
// container/class, (b) "Ear training" is exactly one control in the whole
// document (the mod-picker entry and the #panelPicker Ear training panel
// used to duplicate the label), (c) clicking a tool still selects that mod
// exactly as before -- dataset.mod and the aria-pressed contract are
// untouched by the regrouping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('tools group: tool buttons are visually distinct from instrument buttons', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const kbdClass = await page.evaluate("document.querySelector('#picker button[data-mod=\"kbd\"]').closest('#picker').className + '|' + (document.querySelector('#picker button[data-mod=\"kbd\"]').closest('.picker-tools') ? 'tools' : 'not-tools')");
  const tunerInTools = await page.evaluate("Boolean(document.querySelector('#picker button[data-mod=\"tuner\"]').closest('.picker-tools'))");
  const kbdInTools = await page.evaluate("Boolean(document.querySelector('#picker button[data-mod=\"kbd\"]').closest('.picker-tools'))");

  assert.equal(tunerInTools, true, 'the Tuner tool button sits inside a .picker-tools group: ' + kbdClass);
  assert.equal(kbdInTools, false, 'the Keyboard instrument button does not sit inside .picker-tools');
});

test('tools group: every pseudo-mod tool is grouped, not just the two real tools', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const earInTools = await page.evaluate("Boolean(document.querySelector('#picker button[data-mod=\"ear\"]').closest('.picker-tools'))");
  const rhyInTools = await page.evaluate("Boolean(document.querySelector('#picker button[data-mod=\"rhy\"]').closest('.picker-tools'))");
  const captureInTools = await page.evaluate("Boolean(document.querySelector('#picker button[data-mod=\"capture\"]').closest('.picker-tools'))");

  assert.equal(earInTools, true, 'Ear training (pseudo-mod) is grouped with the tools');
  assert.equal(rhyInTools, true, 'Rhythm reading (pseudo-mod) is grouped with the tools');
  assert.equal(captureInTools, true, 'Capture a melody is grouped with the tools');
});

test('Ear training appears as exactly one control labelled exactly "Ear training"', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  // The mod-picker's interval/chord drill and the #panelPicker's
  // eight-exercise suite are genuinely different features (see MODS.ear's
  // comment in src/app.js), so the fix keeps both and names the picker one
  // for what it actually is, "Interval drill", rather than deleting either.
  //
  // Checked two ways, and the SUBSTRING check is the one that matters. An
  // earlier attempt named it "Ear training: quick drill", which passes an
  // exact-match check while still showing a learner two buttons that both
  // begin "Ear training" — the duplication this test exists to prevent.
  // Only a substring check catches that, so if someone renames it back to
  // any "Ear training ..." variant, this goes red.
  const exact = await page.evaluate(
    "Array.from(document.querySelectorAll('button')).filter(b => (b.firstChild && b.firstChild.textContent || '').trim() === 'Ear training').length"
  );
  assert.equal(exact, 1, 'exactly one control should be labelled exactly "Ear training"');

  const containing = await page.evaluate(
    "Array.from(document.querySelectorAll('button')).filter(b => ((b.firstChild && b.firstChild.textContent) || '').indexOf('Ear training') !== -1).length"
  );
  assert.equal(
    containing,
    1,
    'exactly one control\'s label should mention "Ear training" at all — two buttons whose labels ' +
      'both start with it read as duplication whatever the suffix says',
  );
});

test('clicking a grouped tool button still selects that mod unchanged', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("document.querySelector('#picker button[data-mod=\"tuner\"]').click()");
  await page.waitFor("document.querySelector('#picker button[data-mod=\"tuner\"]').getAttribute('aria-pressed') === 'true'");

  const pressed = await page.evaluate("document.querySelector('#picker button[data-mod=\"tuner\"]').getAttribute('aria-pressed')");
  const otherPressed = await page.evaluate("document.querySelector('#picker button[data-mod=\"kbd\"]').getAttribute('aria-pressed')");
  assert.equal(pressed, 'true', 'tuner button reports pressed after click');
  assert.equal(otherPressed, 'false', 'kbd button is not pressed while tuner is selected');
});
