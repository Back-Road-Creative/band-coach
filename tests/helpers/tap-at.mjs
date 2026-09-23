// Taps at a chosen AudioContext time by building a fake DOM event timeStamp
// that the app's toAudioTime() resolves back to that time.
//
// The clock anchor (audioNow(), performance.now()) is read in the SAME page
// task as the tap, so it is the anchor onTap itself reads. Reading it in one
// page.evaluate() and tapping in the next let the audio clock move between
// the two under a loaded full-suite run (68 ms seen against a 50 ms check).
export async function tapAtAudioTime(page, targetAudioTime) {
  await page.evaluate(`(function () {
    const offset = window.__coach.audioNow() - performance.now() / 1000;
    window.__coach.tap({ timeStamp: (${targetAudioTime} - offset) * 1000 });
  })()`);
}
