// Stress: 100 rounds of start, pause, resume, stop, loop, destination switch and
// instrument switch, as a learner does them with real clicks on the release
// file. A learner who bounces between Practice, Songs, Play along and an
// instrument many times in one sitting must not accumulate open microphone
// tracks, audio contexts, running timers or scheduled sound, nor see a stale grade.
// The fake microphone and fake MIDI keyboard are the devices; the watchers
// below only observe the browser APIs the page calls, they call no app code.
//
// What each round proves, and the break that turns it red (each was run):
//  - a live microphone track after ear training / the keyboard: setMod's track stop dropped;
//  - intervals above the quiet count, or unequal at the end: the mono-route clearInterval dropped, or Songs'
//    listening interval left running;
//  - a count-in still pending after leaving Songs, a loop still sounding after Stop or after leaving Play along:
//    stopRecording's clearTimeout / playalong's stopLoop dropped;
//  - a session that goes on after a destination switch: the endSession call in the destination switch dropped.
// Timeouts: the only long-lived timeout a round starts is Songs' count-in; the "no count-in pending" check below
// carries that rule. A pending-timeout count at the end could not be made to fail by any break the rounds reach, so
// there is none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withAcceptancePage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort, midiNoteOn, midiNoteOff } from '../helpers/fake-midi.mjs';
import { chooseFile } from '../helpers/file-chooser.mjs';
import { clickByText } from '../helpers/profile-seed.mjs';
import { pluck, writePluckWav } from '../helpers/pluck-wav.mjs';

// CI runs 25 rounds: the full 100 take about 9 min on the shared runner, which would push the 30 min CI job to its
// limit. Every per-round check still runs each round; only the heap trend has fewer rounds behind it.
const CYCLES = Number(process.env.STRESS_CYCLES) || (process.env.CI ? 25 : 100);
// Heap growth allowed between the baseline round (one-off start-up allocations done) and the last round, after a
// forced garbage collection. A run on the release file measured +0.4 MB over 95 rounds; a source or buffer held per
// round (about 50 KB) would add 5 MB or more.
const HEAP_GROWTH_MAX = 5 * 1024 * 1024;
const HEAP_BASE_ROUND = Math.min(4, CYCLES - 1); // zero-based: after round 5 of a full run, the last round of a short one
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A count-in is four beats at the song's tempo (about 2.4 s); no other timeout a round starts lasts this long.
const COUNT_IN_MIN_MS = 1500;

// The recording Play along loops: three plucked notes, 1.2 s, written to a temp dir at run time.
const dir = mkdtempSync(join(tmpdir(), 'bc-stress-'));
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ } });
const SR = 22050;
const notes = [60, 64, 67].map((m) => pluck(440 * 2 ** ((m - 69) / 12), SR, 0.4, {}));
const pcm = new Float32Array(notes.reduce((n, p) => n + p.length, 0));
notes.reduce((at, p) => { pcm.set(p, at); return at + p.length; }, 0);
const RECORDING = writePluckWav(join(dir, 'stress-loop.wav'), pcm, SR);

