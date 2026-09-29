// Clicks "Your turn" and plays a note the instant real listening begins, all
// inside ONE page.evaluate() -- so under a loaded runner there is no gap for
// Node-side scheduling delay to open between "listening has started" and
// "the note was delivered".
//
// Before this helper, callers did the click, a `page.waitFor(...)` for the
// "Notes heard so far" paragraph, and a THIRD, separate `page.evaluate()` to
// call `window.__coach.songsNote()` -- three CDP round trips, each one a
// point where a starved Node event loop (busy running other test files, or
// just contending with everything else on the box) could add real wall-clock
// delay before the next step runs. Every millisecond added there is a
// millisecond the note lands late relative to the phrase's own t=0, which a
// timed check step (rhythm, tempo ladder) judges against -- late enough and
// a genuinely correct answer is marked wrong (2026-09-26: reproduced as
// "acc 1, got 0.78" and a check step stuck failing forever under load).
//
// Polling for the listening state IN THE PAGE (a tight 4ms loop, same
// interval as the `keyAt`/`grooveInject` pattern) and calling `songsNote()`
// in the same synchronous turn that observes the state change removes that
// gap: the only latency left is however long the app itself took to flip the
// state, which is exactly what a real learner's key press would also be
// racing against.
//
// Even that last gap lost under heavy load (G-flaky-under-load-3, 2026-09-27:
// songs-session-log still saw "acc 0.78"), because songsNote() stamps the
// note with api.now() at call time. The note is now delivered through
// songsNoteAt(midi, 0) instead: stamped at the attempt's own recordStartSec,
// i.e. exactly on beat one, however late the call itself runs. This helper
// promises "the note at t=0", so that is what it now delivers.
export async function playSongNoteWhenListening(page, midi, exact = true) {
  await page.evaluate(`(async () => {
    const turnBtn = Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn');
    if (turnBtn) turnBtn.click();
    const deadline = Date.now() + 20000; // a screen with no "Your turn" (an interlude) fails fast instead of hanging the file
    while (!(document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far'))) {
      if (Date.now() > deadline) throw new Error('never started listening; screen: ' + ((document.querySelector('.panel-songs-practice h4') || {}).textContent || '(no heading)'));
      await new Promise(r => setTimeout(r, 4));
    }
    window.__coach.songsNoteAt(${JSON.stringify(midi)}, 0, ${JSON.stringify(exact)});
  })()`);
}
