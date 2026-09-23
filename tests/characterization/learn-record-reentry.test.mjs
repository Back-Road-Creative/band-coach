// "Learn this" panel (src/ui/learn.js), the mic door's Record button under
// re-entry. Companion to tests/characterization/learn-this.test.mjs, which
// proves the happy count-in -> capture -> Stop path; this proves two things
// that path alone does not exercise:
//
// (1) startMicRecording()'s reentry guard (`if (counting || recording)
//     return;`) runs BEFORE `await api.openMic()`, but `counting` is only
//     set true AFTER that await resolves. A learner who taps Record twice
//     while the mic-permission prompt (or a slow device) is still pending
//     sees neither click blocked by the guard, so both calls run
//     openMic() -> schedule a count-in -> beginCapture -> recorder.start(),
//     leaving two overlapping count-ins and two capture attempts instead of
//     one.
// (2) recordBtn is disabled for the whole count-in, so the "Stop mid
//     count-in cancels cleanly" path that beginCapture() and
//     stopMicRecording() are both written to support (`if (!counting)
//     return;` / `if (counting) { ...cancel...}`) is dead code: there is no
//     way to click a disabled button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

// Counts every getUserMedia() call the page makes and delays each one by
// 500ms -- comfortably long enough for a second Record click to land while
// the first is still awaiting the (fake) permission prompt, and a realistic
// stand-in for a real permission dialog or a USB interface waking up.
const SLOW_COUNTED_GETUSERMEDIA = `
  (function () {
    window.__gumCalls = 0;
    var orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function (constraints) {
      window.__gumCalls++;
      return new Promise(function (resolve, reject) {
        setTimeout(function () { orig(constraints).then(resolve, reject); }, 500);
      });
    };
  })();
`;

test('a second Record click while the microphone is still opening does not start a second count-in', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: SLOW_COUNTED_GETUSERMEDIA });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('learn')");

  await page.evaluate("document.querySelector('.panel-learn-record-btn').click()");
  // Land the second click well inside the 500ms getUserMedia delay above,
  // before the first call has resolved and claimed the slot.
  await new Promise((r) => setTimeout(r, 100));
  await page.evaluate("document.querySelector('.panel-learn-record-btn').click()");

  // Let both getUserMedia calls (if there are two) resolve and the count-in
  // that follows run its course.
  await page.waitFor("document.querySelector('.panel-learn-record-btn').textContent === 'Stop'", 15000);

  const gumCalls = await page.evaluate('window.__gumCalls');
  assert.equal(gumCalls, 1, 'a second Record click during the mic-permission wait opened the microphone a second ' +
    'time, which is what starts a second, overlapping count-in: ' + gumCalls);

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions from a double Record click');

  // Clean shutdown: Stop the one recording that should be in progress.
  await page.evaluate("document.querySelector('.panel-learn-record-btn').click()");
  await page.waitFor("document.querySelector('.panel-learn-record-btn').textContent === 'Record'", 15000);
});

test('Record stays clickable during the count-in, and clicking it cancels back to idle with no capture', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('learn')");

  // A slow tempo so the count-in stays up long enough to reliably observe
  // and click mid-way through, without racing straight to capture.
  await page.evaluate(
    "(() => { const b = document.getElementById('learnBpm'); b.value = '40'; b.dispatchEvent(new Event('input', { bubbles: true })); })()"
  );
  await page.evaluate("document.querySelector('.panel-learn-record-btn').click()");

  await page.waitFor("document.querySelector('.panel-learn-record-btn').textContent === 'Counting in…'", 15000);

  const disabledMidCountIn = await page.evaluate("document.querySelector('.panel-learn-record-btn').disabled");
  assert.equal(disabledMidCountIn, false, 'the Record button is disabled during the count-in, so there is no way ' +
    'to click it to cancel -- the mid-count-in Stop path the app is written to support is unreachable');

  await page.evaluate("document.querySelector('.panel-learn-record-btn').click()");

  await page.waitFor("document.querySelector('.panel-learn-record-btn').textContent === 'Record'", 15000);
  const beat = await page.evaluate("document.querySelector('.panel-learn-beat').textContent");
  assert.equal(beat, '', 'the beat display was not cleared when the count-in was cancelled');

  // No capture ever started, so no result should appear even after waiting
  // out however long the cancelled count-in and a would-be capture would
  // otherwise have taken.
  await new Promise((r) => setTimeout(r, 1500));
  const resultHidden = await page.evaluate("document.querySelector('.panel-learn-result').hidden");
  assert.equal(resultHidden, true, 'a result appeared even though the count-in was cancelled before any capture started');

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions cancelling a count-in');
});
