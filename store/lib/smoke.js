// The verdict for `--smoke-test` launches (see main.js and the "launch the
// packaged app" step in .github/workflows/store-package.yml). Pure and
// Electron-free so it is unit-tested without a Windows box
// (tests/unit/store-launch-smoke.test.mjs).
'use strict';

const SMOKE_FLAG = '--smoke-test';

// Run in the loaded page with a user gesture: the same call the app's Connect
// button makes, so the shell's permission handlers answer it for real.
const MIDI_PROBE = `Promise.race([
  navigator.requestMIDIAccess().then((a) => 'ok, inputs ' + a.inputs.size, (e) => e.name + ': ' + e.message),
  new Promise((resolve) => setTimeout(() => resolve('no answer'), 15000)),
])`;

// Permission was granted when the request resolved, or when it got past the
// permission stage and found no MIDI service (InvalidStateError: a machine's
// problem, not the shell's). A refusal, no answer, or a probe that never ran is
// a failure.
function midiWasGranted(midi) {
  return typeof midi === 'string' && /^(ok\b|InvalidStateError\b)/.test(midi);
}

// 0 only when the page finished loading, nothing failed to load, the
// renderer never went away, the page logged no errors, and the shell
// granted MIDI.
function smokeExitCode({ loaded, failedLoad, rendererGone, pageErrors, midi }) {
  if (rendererGone) return 3;
  if (failedLoad) return 2;
  if (!loaded) return 4;
  if (pageErrors && pageErrors.length) return 5;
  if (!midiWasGranted(midi)) return 6;
  return 0;
}

module.exports = { SMOKE_FLAG, MIDI_PROBE, smokeExitCode };
