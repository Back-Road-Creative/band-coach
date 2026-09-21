// Drives the REAL mic-listening path (yin pitch detector + src/core/tuner.js
// state machine wired into src/app.js's toolPitch/drawTuner) through a fake
// microphone playing a synthesized WAV, the way tests/release/gate.test.mjs
// does for its "a note played into the microphone is heard and shown" check
// (see its captureScript / __bcCanvasText pattern, ~lines 89-124 -- installed
// here too via launchPage's `initScript`, without touching that file).
// This covers the user's actual complaint: "the note you play shows up real
// quick on the scale and disappears" -- a plucked string decays to silence in
// well under a second, and the old tuner blanked its whole DRAWN readout on
// the very first pitch-less poll after that. The persistence assertion below
// is therefore checked against what fillText actually drew on the canvas,
// not against internal state alone -- a bug in the debug-only hook could
// otherwise make this test pass while a real learner still saw nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage, effectiveWaitMs, retryFlaky } from '../helpers/browser.mjs';
import { waitForAudioHeard } from '../helpers/audio-heard.mjs';

const htmlPath = HTML_PATH;

// A manual `while (Date.now() - start < N)` poll loop is NOT routed through
// `page.waitFor()`'s own floor, so a literal budget here silently ignores
// `WAIT_FLOOR_MS`/`BAND_COACH_WAIT_FLOOR_MS` the way the old fixed 30s boot
// deadline used to (tests/helpers/browser.mjs) -- exactly the bug class that
// made test 2 flake red on a slower CI runner. Every deadline in this file
// is derived from `effectiveWaitMs()` instead of a literal so CI gets the
// same floor `waitFor()` itself would give it.
const POLL_BUDGET_MS = effectiveWaitMs(6000);

// Captures every CanvasRenderingContext2D.fillText call with a timestamp
// (performance.now(), so later checks need no clock sync with Node), the
// same technique tests/release/gate.test.mjs uses to read the canvas-drawn
// (not DOM-text) tuner readout without any debug hook.
const CAPTURE_SCRIPT = `
  (function () {
    window.__bcCanvasText = [];
    var proto = CanvasRenderingContext2D.prototype;
    var orig = proto.fillText;
    proto.fillText = function (text) {
      window.__bcCanvasText.push({ text: String(text), t: performance.now() });
      if (window.__bcCanvasText.length > 4000) window.__bcCanvasText.splice(0, 2000);
      return orig.apply(this, arguments);
    };
  })();
`;

// Pure-Node 16-bit PCM mono WAV writer (no deps), `envelopeAt(t)` returns the
// amplitude multiplier (0..1) for a sample at time t (seconds).
function writeEnvelopedWav(path, { seconds, freq, sampleRate = 48000, envelopeAt }) {
  const numSamples = Math.round(seconds * sampleRate);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const env = envelopeAt(t);
    const sample = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.85 * env;
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sample * 32767))), 44 + i * 2);
  }
  writeFileSync(path, buf);
  return path;
}

// A plucked-string-like tone: a sharp (20ms) attack, an exponential decay to
// silence within ~1.5s, then several seconds of true silence -- long enough
// that Chromium looping the fake-audio file (it always loops) does not
// re-pluck mid-assertion.
function writePluckWav(path, { freq = 440, sampleRate = 48000, attack = 0.02, decayTau = 0.15, activeDur = 1.5, totalDur = 8 } = {}) {
  return writeEnvelopedWav(path, {
    seconds: totalDur, freq, sampleRate,
    envelopeAt: (t) => (t < attack ? t / attack : t < activeDur ? Math.exp(-(t - attack) / decayTau) : 0),
  });
}

function writeSteadyWav(path, { freq = 440, sampleRate = 48000, seconds = 8 } = {}) {
  return writeEnvelopedWav(path, { seconds, freq, sampleRate, envelopeAt: () => 1 });
}

