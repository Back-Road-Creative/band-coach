// Acceptance A08: a learner comes back the next day and the app knows what the
// day away did and did not prove. One launch, seven visits, each started by a
// real page reload; the saved profile and the clock (hours since the first
// check) are the declared simulation (tests/helpers/profile-seed.mjs), the keyboard is
// the declared fake. Everything else is a click or a MIDI note. page.evaluate reads
// the screen (text, button boxes; a button is scrolled into view first, as the
// driver does) and makes three declared calls into the launch script RIG_INIT
// below, which sends the fake keyboard's note-on/off bytes from inside the page
// on the app's own audio clock. It writes nothing to the app's DOM or saved state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort } from '../helpers/fake-midi.mjs';
import { HOUR, seedS1, seedS2, seedS3, seedS4, profileScheduleInit } from '../helpers/profile-seed.mjs';

// Hours after the first whole-song check: before the day is up, past it, and well past it (each at
// least an hour from a limit, so the seconds a run really takes cannot cross one).
const VISITS = [
  { offsetMs: 19 * HOUR, events: seedS1() }, // V1: too soon to recheck
  { offsetMs: 21 * HOUR, events: seedS1() }, // V2: between the two rules (20 h Progress, 24 h pathway)
  { offsetMs: 25 * HOUR, events: seedS1() }, // V3 and V4: a day later, nothing played since
  { offsetMs: 25 * HOUR }, // V4b: the app's own saved profile, from V4
  { offsetMs: 25 * HOUR, events: seedS2() }, // V5: the Mary check held up, no other song yet
  { offsetMs: 25 * HOUR, events: seedS3() }, // V5b: and Ode to Joy too
  { offsetMs: 25 * HOUR, events: seedS4() }, // V6: one pass with no MIDI behind it, nothing heard this visit
];
const BEATS = [0, 1, 2, 3, 4, 5, 6]; // Mary phrase 0, E D C D E E E, quarter notes at 100 bpm
const MIDIS = [64, 62, 60, 62, 64, 64, 64];
const BEAT_MS = 600;
const LEAD_S = 0.15 + 4 * (BEAT_MS / 1000); // click on Your turn to the first beat: the app's 0.15 s head start, then 4 count-in beats
const NICE = /^Nice\. 7 of 7 notes\./;
const LAG_OK_MS = 60; // the rig's own delivery must be this close to the plan, or the try says nothing about the app
const ATTEMPTS = 3; // tries when the RIG reports it could not deliver the plan on time (never when the app answers wrongly)
// The declared launch script (listed in options.simulated). It changes nothing the app does: it only keeps a handle to
// the app's own AudioContext and plays the fake keyboard's notes against THAT clock. Sent from the test process, or on a
// wall-clock timer, a note rides a CDP round trip or a timer a busy machine delays by 200-300 ms, and the app judges notes
// by its audio clock. __bcArm runs before the real click on Your turn and notes the audio time of that click; __bcPlay
// waits until the app is listening (the count label reads 'Notes heard'), then sends each note when the audio clock says
// so, and reports how late the rig itself was.
const RIG_INIT = `(function () {
  var Orig = window.AudioContext, made = [];
  if (!Orig) return;
  window.AudioContext = class extends Orig { constructor() { super(...arguments); made.push(this); } };
  var ctx = function () { var c = made[made.length - 1]; if (!c) throw new Error('the app has not made an AudioContext'); return c; };
  window.__bcArm = function () { var c = ctx(); window.__bcClickAt = null; document.addEventListener('click', function () { window.__bcClickAt = c.currentTime; }, { capture: true, once: true }); };
  window.__bcListening = function () { var root = document.querySelector('.panel-songs-practice'); return new Promise(function (resolve, reject) {
    var done = function () { return /^Notes heard/.test((root.querySelector('.panel-songs-count') || {}).textContent || ''); };
    var to = setTimeout(function () { reject(new Error('the count-in never ended')); }, 30000);
    if (done()) { clearTimeout(to); return resolve(); }
    var mo = new MutationObserver(function () { if (done()) { clearTimeout(to); mo.disconnect(); resolve(); } });
    mo.observe(root, { subtree: true, childList: true, characterData: true }); }); };
  // plays: [{ midi, atMs }] from the first beat; leadSec: click to first beat (null: the first beat is the moment listening begins).
  window.__bcPlay = function (plays, leadSec) { return window.__bcListening().then(function () { return new Promise(function (resolve) {
    var c = ctx(), origin = leadSec == null ? c.currentTime : window.__bcClickAt + leadSec, evs = [], i = 0, worst = 0;
    plays.forEach(function (p, k) { evs.push({ t: p.atMs, b: [0x90, p.midi, 100] }); evs.push({ t: Math.min(p.atMs + 120, plays[k + 1] ? plays[k + 1].atMs - 30 : Infinity), b: [0x80, p.midi, 0] }); });
    evs.sort(function (a, b) { return a.t - b.t; });
    var tick = function () { var now = (c.currentTime - origin) * 1000;
      while (i < evs.length && evs[i].t <= now) { worst = Math.max(worst, now - evs[i].t); window.__midiSend('p1', evs[i].b); i++; }
      if (i < evs.length) setTimeout(tick, 2); else resolve({ worstLagMs: Math.round(worst) }); };
    tick(); }); }); };
})();`;
const SIMULATED = ['fake MIDI keyboard (FAKE_MIDI_INIT)', 'AudioContext handle kept by a launch script (RIG_INIT): plays the fake keyboard on the app\'s own audio clock, changes nothing else', 'seeded profile and virtual clock per visit (profile-seed.mjs schedule)'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REC = 'button:has(+ .panel-songs-count)';
const read = (page, sel) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.trim() : null; })()`);

// Where a person would aim at the button with this text inside `scope`: the centre of its box (scrolled into view, and not covered).
async function clickByText(page, scope, text) {
  const at = await page.evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return null;
    b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
    return hit && (b === hit || b.contains(hit)) ? { x, y } : null; })()`);
  assert.ok(at, `a "${text}" button is on screen and not covered`);
  await page.click(at.x, at.y);
}
const clickButton = (page, text) => clickByText(page, '.panel-songs-practice button', text);
// The Keyboard screen the way a returning learner gets it: two steps up to level 3, and the keyboard plugged in.
async function skipAhead(page) { await page.clickSelector('#harderBtn'); await page.clickSelector('#harderBtn'); }
async function plugIn(page) {
  await midiAddPort(page, 'p1', 'Test Keys');
  await page.clickSelector('#setupBtn'); await page.clickSelector('#ioBtn');
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
}
async function visit(page, n) {
  await page.reload();
  // The visit counter is written by the new document's first script, so seeing it move proves the old page is gone.
  await page.waitFor(`window.name === 'q4b2.visit=${n}' && document.documentElement.getAttribute('data-coach-ready') === '1'`);
}
async function pathway(page) {
  await page.clickSelector('#kbdPathwayBtn');
  await page.waitFor("document.querySelector('.panel-pathway')");
  return page.evaluate(`(() => { const q = (s) => document.querySelector(s); const cur = q('li.pathway-current'), act = q('#pathwayAction');
    return { step: cur ? cur.dataset.step : null, aria: cur ? cur.getAttribute('aria-current') : null, wait: !!q('.pathway-wait'), retained: !!q('.pathway-retained'),
      transfer: !!q('.pathway-transfer'), complete: !!q('.pathway-complete'), transferDone: !!q('.pathway-transfer-done'), action: act ? act.textContent.trim() : null }; })()`);
}
async function progress(page) {
  await page.clickSelector('#mainNav button[data-route="progress"]');
  await page.waitFor("document.getElementById('historyRetention') && document.getElementById('historyRetention').textContent !== ''");
  return read(page, '#historyRetention');
}
// Both ways in (the hand-off, the pathway button) leave the lesson itself hidden (finding F3, tests/release/acceptance-song-flow.test.mjs),
// so the learner opens the song from the Songs list.
async function openMaryFromLibrary(page) {
  await page.clickSelector('details.panel-songs-library summary');
  await clickByText(page, 'li.panel-songs-row button', 'Mary Had a Little Lamb');
}
// The Songs lesson is open on Mary in Check mode: skip the listen step and play the rhythm exactly. A try the rig itself delivered
// late (it reports its worst lag against the audio clock) says nothing about the app and is made again, a few times at most; a try
// delivered on time must pass the first time.
async function passRhythm(page) {
  await page.waitFor("document.querySelector('.panel-songs-practice') && !document.querySelector('.panel-songs-practice').hidden");
  await clickButton(page, 'Next');
  const late = [];
  for (let i = 0; i < ATTEMPTS; i++) {
    await page.evaluate('window.__bcArm()');
    await page.clickSelector(REC);
    await page.waitFor("(document.querySelector('.panel-songs-count') || {}).textContent === 'Counting in…'");
    const rig = await page.evaluate(`window.__bcPlay(${JSON.stringify(MIDIS.map((m, k) => ({ midi: m, atMs: BEATS[k] * BEAT_MS })))}, ${LEAD_S})`);
    await sleep(250);
    await page.clickSelector(REC);
    await page.waitFor("document.querySelector('.panel-songs-msg') && document.querySelector('.panel-songs-msg').textContent.trim() !== ''");
    const m = await read(page, '.panel-songs-msg');
    console.log(`retention: rig worst lag ${rig.worstLagMs} ms -> ${m}`);
    if (NICE.test(m)) return;
    if (rig.worstLagMs <= LAG_OK_MS) assert.fail(`the exact rhythm, played on time (rig lag ${rig.worstLagMs} ms), did not pass: the app said "${m}"`);
    late.push(`${m} (rig lag ${rig.worstLagMs} ms)`);
  }
  assert.fail(`the rig delivered ${ATTEMPTS} of ${ATTEMPTS} tries more than ${LAG_OK_MS} ms late: ${late.join(' | ')}`);
}
// The app saves a moment after a try; wait for the new row to land before the page is left.
const saved = (page, rows) => page.waitFor(`JSON.parse(localStorage.getItem('bandcoach.v1')).events.length >= ${rows}`);

