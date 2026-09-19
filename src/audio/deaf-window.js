// The app plays its own sound (a reference tone, an example, a metronome
// click) through the speakers while a microphone-based mode is listening.
// Without this, the mic hears the app's own output and the pitch detector
// can credit the app's own sound as the learner's answer (flaw F5).
//
// A "deaf window" is a span of time during which mic-derived pitch input
// should be ignored. Any code that starts an oscillator calls open() with
// how long the sound will play; the mic-processing loop checks isDeaf()
// before crediting anything. Overlapping opens extend the window — they
// never shorten it — so back-to-back sounds (an interval, a broken chord)
// keep the mic deaf until the last one plus its tail has finished.
export function createDeafWindow({ now = () => performance.now() } = {}) {
  let openUntil = -Infinity;
  return {
    // durationMs: how long the sound itself lasts, from the moment of this
    // call. tailMs: extra quiet time after the sound to let room echo and
    // decay clear before the mic is trusted again.
    open(durationMs, tailMs = 250) {
      const end = now() + Math.max(0, durationMs) + Math.max(0, tailMs);
      if (end > openUntil) openUntil = end;
    },
    isDeaf() {
      return now() < openUntil;
    },
    // The timestamp (in the injected clock's units) the window closes at.
    until() {
      return openUntil;
    },
  };
}