// Records, from outside the app: every mic track, every AudioContext, every
// timer still pending (with its delay) and every audio source started but not yet ended.
const WATCH = `(() => {
  const w = window.__stress = { tracks: [], gum: 0, ctxs: [], intervals: new Set(), timeouts: new Map(), live: new Set(), starts: 0, loop: null, errors: [], click: '', down: '', up: '' };
  addEventListener('error', (e) => w.errors.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => w.errors.push('rejected: ' + String(e.reason)));
  // The element the last real click reached, so a click that did nothing says where it went.
  const who = (e) => { const t = e.target; return t && t.tagName ? t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') : String(t); };
  addEventListener('click', (e) => { w.click = who(e); }, true);
  // Press and release are kept apart: a button that moved between the two gets a press and a release on different elements and no click.
  addEventListener('mousedown', (e) => { w.down = who(e); }, true);
  addEventListener('mouseup', (e) => { w.up = who(e); }, true);
  const md = navigator.mediaDevices, gum = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => { w.gum++; const s = await gum(c); s.getTracks().forEach((t) => w.tracks.push(t)); return s; };
  const AC = window.AudioContext;
  window.AudioContext = class extends AC { constructor(...a) { super(...a); w.ctxs.push(this); } };
  const si = window.setInterval, ci = window.clearInterval, st = window.setTimeout, ct = window.clearTimeout;
  window.setInterval = (f, ms, ...a) => { const id = si(f, ms, ...a); w.intervals.add(id); return id; };
  window.clearInterval = (id) => { w.intervals.delete(id); return ci(id); };
  window.setTimeout = (f, ms, ...a) => { const id = st((...x) => { w.timeouts.delete(id); if (typeof f === 'function') f(...x); }, ms, ...a); w.timeouts.set(id, ms || 0); return id; };
  window.clearTimeout = (id) => { w.timeouts.delete(id); return ct(id); };
  for (const P of [AudioBufferSourceNode.prototype, OscillatorNode.prototype, ConstantSourceNode.prototype]) {
    const start = P.start;
    P.start = function (...a) {
      w.starts++; w.live.add(this); this.__when = a[0] || 0;
      // Only the latest looping source is kept (its start time, loop length and whether it has ended).
      if (this.loop) w.loop = { src: this, when: a[0] || 0, dur: this.buffer.duration, ended: false };
      this.addEventListener('ended', () => { w.live.delete(this); if (w.loop && w.loop.src === this) w.loop.ended = true; }, { once: true });
      return start.apply(this, a);
    };
    // The earliest time a stop was asked for: a stop at or before the start time cancels the sound.
    const stop = P.stop;
    P.stop = function (...a) { const at = a[0] || 0; this.__stopAt = this.__stopAt === undefined ? at : Math.min(this.__stopAt, at); return stop.apply(this, a); };
  }
  // Sound still queued: started (scheduled) for a time that has not come, and not cancelled by a stop.
  w.queued = () => { const now = w.ctxs[0] ? w.ctxs[0].currentTime : 0; return [...w.live].filter((s) => s.__when > now && !(s.__stopAt !== undefined && s.__stopAt <= s.__when)).length; };
})();`;

const snap = (page) => page.evaluate(`(() => { const w = window.__stress; return {
  liveTracks: w.tracks.filter((t) => t.readyState === 'live').length, gum: w.gum, ctxs: w.ctxs.length,
  intervals: w.intervals.size, timeouts: w.timeouts.size, countIns: [...w.timeouts.values()].filter((ms) => ms >= ${COUNT_IN_MIN_MS}).length,
  live: w.live.size, queued: w.queued(), starts: w.starts, loopEnded: w.loop ? w.loop.ended : null,
  prompt: document.getElementById('prompt').textContent, play: document.getElementById('playBtn').textContent.trim(),
  coach: document.getElementById('coach').textContent, breakShown: !document.getElementById('breakCard').hidden,
  endShown: !document.getElementById('endBtn').hidden, errors: w.errors.slice(-3), lastClick: w.click, lastDown: w.down, lastUp: w.up }; })()`);
