// `launchPage` waited for `#cv` to exist in a complete file:// document and
// called that booted. But `#cv` is in the static markup — it is there before
// the app script has run a single line. So on a loaded box the helper handed
// back a page whose boot had not finished, and the test's very first call
// died on it:
//
//   not ok 16 - opening the break card moves focus inside it and closing restores focus
//     error: evaluate failed: TypeError: Cannot read properties of undefined (reading 'setMod')
//     duration_ms: 747
//
// 747ms in, with a 30s budget still untouched: nothing timed out, the gate
// simply measured the wrong thing. Waiting longer would not fix it, because
// the condition it waits on can be true forever while the app is still
// booting.
//
// The app now says when it is done: the last thing boot does is set
// `data-coach-ready` on <html>, in the release build as well as the dev one,
// and that attribute is what the helper waits for. This test pins the
// contract from the outside — if boot stops announcing itself, every browser
// test goes back to racing it, so the failure belongs here where it names the
// cause rather than in whichever test happened to run first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

// No retry wrapper here any more: launchPage retries a boot that runs out of
// budget itself (see retryOnBootDeadline), so this test -- and every other
// browser test, including ones not yet written -- gets that for free. The
// wrapper this file used to carry only ever protected this one test, while
// deaf-window.test.mjs hit the identical failure unprotected.
test('launchPage does not hand back a page until the app has finished booting', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  assert.equal(
    await page.evaluate("document.documentElement.getAttribute('data-coach-ready')"),
    '1',
    'boot must mark the document ready as its last act'
  );
  assert.equal(
    await page.evaluate('typeof window.__coach'),
    'object',
    'the debug hook is installed on that same last line, so a ready page always has it'
  );
});

test('a reload is held to the same readiness bar as the first load', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await page.reload();

  assert.equal(
    await page.evaluate("document.documentElement.getAttribute('data-coach-ready')"),
    '1',
    'a reloaded page must be booted before the helper returns, not merely loaded'
  );
  assert.equal(await page.evaluate('typeof window.__coach'), 'object');
});
