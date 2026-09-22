import { effectiveWaitMs } from './browser.mjs';

// Decides, one polled reading at a time, when `targetMidi` has been held
// for `holdMs`. `observe(midi, now)` takes the rounded midi the page just
// reported (or null when it heard no pitch this frame) and returns true
// once the hold is complete.
//
// A null reading is a dropped frame, not a new pitch: it neither breaks nor
// completes the hold, the same way handleRangeTest('tick') in src/app.js
// skips `!fr.freq` frames and keeps timing the note it was already on.
// Only a DIFFERENT pitch restarts the hold.
export function steadyMidiTracker(targetMidi, holdMs) {
  let steadySince = null;
  return function observe(midi, now) {
    if (midi === null) return false;
    if (midi === targetMidi) {
      if (steadySince === null) steadySince = now;
      return now - steadySince >= holdMs;
    }
    steadySince = null;
    return false;
  };
}

// Waits for a snapshot of `window.__coach.heard()` whose rounded midi is
// `targetMidi`, then keeps that same pitch steady for `holdMs` more
// (polling) before returning -- so a click that follows is known to land
// after the flow has actually accumulated a sustained sample, not on the
// very first frame that happened to match.
export async function waitForSteadyMidi(page, targetMidi, holdMs, timeoutMs = 8000) {
  const budget = effectiveWaitMs(timeoutMs);
  const start = Date.now();
  const observe = steadyMidiTracker(targetMidi, holdMs);
  for (;;) {
    const midi = await page.evaluate(
      "(() => { const h = window.__coach.heard(); return h && h.freq ? Math.round(h.midi) : null; })()"
    );
    const now = Date.now();
    if (observe(midi, now)) return;
    if (now - start > budget) {
      throw new Error(`waitForSteadyMidi timed out after ${budget}ms: wanted midi ${targetMidi} steady for ${holdMs}ms, last saw ${midi}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}
