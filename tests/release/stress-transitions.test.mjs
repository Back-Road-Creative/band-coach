// Stress: 100 rounds of start, pause, resume, stop, destination switch and
// instrument switch, as a learner does them with real clicks on the release
// file. A learner who bounces between Practice, Songs and an instrument many
// times in one sitting must not accumulate open microphone tracks, audio
// contexts, running timers or scheduled sound, nor see a stale grade.
// The fake microphone and fake MIDI keyboard are the devices; the watchers
// below only observe the browser APIs the page calls, they call no app code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort, midiNoteOn, midiNoteOff } from '../helpers/fake-midi.mjs';

const CYCLES = Number(process.env.STRESS_CYCLES) || 100;
// Heap growth allowed between round 5 (one-off start-up allocations done) and the last round, after a forced
// garbage collection. A run on the release file measured +0.4 MB over 95 rounds; a source or buffer held per
// round (about 50 KB) would add 5 MB or more.
const HEAP_GROWTH_MAX = 5 * 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Records, from outside the app: every mic track, every AudioContext, every
// timer still pending and every audio source started but not yet ended.
const WATCH = `(() => {
  const w = window.__stress = { tracks: [], gum: 0, ctxs: [], intervals: new Set(), timeouts: new Set(), live: new Set(), starts: 0 };
  const md = navigator.mediaDevices, gum = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => { w.gum++; const s = await gum(c); s.getTracks().forEach((t) => w.tracks.push(t)); return s; };
  const AC = window.AudioContext;
  window.AudioContext = class extends AC { constructor(...a) { super(...a); w.ctxs.push(this); } };
  const si = window.setInterval, ci = window.clearInterval, st = window.setTimeout, ct = window.clearTimeout;
  window.setInterval = (f, ms, ...a) => { const id = si(f, ms, ...a); w.intervals.add(id); return id; };
  window.clearInterval = (id) => { w.intervals.delete(id); return ci(id); };
  window.setTimeout = (f, ms, ...a) => { const id = st((...x) => { w.timeouts.delete(id); if (typeof f === 'function') f(...x); }, ms, ...a); w.timeouts.add(id); return id; };
  window.clearTimeout = (id) => { w.timeouts.delete(id); return ct(id); };
  for (const P of [AudioBufferSourceNode.prototype, OscillatorNode.prototype, ConstantSourceNode.prototype]) {
    const start = P.start;
    P.start = function (...a) { w.starts++; w.live.add(this); this.addEventListener('ended', () => w.live.delete(this), { once: true }); return start.apply(this, a); };
  }
})();`;

const snap = (page) => page.evaluate(`(() => { const w = window.__stress; return {
  liveTracks: w.tracks.filter((t) => t.readyState === 'live').length, gum: w.gum, ctxs: w.ctxs.length,
  intervals: w.intervals.size, timeouts: w.timeouts.size, live: w.live.size, starts: w.starts,
  prompt: document.getElementById('prompt').textContent, play: document.getElementById('playBtn').textContent.trim(),
  coach: document.getElementById('coach').textContent, breakShown: !document.getElementById('breakCard').hidden,
  endShown: !document.getElementById('endBtn').hidden }; })()`);
const heap = async (page) => {
  await page.cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await page.cdp.send('Runtime.getHeapUsage');
  return usedSize;
};
const route = (page, r) => page.clickSelector(`#mainNav button[data-route="${r}"]`);
// The instrument sheet opens from the nav button; open it only if it is shut, as a person would.
async function pick(page, mod) {
  if ((await page.evaluate("document.getElementById('navInstrument').getAttribute('aria-expanded')")) !== 'true') await route(page, 'instrument');
  await page.clickSelector(`#picker button[data-mod="${mod}"]`);
}
const PLAY = "document.getElementById('playBtn').textContent.trim()";
const started = (page) => page.waitFor(`${PLAY} === 'Pause'`);
const idle = (page) => page.waitFor(`${PLAY} === 'Start'`);

