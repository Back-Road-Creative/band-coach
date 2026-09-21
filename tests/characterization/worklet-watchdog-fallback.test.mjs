// VERIFIED DEFECT 2 (worklet-watchdog-fallback): a broken pitch-worklet
// PROCESSOR (v1.4.0's shipped defect -- fixed separately, not this file's
// concern) throws inside its own constructor on the audio thread. That
// throw surfaces asynchronously: addModule() still resolves and
// `new AudioWorkletNode(...)` still succeeds (src/audio/pitch-worklet.js's
// createPitchNode), so src/app.js's ensurePitchWorklet() ends up holding a
// pitchWorkletNode that LOOKS healthy but whose process() never ran, so its
// port never posts a single message. Because pitchWorkletNode is non-null,
// listen()'s own setInterval fallback (src/app.js:944-945) stands down
// forever -- the one path that would have kept working is switched off by
// exactly the failure it exists to cover. A 'processorerror' event is not a
// usable signal here either (measured against the actual broken build:
// never reached the page).
//
// This does not need the real broken processor to prove the app recovers --
// it fakes the SHAPE of the defect directly: a real AudioWorkletNode
// subclass that constructs and connects exactly like the genuine one, but
// whose port.onmessage setter is intercepted so no handler is ever actually
// installed on the underlying MessagePort. Messages the (real, working)
// processor posts are then simply queued and never delivered -- the same
// externally-observable behaviour as a processor that never posts at all,
// without this test depending on the separately-owned constructor bug.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { pluck, writePluckWav } from '../helpers/pluck-wav.mjs';

const htmlPath = HTML_PATH;
const SR = 48000;
const FREQ = 220; // A3, comfortably inside guitar's range

const dir = mkdtempSync(join(tmpdir(), 'band-coach-worklet-watchdog-'));
const wavPath = join(dir, 'steady.wav');
writePluckWav(wavPath, pluck(FREQ, SR, 6.0, { seed: 5, steady: true }), SR);

// Installed before the page's own script runs (Page.addScriptToEvaluateOnNewDocument),
// same technique as tests/characterization/a11y-wake-lock.test.mjs. Wraps
// the REAL AudioWorkletNode (so addModule()/connect()/disconnect() all
// behave exactly as they do for a genuinely healthy worklet) and only
// swallows the one thing this test needs dead: any handler ever reaching
// port.onmessage.
const DEAD_WORKLET_INIT = `
  window.__deadWorkletNodesCreated = 0;
  const RealAudioWorkletNode = window.AudioWorkletNode;
  class DeadPitchWorkletNode extends RealAudioWorkletNode {
    constructor(...args) {
      super(...args);
      window.__deadWorkletNodesCreated++;
      // Overriding this OWN property shadows the inherited port.onmessage
      // IDL setter for every assignment src/app.js makes -- the browser's
      // real onmessage callback slot is therefore never populated, so any
      // message the (real, working) processor posts is queued and simply
      // never delivered. Exactly the externally-observable shape of a
      // processor whose constructor threw before ever calling process().
      Object.defineProperty(this.port, 'onmessage', { configurable: true, get: () => null, set: () => {} });
    }
  }
  Object.defineProperty(window, 'AudioWorkletNode', { configurable: true, value: DeadPitchWorkletNode });
`;

test('a worklet that constructs/connects but never posts a frame is detected and the main-thread fallback takes over', async (t) => {
  const page = await launchPage(htmlPath, { initScript: DEAD_WORKLET_INIT, fakeAudioFile: wavPath });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('ioBtn').click()");

  // Proves the stub actually engaged -- if this is 0 the rest of the test
  // proves nothing about the watchdog.
  await page.waitFor('window.__deadWorkletNodesCreated > 0', 8000);

  // The dead worklet must have looked "connected" at some point: the app
  // still thought it had a working worklet before the watchdog could have
  // tripped. Immediately after connecting, pitchWorkletActive() is briefly
  // true (addModule() resolved, node constructed) -- give it a moment, then
  // require the watchdog to have taken it back down.
  await page.waitFor('window.__coach.pitchWorkletActive() === false', 8000);

  // The level meter is driven by meterUpdate(fr.rms), called from BOTH the
  // worklet's onmessage handler and listen()'s setInterval fallback
  // (src/app.js) -- with the worklet's messages never delivered, only the
  // fallback can be moving it. A real fake-audio-file signal is playing, so
  // once the fallback has taken over the meter must show non-zero level.
  await page.waitFor(`
    (function () {
      const w = document.getElementById('micLevelFill').style.width;
      return parseFloat(w) > 0;
    })()
  `, 8000);

  const width = await page.evaluate("parseFloat(document.getElementById('micLevelFill').style.width)");
  assert.ok(width > 0, `expected the mic level meter to move once the fallback took over, got width=${width}`);

  // The failure must be recorded, not silent (CLAUDE.md/plan: "Never hide
  // what the app heard").
  const errors = await page.evaluate('window.__coach.errors()');
  assert.ok(
    errors.some((e) => e.where === 'worklet-watchdog'),
    `expected a recorded error from the worklet watchdog, got ${JSON.stringify(errors)}`
  );
});