// Ukulele tuning (TUNINGS.uke in src/app.js): G4 C4 E4 A4 as midi 67 60 64 69,
// drawn top-to-bottom as rows 0..3. The 4th string (index 3) is A4 (440Hz);
// its drawn target-letter readout (nname with no octave flag) is plain "A".
async function openTuner(page) {
  await page.evaluate("document.querySelector('#picker button[data-mod=\"tuner\"]').click()");
  await page.evaluate(
    "(() => { const s = document.getElementById('optTune'); s.value = 'uke'; s.dispatchEvent(new Event('change')); })()"
  );
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true", effectiveWaitMs(5000));
  // ioBtn.hidden flips as soon as micReady is set, which (for both the real
  // mic path and testSource()) happens BEFORE any synthetic audio has
  // actually flowed through the AnalyserNode -- wait for the app to have
  // actually read a real-signal buffer before any test starts asserting on
  // pitch (see tests/helpers/audio-heard.mjs).
  await waitForAudioHeard(page);
}

// Simulates a tap on tuner row `idx` (0-based, top to bottom) by dispatching
// a real pointerdown at the client coordinates the row occupies -- computed
// from the same layout formula drawTuner uses (src/app.js), since the tuner
// rows are canvas-drawn, not DOM elements.
async function tapRow(page, idx, n = 4) {
  const rect = await page.evaluate(`
    (function () {
      const cv = document.getElementById('cv');
      const W = cv.width, H = cv.height, n = ${n}, i = ${idx};
      const y = H * 0.1 + i * (H * 0.5 / n), h = H * 0.5 / n - 8;
      const playW = Math.min(W * 0.05, h), rowW = W * 0.32 - playW - 10;
      const cx = W * 0.05 + rowW / 2, cy = y + h / 2;
      const r = cv.getBoundingClientRect();
      return { clientX: r.left + cx * r.width / W, clientY: r.top + cy * r.height / H };
    })()
  `);
  await page.evaluate(`
    document.getElementById('cv').dispatchEvent(new PointerEvent('pointerdown', {
      clientX: ${rect.clientX}, clientY: ${rect.clientY}, bubbles: true,
    }))
  `);
}

// Was the exact drawn `text` pushed to __bcCanvasText within the last
// `windowMs` (measured against the PAGE's own performance.now(), never
// Node's clock).
async function drawnRecently(page, text, windowMs = 250) {
  return page.evaluate(`
    (function () {
      var now = performance.now();
      var list = window.__bcCanvasText || [];
      for (var i = list.length - 1; i >= 0; i--) {
        if (now - list[i].t > ${windowMs}) break;
        if (list[i].text === ${JSON.stringify(text)}) return true;
      }
      return false;
    })()
  `);
}

test('a plucked note that decays into silence keeps being DRAWN for at least ~1s of silence', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-tuner-wav-'));
  const wavPath = writePluckWav(join(dir, 'pluck-a4.wav'));
  const page = await launchPage(htmlPath, { fakeAudioFile: wavPath, initScript: CAPTURE_SCRIPT });
  t.after(() => page.close());

  await openTuner(page);
  // Gate on the DRAWN "A" appearing at all, not on any debug hook -- a hook
  // that does not exist (or lies) must not be able to get this test past its
  // starting line.
  await page.waitFor("(window.__bcCanvasText || []).some((e) => e.text === 'A')", effectiveWaitMs(5000));

  const samples = [];
  const start = Date.now();
  while (Date.now() - start < POLL_BUDGET_MS) {
    const drawnA = await drawnRecently(page, 'A');
    // The hook (window.__coach.tuner()) is used ONLY as a secondary signal
    // (ageMs, to corroborate the silence really was silence); it is guarded
    // so a missing/renamed hook degrades this signal to null rather than
    // throwing and masking the real, canvas-based assertion below.
    const st = await page.evaluate("typeof window.__coach.tuner === 'function' ? window.__coach.tuner() : null");
    samples.push({ t: Date.now() - start, drawnA, ageMs: st ? st.ageMs || 0 : 0 });
    await new Promise((r) => setTimeout(r, 100));
  }

  // Find the longest continuous run where the "A" target letter was still
  // being drawn on the canvas, and the max ageMs (real silence duration)
  // reached inside that run. The old code's drawTuner never executed the
  // fillText(nname(target), ...) call at all once `heard.freq` went falsy,
  // so a fix-free run here could never grow ageMs while still drawing "A".
  let bestSpan = 0, bestMaxAge = 0, runStart = null, runMaxAge = 0;
  for (const s of samples) {
    if (s.drawnA) {
      if (runStart === null) runStart = s.t;
      runMaxAge = Math.max(runMaxAge, s.ageMs);
      const span = s.t - runStart;
      if (span > bestSpan) { bestSpan = span; bestMaxAge = runMaxAge; }
    } else {
      runStart = null; runMaxAge = 0;
    }
  }
  assert.ok(bestSpan >= 900, `expected "A" to be drawn continuously for >=900ms, longest run was ${bestSpan}ms`);
  assert.ok(bestMaxAge >= 900, `expected "A" to stay drawn through >=900ms of real silence (ageMs), best was ${bestMaxAge}ms`);
});

