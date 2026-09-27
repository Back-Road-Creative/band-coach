// VERIFIED DEFECT (a11y-setup-sheet-focus): #setupBtn's click handler
// (src/app.js) calls `this.blur()` on every toggle -- opening OR closing the
// sheet -- which drops keyboard focus to <body>. A keyboard user who presses
// Enter/Space on "Set up input" loses their place on the page every single
// time, forced to Tab back in from the top to reach anything else, including
// the sheet that just opened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('activating "Set up input" with the keyboard keeps focus on the button, open and closed', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("document.getElementById('setupBtn').focus()");

  // Open: Enter on the focused button.
  await page.press('Enter');
  await page.waitFor("document.getElementById('setupSheet').hidden === false");
  assert.equal(
    await page.evaluate("document.activeElement === document.getElementById('setupBtn')"),
    true,
    'expected focus to stay on #setupBtn after opening the sheet'
  );

  // Close: Enter again on the same (still-focused) button.
  await page.press('Enter');
  await page.waitFor("document.getElementById('setupSheet').hidden === true");
  assert.equal(
    await page.evaluate("document.activeElement === document.getElementById('setupBtn')"),
    true,
    'expected focus to stay on #setupBtn after closing the sheet'
  );
});
