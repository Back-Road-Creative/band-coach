// THE BUG THIS FILE EXISTS FOR, reported by hand against the released
// v1.4.0 download: the microphone exercises did not react at all -- the
// input-level meter never moved -- while the tuner, on the same microphone,
// worked fine.
//
// Cause: the worklet's source travels as a STRING built by splicing in each
// helper's own source text (src/audio/pitch-worklet.js), and the class body
// called those helpers by their ORIGINAL names as literal text. `--release`
// minifies, so esbuild renamed the declarations while the call sites inside
// the string kept saying `yin(` and `createOnsetDetector(`. The processor
// threw a ReferenceError in its constructor, on the audio thread, and never
// produced a single frame.
//
// It was invisible in three separate ways, which is why it shipped:
//   1. A processor-constructor throw surfaces asynchronously as
//      `processorerror`. addModule() resolves, the AudioWorkletNode is
//      constructed, and the app holds a perfectly good-looking node object.
//   2. Holding that node makes the main-thread fallback stand down
//      (src/app.js: `if (pitchWorkletNode) return;`), so the path that would
//      have worked is switched off by the failure it is meant to cover.
//   3. Every other microphone test runs the DEV build, where nothing is
//      minified. The only release-build microphone test was the tuner, which
//      reads the microphone on its own and never touches the worklet.
//
// So this test drives the one combination nothing covered: the REAL release
// artifact, real audio, a microphone EXERCISE. It deliberately asserts on
// the level meter rather than on any judging outcome, because the meter is
// written straight from the worklet's frames before any gate, tolerance or
// note matching -- it is the narrowest possible readout of "frames are
// arriving", which is exactly what broke.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchPage, effectiveWaitMs } from '../helpers/browser.mjs';

const RELEASE_HTML = fileURLToPath(new URL('../../dist/release/band-coach.html', import.meta.url));

// A continuous tone, not a pluck: this test asks "does audio reach the
// exercise at all", so the signal should still be present whenever the
// meter is sampled. Chromium loops the file, so a short one is fine.
function writeToneWav(path, { freq = 196, sampleRate = 48000, seconds = 2 } = {}) {
  const numSamples = Math.round(seconds * sampleRate);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const v = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.6;
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2);
  }
  writeFileSync(path, buf);
  return path;
}

// Records every `processorerror` any AudioWorkletNode ever fires. This is
// the signal the app itself is structurally unable to see (see note 1
// above), so the test watches for it directly: it turns a silent, deferred,
// audio-thread crash into a named assertion failure.
const WORKLET_ERROR_SCRIPT = `
  (function () {
    window.__bcWorkletErrors = [];
    if (typeof AudioWorkletNode === 'function') {
      var Orig = AudioWorkletNode;
      window.AudioWorkletNode = function (ctx, name, opts) {
        var node = new Orig(ctx, name, opts);
        node.addEventListener('processorerror', function (e) {
          window.__bcWorkletErrors.push(String((e && (e.message || e.type)) || 'processorerror'));
        });
        return node;
      };
      window.AudioWorkletNode.prototype = Orig.prototype;
    }
    // The worklet's source is assembled at RUNTIME and handed to the browser
    // as a data: URL, so it cannot be read by scanning the bundle's text --
    // the bundle only contains the pieces it is built from. Capturing it here
    // is the only way to assert on the source the browser actually executes,
    // which is the artifact the defect lives in.
    window.__bcWorkletSource = null;
    if (typeof AudioWorklet === 'function' && AudioWorklet.prototype.addModule) {
      var origAdd = AudioWorklet.prototype.addModule;
      AudioWorklet.prototype.addModule = function (url) {
        try {
          var marker = 'base64,';
          var at = String(url).indexOf(marker);
          if (at !== -1) window.__bcWorkletSource = atob(String(url).slice(at + marker.length));
        } catch (e) { /* leave it null; the test reports that as a failure */ }
        return origAdd.apply(this, arguments);
      };
    }
  })();
`;

async function openGuitarWithMic(t) {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-tone-'));
  const wavPath = writeToneWav(join(dir, 'g3-tone-196hz.wav'));
  const page = await launchPage(RELEASE_HTML, {
    fakeAudioFile: wavPath,
    initScript: WORKLET_ERROR_SCRIPT,
  });
  t.after(() => page.close());
  await page.evaluate("document.querySelector('#picker button[data-mod=\"gtr\"]').click()");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  return page;
}

test('release build: a microphone exercise actually receives audio (the level meter moves)', async (t) => {
  const page = await openGuitarWithMic(t);

  const deadline = Date.now() + effectiveWaitMs(8000);
  let width = '';
  while (Date.now() < deadline) {
    width = await page.evaluate("document.getElementById('micLevelFill').style.width");
    if (width && parseFloat(width) > 0) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  const errors = await page.evaluate('JSON.stringify(window.__bcWorkletErrors)');
  assert.ok(
    width && parseFloat(width) > 0,
    'the microphone level meter never moved on a guitar exercise in the RELEASE build, with a ' +
      'continuous 196 Hz tone playing into the fake microphone. That means no audio frame ever ' +
      'reached the exercise. AudioWorkletNode processorerror events seen: ' + errors,
  );
});

// The test above is the one that speaks for the user: it fails exactly when a
// learner's microphone exercise would be dead. This one says WHY, by reading
// the worklet source the browser was actually handed and checking the single
// property that broke: every helper the source calls, it also binds.
//
// Two earlier drafts of this test were measured and thrown away, which is
// worth recording because both looked reasonable:
//   - watching for a `processorerror` event PASSED against the broken build
//     (the event never reached the page), making it a gate that cannot fail
//     for the thing it gates;
//   - scanning the bundle's own text also could not work, because the source
//     is assembled at runtime -- the bundle holds the pieces, never the
//     assembled result.
const WORKLET_HELPERS = [
  'yin',
  'createOnsetDetector',
  'applyRangeMessage',
  'applyFrameSizeMessage',
  'applyGateMessage',
];

test('release build: every helper the worklet calls is also bound in the worklet source', async (t) => {
  const page = await openGuitarWithMic(t);

  const source = await page.evaluate('window.__bcWorkletSource');
  assert.ok(
    typeof source === 'string' && source.length > 0,
    'never captured the worklet source the app passed to addModule -- the app may have stopped ' +
      'using a data: URL, in which case this test needs updating, not deleting',
  );

  const missing = [];
  for (const name of WORKLET_HELPERS) {
    const referenced = new RegExp('[^A-Za-z0-9_$]' + name + '\\s*\\(').test(source);
    // Either form counts as binding it: a declaration, or an assignment to a
    // name this build controls. The fix uses the latter precisely so that
    // minification renaming the function cannot break the call site.
    const bound = new RegExp('(function\\s+' + name + '\\s*\\(|(?:const|let|var)\\s+' + name + '\\s*=)').test(source);
    if (referenced && !bound) missing.push(name);
  }
  assert.deepEqual(
    missing,
    [],
    'the worklet source calls these helpers without binding them: ' + missing.join(', ') +
      '. It is assembled as a STRING, so minification renames the definitions while any call ' +
      'site written as literal text keeps the old name. The processor then throws a ' +
      'ReferenceError on the audio thread and every microphone exercise goes dead, silently.',
  );
});
