// BC-2: on a 390x844 phone the learner sees the next action (Start) AND
// where they are (level, progress bar, the coach's one-line objective)
// together, without scrolling past the stage. Before this, the level card sat
// ~1300px down the page, so Start was visible but "what am I working toward"
// was not. Only layout order changes: DOM order (so Tab order and screen-reader
// reading order) and every control's behaviour are untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { rectOf, assertInFirstScreen } from '../helpers/journey.mjs';

test('phone: level, progress and objective sit right after Start, inside the first screen', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.setViewport({ width: 390, height: 844, mobile: true });
  const start = await rectOf(page, '#playBtn');
  assertInFirstScreen(start, 844, 'Start');
  for (const sel of ['#levelNum', '#readyBar']) {
    const r = await rectOf(page, sel);
    assertInFirstScreen(r, 844, sel);
    assert.ok(r.top >= start.bottom - 1, `${sel} follows Start (top ${r.top}, Start bottom ${start.bottom})`);
    assert.ok(r.top - start.bottom < 120, `${sel} is beside Start, not far below (${r.top - start.bottom}px gap)`);
  }
  // DOM order is unchanged: Start stays first in the side rail for keyboard and screen readers.
  assert.equal(await page.evaluate("document.getElementById('playBtn').compareDocumentPosition(document.getElementById('readyBar')) & Node.DOCUMENT_POSITION_FOLLOWING"), 4, 'DOM order still Start then progress');
});