// One attempt: fresh page, fresh fake-audio stream, poll until the tuner
// confirms or the budget runs out. Returns what it saw either way.
async function attemptHold(htmlFile, wavPath) {
  const page = await launchPage(htmlFile, { fakeAudioFile: wavPath });
  try {
    await openTuner(page);
    const start = Date.now();
    let holding = false, last = null;
    const centsSeen = [];
    while (Date.now() - start < POLL_BUDGET_MS) {
      const st = await page.evaluate('window.__coach.tuner()');
      last = st;
      if (st && typeof st.cents === 'number') centsSeen.push(st.cents);
      if (st && st.phase === 'holding') { holding = true; break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    const spread = centsSeen.length ? Math.max(...centsSeen) - Math.min(...centsSeen) : null;
    return { holding, last, spread, samples: centsSeen.length };
  } finally {
    await page.close();
  }
}

// One of the two tests that made this file the repo's biggest source of CI
// red; see the `retryFlaky` note in tests/helpers/browser.mjs for the
// measurement and for why a retry is the right instrument and a widened
// tolerance is not.
test('a steady in-tune tone reaches the "holding" (tuned) state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-tuner-wav-'));
  const wavPath = writeSteadyWav(join(dir, 'steady-a4.wav'));
  await retryFlaky({
    what: 'a steady 440Hz tone reaching the "holding" (tuned) state on the uke A4 string',
    attempt: () => attemptHold(htmlPath, wavPath),
    accept: (r) => r.holding,
    describe: (r) =>
      `phase=${r.last && r.last.phase}, holdMs=${r.last && r.last.holdMs}, ` +
      `cents=${r.last && r.last.cents}, spread=${r.spread}, samples=${r.samples}`,
  });
});

test('locking a string keeps the selection even when a nearer pitch plays, and the lock is DRAWN', async (t) => {
  // C4 (~261.63Hz) is nearest to the uke's C4 string (index 1), not the G4
  // string (index 0) we are about to lock.
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-tuner-wav-'));
  const wavPath = writeSteadyWav(join(dir, 'steady-c4.wav'), { freq: 261.63 });
  const page = await launchPage(htmlPath, { fakeAudioFile: wavPath, initScript: CAPTURE_SCRIPT });
  t.after(() => page.close());

  await openTuner(page);
  await new Promise((r) => setTimeout(r, 300)); // let drawTuner run at least once so rowRects/playRects exist

  await tapRow(page, 0); // lock the G4 (index 0) row
  // The row's own fillText call appends "   LOCKED" to its text once locked
  // (src/app.js drawTuner) -- gate on the learner-visible text itself, not
  // on any debug hook, so a missing/renamed hook cannot get this test past
  // its starting line either.
  await page.waitFor(
    `(window.__bcCanvasText || []).slice(-60).some((e) => e.text.indexOf('LOCKED') !== -1)`,
    effectiveWaitMs(5000)
  );

  // Let real pitch detection run for a couple of seconds with the C4 tone.
  await new Promise((r) => setTimeout(r, 2000));

  assert.ok(
    await drawnRecently(page, 'String 4   G4   LOCKED', 500),
    'the row itself should still be drawn with the LOCKED text while the C4 tone plays'
  );

  // Secondary corroboration from internal state, guarded so a missing hook
  // degrades gracefully rather than masking the drawn-text assertion above.
  const st = await page.evaluate("typeof window.__coach.tuner === 'function' ? window.__coach.tuner() : null");
  if (st) {
    assert.ok(st.midi !== null, 'the tuner should be hearing the C4 tone');
    assert.equal(st.selIdx, 0, 'selection stays locked to string 0 even though the pitch is nearest string 1');
  }
  const lock = await page.evaluate("typeof window.__coach.tunerLock === 'function' ? window.__coach.tunerLock() : null");
  if (lock !== null) assert.equal(lock, 0, 'the lock itself is unaffected');
});