test('A08: the day away, visit by visit: waiting, a rhythm that retains by the 20 h rule, a day with nothing played, a retained check, a transfer, a pass with no MIDI behind it', async (t) => {
  const init = FAKE_MIDI_INIT + RIG_INIT + profileScheduleInit(VISITS);
  await withAcceptancePage(t, { initScript: init, simulated: SIMULATED }, async (page) => {
    // V1, 19 h after the first check: come back later; Progress holds nothing retained.
    assert.equal(await page.evaluate('window.name'), 'q4b2.visit=1');
    await skipAhead(page);
    let p = await pathway(page);
    assert.deepEqual([p.step, p.aria, p.wait, p.retained], ['return', 'step', true, false], 'V1: waiting for the day to pass');
    assert.match(await progress(page), /Retained on a later check: 0/);

    // V2, 21 h: the pathway still says wait, but a rhythm passed again 21 h after the first counts as retained in Progress.
    await visit(page, 2); await skipAhead(page); await plugIn(page);
    p = await pathway(page);
    assert.equal(p.wait, true, 'V2: still waiting (24 h rule)');
    await page.clickSelector('#mainNav button[data-route="practice"]'); // back from the pathway to the Keyboard screen
    await page.clickSelector('#kbdSongHandoff');
    await page.waitFor("document.querySelector('#songsPracticeHeading')");
    await openMaryFromLibrary(page);
    await page.clickSelector('.panel-songs-mode button[data-mode="check"]');
    await passRhythm(page);
    assert.match(await progress(page), /Retained on a later check: 1/, 'V2: Progress counts it (20 h rule)');

    // V3, 25 h, nothing played since: time alone is not retention. V4: the recheck button opens Mary in Check and a pass is logged.
    await visit(page, 3); await skipAhead(page); await plugIn(page);
    p = await pathway(page);
    assert.deepEqual([p.step, p.wait, p.retained, p.action], ['return', false, false, 'Check Mary Had a Little Lamb in Songs'], 'V3: asks for a recheck');
    await page.clickSelector('#pathwayAction');
    await page.waitFor("document.querySelector('#songsPracticeHeading')");
    assert.match(await read(page, '#songsPracticeHeading'), /Mary/, 'V4: the recheck button opens Mary');
    assert.equal(await page.evaluate("document.querySelector('.panel-songs-mode button[data-mode=\"check\"]').getAttribute('aria-pressed')"), 'true', 'V4: in Check mode');
    await openMaryFromLibrary(page);
    await page.clickSelector('.panel-songs-mode button[data-mode="check"]');
    await passRhythm(page);
    await saved(page, 4);

    // V4b: one rhythm row does not qualify as the whole-piece recheck, so the pathway still asks; Progress holds the retained rhythm.
    await visit(page, 4);
    p = await pathway(page);
    assert.deepEqual([p.step, p.retained, p.action], ['return', false, 'Check Mary Had a Little Lamb in Songs'], 'V4b: still asks for the recheck');
    assert.match(await progress(page), /Retained on a later check: 1/);

    // V5: Mary was rechecked a day later: retained, and a different song is offered for transfer.
    await visit(page, 5); await skipAhead(page);
    p = await pathway(page);
    assert.deepEqual([p.step, p.retained, p.transfer, p.action], ['return', true, true, 'Check Ode to Joy (theme) in Songs'], 'V5: transfer next');
    await page.clickSelector('#pathwayAction');
    await page.waitFor("document.querySelector('#songsPracticeHeading')");
    assert.match(await read(page, '#songsPracticeHeading'), /Ode to Joy/, 'the Songs screen opens the transfer song, not Mary');

    // V5b: Ode to Joy checked too: complete.
    await visit(page, 6);
    p = await pathway(page);
    assert.deepEqual([p.complete, p.transferDone, p.action, p.step], [true, true, null, null], 'V5b: complete, nothing left to ask');

    // V6: a pass on your own with no MIDI behind it, and no MIDI heard this visit: still asks to connect.
    await visit(page, 7);
    p = await pathway(page);
    assert.equal(p.step, 'setup', 'V6: nothing proves a MIDI keyboard, so set it up first');
    assert.match(await progress(page), /Passed on your own: 1/);
  });
});
