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

// Polls until a single ATOMIC read of the worklet's gate, rms and freq
// together satisfies `predicate`, and returns that same read -- never a value
// read on a later round-trip. mic-gate-calibration.test.mjs used to sample
// the ring-down band with window.__coach.heard() in one page.evaluate() call,
// then assert on a SECOND, separate window.__coach.heard() call: a decaying
// pluck's rms fluctuates fast enough that the two calls can land on different
// frames, so the assertion silently checked a different instant than the one
// its own wait had qualified (CI run 35555805097: "rms 0.0081187 is below
// 0.008" printed a value that was NOT below 0.008). Bundling gate+rms+freq
// into one expression closes that gap structurally -- there is no way to read
// half the snapshot on one trip and the other half on another.
export async function waitForHeardSnapshot(page, predicate, { timeoutMs = 5000 } = {}) {
  const budget = effectiveWaitMs(timeoutMs);
  const start = Date.now();
  let snap = null;
  for (;;) {
    snap = await page.evaluate(
      "(() => { const h = window.__coach.heard(); return h ? { gate: window.__coach.pitchWorkletGate(), rms: h.rms, freq: h.freq } : null; })()"
    );
    if (snap && predicate(snap)) return snap;
    if (Date.now() - start > budget) {
      throw new Error(
        `waitForHeardSnapshot timed out after ${budget}ms: last snapshot ${JSON.stringify(snap)}`
      );
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}