const heap = async (page) => {
  await page.cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await page.cdp.send('Runtime.getHeapUsage');
  return usedSize;
};
// A person aims at a control that has stopped moving. On a loaded box the page can still be laying out (a panel closing, the
// sheet shutting) when the driver reads a control's position, and the click then lands where the control was; two frames
// with the same box and scroll position mean it is there to be clicked. The click itself is the driver's real mouse.
async function settled(page, selector) {
  const box = `(new Promise((done) => { const at = () => { const e = document.querySelector(${JSON.stringify(selector)}), b = e && e.getBoundingClientRect(); return b ? [b.x, b.y, b.width, b.height, scrollX, scrollY].join() : 'none'; }; const first = at(), cap = setTimeout(() => done('none|none'), 1000); setTimeout(() => requestAnimationFrame(() => { clearTimeout(cap); done(first + '|' + at()); }), 30); }))`;
  for (let n = 0; n < 100; n++) { const [a, b] = (await page.evaluate(box)).split('|'); if (a === b && a !== 'none') break; await sleep(30); }
}
async function tap(page, selector) { await settled(page, selector); await page.clickSelector(selector); }
const route = (page, r) => tap(page, `#mainNav button[data-route="${r}"]`);
// The instrument sheet opens from the nav button; open it only if it is shut, as a person would.
async function pick(page, mod) {
  if ((await page.evaluate("document.getElementById('navInstrument').getAttribute('aria-expanded')")) !== 'true') await route(page, 'instrument');
  await tap(page, `#picker button[data-mod="${mod}"]`);
}
const PLAY = "document.getElementById('playBtn').textContent.trim()";
// Waits that say, by name, what the app failed to do when they time out (a bare waitFor says only "timed out").
const named = (page, expr, what) => page.waitFor(expr).catch(async () => assert.fail(`${what}: ${JSON.stringify(await snap(page))}`));
// Click `selector`, then look for `expr` for up to `ms`; a click that did nothing (and left no page error) is made again, up to
// `tries` times in all, as a person presses a button that did not seem to take. Every repeat is counted in `redone`, and said at the
// end of the run, so a click that is lost again and again cannot hide: the run fails past `redone.max`.
const redone = { n: 0, max: 5, log: [] };
async function tapUntil(page, selector, expr, what, { ms = 4000, tries = 3 } = {}) {
  for (let k = 1; ; k++) {
    await page.evaluate("Object.assign(window.__stress, { click: '', down: '', up: '' })");
    await tap(page, selector);
    for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (await page.evaluate(`Boolean(${expr})`)) return;
    const s = await snap(page);
    if (s.errors.length || k >= tries) assert.fail(`${what} (click ${k} of ${tries}, last press on ${s.lastDown || 'nothing'}, release on ${s.lastUp || 'nothing'}, click on ${s.lastClick || 'nothing'}): ${JSON.stringify(s)}`);
    redone.log.push(`${what}: press on ${s.lastDown || 'nothing'}, release on ${s.lastUp || 'nothing'}, click on ${s.lastClick || 'nothing'}`);
    assert.ok(++redone.n <= redone.max, `${what}: ${redone.n} clicks had to be made again in this run, the limit is ${redone.max}: ${JSON.stringify(s)}`);
  }
}
const idle = (page, what) => named(page, `${PLAY} === 'Start'`, what);
// True once every audio source has ended, polled for at most `ms` (the page wait floor would stretch a waitFor).
async function drains(page, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if ((await page.evaluate('window.__stress.live.size')) === 0) return true;
  return (await page.evaluate('window.__stress.live.size')) === 0;
}
// True once the latest looping source has ended, polled for at most `ms`.
async function loopStops(page, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if ((await page.evaluate('window.__stress.loop.ended')) === true) return true;
  return (await page.evaluate('window.__stress.loop.ended')) === true;
}
// Open a recording through the real file chooser. A label click that opened no chooser is made again, within the same budget.
async function openRecording(page, at) {
  for (let k = 1; ; k++) {
    await settled(page, 'label[for="paFileInput"]');
    await page.evaluate("Object.assign(window.__stress, { click: '', down: '', up: '' })");
    try { await chooseFile(page, 'label[for="paFileInput"]', RECORDING); return; } catch (e) {
      const s = await snap(page);
      if (!/opened no file chooser/.test(e.message) || s.errors.length || k >= 3) assert.fail(`${at}Open a recording: ${e.message} (try ${k} of 3, last press on ${s.lastDown || 'nothing'}, release on ${s.lastUp || 'nothing'}, click on ${s.lastClick || 'nothing'}): ${JSON.stringify(s)}`);
      redone.log.push(`${at}Open a recording: ${e.message}; press on ${s.lastDown || 'nothing'}, release on ${s.lastUp || 'nothing'}, click on ${s.lastClick || 'nothing'}`);
      assert.ok(++redone.n <= redone.max, `${at}Open a recording: ${redone.n} clicks had to be made again in this run, the limit is ${redone.max}: ${JSON.stringify(s)}`);
    }
  }
}
const YOUR_TURN = 'button:has(+ .panel-songs-count)'; // the Your turn / Stop and check button (it has no id)
const PA_PLAY = "document.getElementById('paPlayBtn').textContent.trim()";
// The loop has started and wrapped at least once: the audio clock is past its start plus one full pass.
const WRAPPED = "(() => { const w = window.__stress, l = w.loop; return !!l && !l.ended && w.ctxs[0].currentTime > l.when + l.dur + 0.1; })()";

