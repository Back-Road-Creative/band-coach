// R10 visual polish (JP-approved 2026-09-23, rows P1-P9). This file pins the
// five rows the plan calls out for a DOM assertion -- P2 (eyebrow case),
// P3 (display-type case), P4 (drop the idle instrument-name watermark),
// P7 (energy label reads "Fresh" when full) and P8 (status dot and its text
// share one line on a phone-width viewport). P1/P5/P6/P9 are CSS-only
// consistency passes with no behaviour to assert and are covered instead by
// the existing tests/unit/theme-contrast.test.mjs (no changed colour may
// drop below 4.5:1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

function computed(sel, prop) {
  return `getComputedStyle(document.querySelector(${JSON.stringify(sel)})).${prop}`;
}

test('P2: card eyebrows are sentence case, 13px, weight 600, no letter-spacing', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  const textTransform = await page.evaluate(computed('.eyebrow', 'textTransform'));
  const fontSize = await page.evaluate(computed('.eyebrow', 'fontSize'));
  const fontWeight = await page.evaluate(computed('.eyebrow', 'fontWeight'));
  const letterSpacing = await page.evaluate(computed('.eyebrow', 'letterSpacing'));
  assert.equal(textTransform, 'none', 'eyebrow text must not be forced uppercase');
  assert.equal(fontSize, '13px');
  assert.equal(fontWeight, '600');
  assert.ok(letterSpacing === 'normal' || letterSpacing === '0px', `expected no letter-spacing, got ${letterSpacing}`);
});

test('P3: exercise/level/break/history display type is sentence case, h1 and Start stay uppercase', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate("window.__coach.openPanel('history')");

  const sentenceCase = {
    '#prompt': await page.evaluate(computed('#prompt', 'textTransform')),
    '#levelName': await page.evaluate(computed('#levelName', 'textTransform')),
    '#tapPad': await page.evaluate(computed('#tapPad', 'textTransform')),
    '.panel-history h2': await page.evaluate(computed('.panel-history h2', 'textTransform')),
    '.panel-history h3': await page.evaluate(computed('.panel-history h3', 'textTransform')),
  };
  for (const [sel, tt] of Object.entries(sentenceCase)) assert.equal(tt, 'none', `${sel} should not be uppercase`);

  const h1 = await page.evaluate(computed('h1', 'textTransform'));
  const startBtn = await page.evaluate(computed('#playBtn', 'textTransform'));
  assert.equal(h1, 'uppercase', 'the h1 wordmark keeps its uppercase display type');
  assert.equal(startBtn, 'uppercase', 'the Start button keeps its uppercase display type');
});

test('P4: the idle stage does not draw the selected instrument name as a watermark', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  const prompt = await page.evaluate("document.getElementById('prompt').textContent");
  assert.ok(
    !/keyboard/i.test(prompt),
    `expected the idle #prompt not to render the instrument name as a watermark; got ${JSON.stringify(prompt)}`
  );
});

test('P7: a full, unspent energy bar is labelled "Fresh", not left to read as already-done', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  const width = await page.evaluate("document.getElementById('energyFill').style.width");
  assert.equal(width, '100%', 'a fresh load with no session should show a full energy bar');
  const label = await page.evaluate("document.getElementById('sessLine').textContent");
  assert.match(label, /Fresh/, `expected the full energy bar's label to say "Fresh"; got ${JSON.stringify(label)}`);
});

test('P8: on a phone viewport the input status dot and its text sit on the same line', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.setViewport({ width: 390, height: 844, mobile: true });
  const rects = JSON.parse(await page.evaluate(`JSON.stringify({
    dot: document.getElementById('ioDot').getBoundingClientRect(),
    text: document.getElementById('ioText').getBoundingClientRect(),
  })`));
  assert.ok(rects.text.width > 0, 'expected #ioText to have visible content to measure');
  assert.ok(
    Math.abs(rects.dot.top - rects.text.top) < 6,
    `expected the dot and its text to start on the same line; dot.top=${rects.dot.top} text.top=${rects.text.top}`
  );
  assert.ok(
    rects.text.left >= rects.dot.right,
    `expected the text to sit to the right of the dot, not wrapped below it; dot.right=${rects.dot.right} text.left=${rects.text.left}`
  );
});
