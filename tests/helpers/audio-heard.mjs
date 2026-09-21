import { effectiveWaitMs } from './browser.mjs';

// Waits until the app's own audio-analysis loop (the setInterval in
// src/app.js, guarded by micReady/anTime) has actually READ a buffer
// carrying real signal, not just until micReady flipped true.
//
// Why this exists: micReady is set synchronously, before any synthetic
// audio has actually flowed through the AnalyserNode (testSource() wires
// the analyser and sets micReady, THEN starts the oscillators; openMic()
// is similar for a real mic). A freshly-connected AnalyserNode's ring
// buffer is zero-initialised, so for roughly fftSize/sampleRate (~85ms at
// fftSize 4096, 48kHz) getFloatTimeDomainData() returns a buffer that is
// partly or entirely zero-padding -- exactly the window that produced
// intermittent `freq: 0` / wide-cents-spread CI flakes. window.__coach's
// audioHeardTicks() counts only ticks where the app measured real signal
// (see src/app.js), so waiting for it to advance a few ticks proves the
// analyser has actually filled with audio before a test starts asserting
// on pitch -- a genuine missing precondition, not a widened tolerance.
export async function waitForAudioHeard(page, { minTicks = 3, timeoutMs = 5000 } = {}) {
  const budget = effectiveWaitMs(timeoutMs);
  const start = Date.now();
  for (;;) {
    const ticks = await page.evaluate(
      "(window.__coach && typeof window.__coach.audioHeardTicks === 'function') ? window.__coach.audioHeardTicks() : -1"
    );
    if (ticks >= minTicks) return;
    if (Date.now() - start > budget) {
      throw new Error(
        `waitForAudioHeard timed out after ${budget}ms: the app never reported hearing any audio ` +
        `(wanted audioHeardTicks() >= ${minTicks}, last saw ${ticks})`
      );
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}