test(`${CYCLES} rounds of start, pause, resume, stop, loop and switching leave one mic, one audio context and no stray sound`, { timeout: 1500000 }, async (t) => {
  await withAcceptancePage(t, { initScript: WATCH + FAKE_MIDI_INIT, simulated: ['fake MIDI keyboard (FAKE_MIDI_INIT)'] }, async (page) => {
    await page.grant(['microphone', 'midi']);
    await midiAddPort(page, 'kb1', 'Fake Keyboard');
    // The app keeps a few timers of its own for good (input pollers); what a leak adds shows against the quiet count.
    const quiet = async () => { await sleep(3000); return snap(page); };
    let base, heap0, heapRound = 0, queuedAtLeave = 0;
    for (let i = 0; i < CYCLES; i++) {
      const at = `round ${i + 1}: `;
      try {
        // Guitar listens through the microphone: start, pause, resume (the resume point), stop.
        await pick(page, 'gtr');
        await tapUntil(page, '#playBtn', `${PLAY} === 'Pause'`, at + 'the guitar session did not start', { ms: 15000 });
        const running = await snap(page);
        assert.equal(running.liveTracks, 1, at + 'a running guitar session has exactly one live microphone track');
        assert.equal(running.gum, i + 1, at + 'the microphone was opened once for this round, never twice');
        await tap(page, '#playBtn');
        await named(page, "!document.getElementById('breakCard').hidden", at + 'Pause did not offer the break card');
        const paused = await snap(page);
        assert.equal(paused.play, 'Resume', at + 'paused: the one resume button is offered');
        await tap(page, '#backBtn');
        await named(page, "document.getElementById('breakCard').hidden", at + 'Resume did not close the break card');
        const resumed = await snap(page);
        assert.equal(resumed.play, 'Pause', at + 'resumed: the session is running again');
        assert.match(resumed.coach, /^Resuming level \d+\.$/, at + 'resume says one plain "Resuming" line, not a welcome-back burst: ' + resumed.coach);
        assert.equal(resumed.liveTracks, 1, at + 'resume did not open a second microphone track');
        await tap(page, '#endBtn');
        await idle(page, at + 'End did not stop the guitar session');
        const ended = await snap(page);
        assert.equal(ended.prompt, '', at + 'stopped: no question left on screen to be graded');
        assert.equal(ended.endShown, false, at + 'stopped: the End button is gone');
        assert.match(ended.coach, /^Session ended/, at + 'stopped: the coach says the session ended: ' + ended.coach);
        assert.ok(ended.liveTracks <= 1, at + 'stopped: at most one live microphone track');
        // Songs (the guitar is still the instrument): open a song, start its count-in and leave mid count-in for Play along; loop a recording, let the loop
        // wrap, stop it, loop again and leave by switching destination mid-loop.
        await route(page, 'songs');
        await clickByText(page, '#panelHost button', 'Mary Had a Little Lamb');
        // The song opens where the learner left it: step on past the listen and demo screens until Your turn is offered.
        for (let n = 0; n < 3 && !(await page.evaluate(`!!document.querySelector(${JSON.stringify(YOUR_TURN)})`)); n++) await clickByText(page, '.panel-songs-practice button', 'Next');
        await tap(page, YOUR_TURN);
        await named(page, "(document.querySelector('.panel-songs-count') || {}).textContent === 'Counting in…'", at + 'Your turn did not start a count-in');
        const counting = await snap(page);
        assert.equal(counting.countIns, 1, at + `Your turn starts exactly one count-in, saw ${counting.countIns}`);
        await tap(page, '.panel-songs-action-playalong');
        await named(page, "document.getElementById('paPlayBtn')", at + 'Play along did not open');
        const pa = await snap(page);
        assert.equal(pa.countIns, 0, at + 'left Songs mid count-in: the count-in was still pending in Play along');
        await openRecording(page, at);
        await named(page, "!document.getElementById('paResults').hidden", at + 'Play along did not show the recording it was given');
        // The first round picks a short loop (the playhead is mid-recording); later rounds get it back as "Last time" does.
        if (i === 0) { await tap(page, '#paPlayhead'); await tap(page, '#paSetEnd'); }
        await tap(page, '#paCountIn');
        await tap(page, '#paPlayBtn');
        await named(page, `${PA_PLAY} === 'Stop' && ${WRAPPED}`, at + 'the Play along loop did not start and wrap');
        const looping = await snap(page);
        assert.equal(looping.ctxs, 1, at + 'looping: still one AudioContext');
        await tap(page, '#paPlayBtn');
        assert.equal(await page.evaluate(PA_PLAY), 'Play loop', at + 'stopped the loop: the button offers Play loop again');
        assert.ok(await loopStops(page, 3000), at + 'Stop: the loop kept playing 3 s after the learner stopped it');
        const stopped = await snap(page);
        await sleep(250);
        assert.equal((await snap(page)).starts, stopped.starts, at + 'Stop: no new sound was scheduled after the loop was stopped');
        await tap(page, '#paPlayBtn');
        await named(page, `${PA_PLAY} === 'Stop' && !window.__stress.loop.ended`, at + 'the second loop did not start');
        await route(page, 'progress');
        assert.ok(await loopStops(page, 3000), at + 'left Play along mid-loop: the loop kept playing 3 s after the learner left');
        const paLeft = await snap(page);
        await sleep(250);
        assert.equal((await snap(page)).starts, paLeft.starts, at + 'left Play along: no new sound was scheduled afterwards');
        // Ear training makes sound: start it, ask again, then walk away mid-sound. Moving to another instrument closes the mic.
        await pick(page, 'ear');
        await tapUntil(page, '#playBtn', `${PLAY} === 'Pause'`, at + 'the ear training session did not start');
        await named(page, "!document.getElementById('replayBtn').hidden", at + 'ear training did not offer Hear it again');
        await tap(page, '#replayBtn');
        const ear = await snap(page);
        assert.equal(ear.liveTracks, 0, at + 'ear training does not listen, so no microphone track stays live');
        queuedAtLeave += ear.queued;
        await route(page, 'songs');
        await idle(page, at + 'leaving ear training for Songs did not end the session');
        const left = await snap(page);
        await sleep(300);
        const leftLater = await snap(page);
        assert.equal(left.prompt, '', at + 'left mid-question: the question is gone');
        // Leaving promises silence to come: nothing new is scheduled and no note still queued (ear training's second tone,
        // 0.75 s after the first) is left to sound. A note already sounding plays out its few hundred milliseconds, so
        // the count of live sources is bounded.
        assert.equal(leftLater.starts, left.starts, at + 'left mid-question: no new sound was scheduled after leaving');
        assert.equal(left.queued, 0, at + `left mid-question: ${left.queued} note(s) still queued to sound after the learner left (${ear.queued} were queued just before)`);
        assert.equal(leftLater.coach, left.coach, at + 'left mid-question: nothing was graded after leaving');
        assert.ok(left.live <= 12, at + `left mid-question: only the sound already sent can still be playing, saw ${left.live} sources`);
        if (i % 10 === 9 || i === CYCLES - 1) assert.ok(await drains(page, 6000), at + 'left mid-question: sound was still playing 6 s after the learner left: ' + JSON.stringify(await snap(page)));
        // A keyboard session over MIDI, left by switching destination.
        await route(page, 'practice');
        await pick(page, 'kbd');
        if (i === 0) { await tap(page, '#setupBtn'); await tap(page, '#ioBtn'); await named(page, "/MIDI|keyboard/i.test(document.getElementById('ioText').textContent)", at + 'the input panel did not name the fake keyboard'); }
        await tapUntil(page, '#playBtn', `${PLAY} === 'Pause'`, at + 'the keyboard session did not start');
        await midiNoteOn(page, 'kb1', 60); await midiNoteOff(page, 'kb1', 60);
        await route(page, 'progress');
        await idle(page, at + 'leaving the keyboard session for Progress did not end it');
        const kbdLeft = await snap(page);
        await route(page, 'practice');
        await sleep(250);
        const rest = await snap(page);
        assert.equal(rest.starts, kbdLeft.starts, at + 'keyboard session left: no new sound was scheduled afterwards');
        assert.equal(rest.liveTracks, 0, at + 'keyboard session: no microphone track is live');
        assert.equal(rest.ctxs, 1, at + 'one AudioContext for the whole sitting');
        assert.equal(rest.prompt, '', at + 'keyboard session left: no question left on screen');
        assert.equal(rest.countIns, 0, at + 'no Songs count-in is left pending');
        if (i === 0) base = await quiet();
        assert.ok(rest.intervals <= base.intervals + 4, at + `timers piling up: ${rest.intervals} intervals running, ${base.intervals} when quiet`);
        if (i === HEAP_BASE_ROUND) { heap0 = await heap(page); heapRound = i + 1; }
      } catch (e) {
        // Any step that failed without naming its round (a click that found nothing to press, say) is named here, with what the page showed.
        if (e.message.startsWith(at) || /round \d+: /.test(e.message)) throw e;
        assert.fail(`${at}${e.message}: ${JSON.stringify(await snap(page).catch(() => null))}`);
      }
    }
    // The check above can only fail in a round where a note was queued when the learner left; across a full run some were.
    if (CYCLES >= 10) assert.ok(queuedAtLeave > 0, 'no round had a note queued when the learner left ear training, so "no queued note after leaving" was never tested');
    t.diagnostic(`clicks made again because the first did nothing (limit ${redone.max}): ${redone.n}${redone.log.map((l) => '\n#   ' + l).join('')}`);
    t.diagnostic(`notes queued at the moment of leaving ear training, summed over ${CYCLES} rounds: ${queuedAtLeave}`);
    // Everything the rounds started has finished; the quiet count is what it was after round 1.
    assert.ok(await drains(page, 8000), 'no audio source left playing after the last round: ' + JSON.stringify(await snap(page)));
    const end = await quiet();
    assert.equal(end.intervals, base.intervals, `intervals after ${CYCLES} rounds equal those after the first (${base.intervals})`);
    assert.equal(end.ctxs, 1, 'one AudioContext after every round');
    assert.equal(end.liveTracks, 0, 'no microphone track left live');
    assert.equal(end.live, 0, 'no audio source left playing');
    const growth = (await heap(page)) - heap0;
    t.diagnostic(`JS heap after round ${heapRound}: ${heap0} bytes, after round ${CYCLES}: ${heap0 + growth} bytes (growth ${growth})`);
    assert.ok(growth < HEAP_GROWTH_MAX, `JS heap grew ${growth} bytes between round ${heapRound} and round ${CYCLES}; the limit is ${HEAP_GROWTH_MAX}`);
  });
});
