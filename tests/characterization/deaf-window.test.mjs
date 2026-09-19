// F5: while the app plays its own reference tone, the microphone must not
// be credited for hearing it. The deaf window (src/audio/deaf-window.js)
// opens whenever the app starts an oscillator (src/app.js `tone()`/`click()`)
// and the mic-processing loop (`onPitch`, src/app.js) drops everything while
// it is open.
//
// NOTE on mode choice: the brief for this unit named kbd/gtr as candidate
// modes, but neither actually plays an app-generated reference tone in the
// current app.js — kbd's `input: 'midi'` path never touches the mic at all
// (src/app.js tone() calls at the on-screen/computer-key handlers are the
// PLAYER's own key press, not a reference), and gtr's `input: 'pluck'` path
// has no reference-tone call anywhere in app.js (grepped for every `tone(`
// call site; none is conditioned on mod === 'gtr'). The mode that actually
// exercises F5 is 'voice' (input: 'sustain', mic-based): starting a
// ref: 'target' task auto-plays the target note via playRef() -> tone()
// (src/app.js, the `present()` -> `playRef()` chain, `mod === 'voice'`
// branch), which is exactly the "example / reference tone through the
// speakers while the mic listens" scenario this unit fixes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;
const mfreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

test('the mic is deaf to the app\'s own reference tone, then hears again once the window closes', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('voice')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  // Level 1 is `ref: 'target'`: present() calls playRef(), which plays the
  // target note through tone() the instant the task starts.
  const midi = await page.evaluate('window.__coach.cur().info.midi');
  const freq = mfreq(midi);

  // The reference tone's own tone() call should already have opened the
  // deaf window by the time the task exists.
  const deafAtStart = await page.evaluate('window.__coach.deaf()');
  assert.equal(deafAtStart, true, 'starting the task plays its reference tone, which should open the deaf window');

  // Feed the SAME pitch the reference tone is playing through the test
  // pitch-detection hook, standing in for the mic hearing the speakers.
  await page.evaluate(`window.__coach.testSource([${freq}])`);

  // While still inside the deaf window, keep feeding the tone and confirm
  // it is never credited.
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(await page.evaluate('window.__coach.deaf()'), true, 'reference tone plus its tail should still be open 400ms in');
  assert.notEqual(
    await page.evaluate("document.getElementById('feedback').className"),
    'ok',
    'the tone must not be credited while the deaf window is open'
  );
  assert.equal(await page.evaluate('window.__coach.task().idx'), 0, 'no element advanced while deaf');

  // Wait for the window to close (poll, no bare sleep past this point).
  await page.waitFor('!window.__coach.deaf()', 5000);

  // The SAME tone, still being fed continuously, must now be credited.
  await page.waitFor("document.getElementById('feedback').className === 'ok'", 5000);
});

test('computer-key input is never gated by the deaf window, even though it also plays a tone', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  // Level 1 pool is C/D/E (60/62/64); PCKEYS (src/app.js:580) maps them to a/s/d.
  const keyMap = { 60: 'a', 62: 's', 64: 'd' };
  const midi = await page.evaluate('window.__coach.cur().info.midi');
  const key = keyMap[midi];
  assert.ok(key, `level-1 kbd target ${midi} should be one of C/D/E`);

  // A real computer-key press goes through the SAME handler that plays a
  // tone (src/app.js:581, `tone(...); onNote(...)`), so the deaf window
  // does open here too. But onNote() is called directly, not through the
  // mic loop, so the answer must still be credited immediately.
  await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}' }))`);
  await page.waitFor("document.getElementById('feedback').className === 'ok'", 2000);

  assert.equal(await page.evaluate('window.__coach.deaf()'), true, 'the key press also played a tone, which opens the deaf window as a side effect');
});