test(`${CYCLES} rounds of start, pause, resume, stop and switching leave one mic, one audio context and no stray sound`, { timeout: 1500000 }, async (t) => {
  await withAcceptancePage(t, { initScript: WATCH + FAKE_MIDI_INIT, simulated: ['fake MIDI keyboard (FAKE_MIDI_INIT)'] }, async (page) => {
    await page.grant(['microphone', 'midi']);
    await midiAddPort(page, 'kb1', 'Fake Keyboard');
    // The app keeps a few timers of its own for good (input pollers); what a leak adds shows against the quiet count.
    const quiet = async () => { await sleep(3000); return snap(page); };
    let base, heap0;
    for (let i = 0; i < CYCLES; i++) {
      const at = `round ${i + 1}: `;
      // Guitar listens through the microphone: start, pause, resume (the resume point), stop.
      await pick(page, 'gtr');
      await page.clickSelector('#playBtn');
      await started(page);
      const running = await snap(page);
      assert.equal(running.liveTracks, 1, at + 'a running guitar session has exactly one live microphone track');
      assert.equal(running.gum, i + 1, at + 'the microphone was opened once for this round, never twice');
      await page.clickSelector('#playBtn');
      await page.waitFor("!document.getElementById('breakCard').hidden");
      const paused = await snap(page);
      assert.equal(paused.play, 'Resume', at + 'paused: the one resume button is offered');
      await page.clickSelector('#backBtn');
      await page.waitFor("document.getElementById('breakCard').hidden");
      const resumed = await snap(page);
      assert.equal(resumed.play, 'Pause', at + 'resumed: the session is running again');
      assert.match(resumed.coach, /^Resuming level \d+\.$/, at + 'resume says one plain "Resuming" line, not a welcome-back burst: ' + resumed.coach);
      assert.equal(resumed.liveTracks, 1, at + 'resume did not open a second microphone track');
      await page.clickSelector('#endBtn');
      await idle(page);
      const ended = await snap(page);
      assert.equal(ended.prompt, '', at + 'stopped: no question left on screen to be graded');
      assert.equal(ended.endShown, false, at + 'stopped: the End button is gone');
      assert.match(ended.coach, /^Session ended/, at + 'stopped: the coach says the session ended: ' + ended.coach);
      assert.ok(ended.liveTracks <= 1, at + 'stopped: at most one live microphone track');
      // Ear training makes sound: start it, ask again, then walk away mid-sound. Moving to another instrument closes the mic.
      await pick(page, 'ear');
      await page.clickSelector('#playBtn');
      await started(page);
      await page.waitFor("!document.getElementById('replayBtn').hidden");
      await page.clickSelector('#replayBtn');
      const ear = await snap(page);
      assert.equal(ear.liveTracks, 0, at + 'ear training does not listen, so no microphone track stays live');
      await route(page, 'songs');
      await idle(page);
      const left = await snap(page);
      await sleep(300);
      const leftLater = await snap(page);
      assert.equal(left.prompt, '', at + 'left mid-question: the question is gone');
      assert.equal(leftLater.starts, left.starts, at + 'left mid-question: no new sound was scheduled after leaving');
      assert.equal(leftLater.coach, left.coach, at + 'left mid-question: nothing was graded after leaving');
      assert.ok(left.live <= 12, at + `left mid-question: only the sound already sent can still be playing, saw ${left.live} sources`);
      if (i % 10 === 9 || i === CYCLES - 1) await page.waitFor('window.__stress.live.size === 0', 6000).catch(() => assert.fail(at + 'sound was still playing 6 s after the learner left: ' + JSON.stringify(left)));
      // A keyboard session over MIDI, left by switching destination.
      await route(page, 'practice');
      await pick(page, 'kbd');
      if (i === 0) { await page.clickSelector('#setupBtn'); await page.clickSelector('#ioBtn'); await page.waitFor("/MIDI|keyboard/i.test(document.getElementById('ioText').textContent)"); }
      await page.clickSelector('#playBtn');
      await started(page);
      await midiNoteOn(page, 'kb1', 60); await midiNoteOff(page, 'kb1', 60);
      await route(page, 'progress');
      await idle(page);
      const kbdLeft = await snap(page);
      await route(page, 'practice');
      await sleep(250);
      const rest = await snap(page);
      assert.equal(rest.starts, kbdLeft.starts, at + 'keyboard session left: no new sound was scheduled afterwards');
      assert.equal(rest.liveTracks, 0, at + 'keyboard session: no microphone track is live');
      assert.equal(rest.ctxs, 1, at + 'one AudioContext for the whole sitting');
      assert.equal(rest.prompt, '', at + 'keyboard session left: no question left on screen');
      if (i === 0) base = await quiet();
      assert.ok(rest.intervals <= base.intervals + 4, at + `timers piling up: ${rest.intervals} intervals running, ${base.intervals} when quiet`);
      if (i === 4) heap0 = await heap(page);
    }
    // Everything the rounds started has finished; the quiet count is what it was after round 1.
    await page.waitFor("window.__stress.live.size === 0", 8000);
    const end = await quiet();
    assert.equal(end.intervals, base.intervals, `intervals after ${CYCLES} rounds equal those after the first (${base.intervals})`);
    assert.ok(end.timeouts <= base.timeouts + 1, `pending timeouts after ${CYCLES} rounds: ${end.timeouts}, after the first: ${base.timeouts}`);
    assert.equal(end.ctxs, 1, 'one AudioContext after every round');
    assert.equal(end.liveTracks, 0, 'no microphone track left live');
    assert.equal(end.live, 0, 'no audio source left playing');
    const growth = (await heap(page)) - heap0;
    t.diagnostic(`JS heap after round 5: ${heap0} bytes, after round ${CYCLES}: ${heap0 + growth} bytes (growth ${growth})`);
    assert.ok(growth < HEAP_GROWTH_MAX, `JS heap grew ${growth} bytes between round 5 and round ${CYCLES}; the limit is ${HEAP_GROWTH_MAX}`);
  });
});
