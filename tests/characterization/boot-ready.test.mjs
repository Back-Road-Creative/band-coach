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
import { BOOT_DEADLINE_CODE, launchPage, retryFlaky } from '../helpers/browser.mjs';

// One independent attempt: its own browser, closed before it returns, so no
// attempt can contaminate the next. A boot that runs out of budget is returned
// as a RESULT rather than thrown, because that is the transient this retry
// exists for; every other error still propagates and aborts immediately, so a
// genuine break in boot is never retried into silence.
async function attemptBoot() {
  let page;
  try {
    page = await launchPage(HTML_PATH);
  } catch (err) {
    if (err && err.code === BOOT_DEADLINE_CODE) return { bootTimedOut: true, ready: null, hook: null };
    throw err;
  }
  try {
    return {
      bootTimedOut: false,
      ready: await page.evaluate("document.documentElement.getAttribute('data-coach-ready')"),
      hook: await page.evaluate('typeof window.__coach'),
    };
  } finally {
    await page.close();
  }
}

test('launchPage does not hand back a page until the app has finished booting', async () => {
  const seen = await retryFlaky({
    attempt: attemptBoot,
    accept: (r) => !r.bootTimedOut,
    describe: (r) => (r.bootTimedOut ? 'boot ran out of budget' : `ready=${r.ready} hook=${r.hook}`),
    what: 'booting the page',
  });

  assert.equal(
    seen.ready,
    '1',
    'boot must mark the document ready as its last act'
  );
  assert.equal(
    seen.hook,
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
