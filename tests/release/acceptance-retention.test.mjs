// Acceptance A08: a learner comes back the next day and the app knows what the
// day away did and did not prove. One launch, seven visits, each started by a
// real page reload; the saved profile and the clock (hours since the first
// check) are the declared simulation (tests/helpers/profile-seed.mjs), the keyboard is
// the declared fake. Everything else is a click or a MIDI note. evaluate only reads.
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
const NICE = /^Nice\. 7 of 7 notes\./;
const ATTEMPTS = 6; // fresh tries allowed per timed step (measured: a busy box drops 1 in 3 attempts; a wrong app fails all of them)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REC = 'button:has(+ .panel-songs-count)';
const read = (page, sel) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.trim() : null; })()`);

async function clickButton(page, text) {
  const ok = await page.evaluate(`(() => { const b = [...document.querySelectorAll('.panel-songs-practice button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (b) b.setAttribute('data-q4b2', 'x'); return !!b; })()`);
  assert.ok(ok, `a "${text}" button is on screen`);
  await page.clickSelector('[data-q4b2="x"]');
  await page.evaluate("document.querySelectorAll('[data-q4b2]').forEach((b) => b.removeAttribute('data-q4b2'))");
}
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
  await page.evaluate("[...document.querySelectorAll('li.panel-songs-row button')].find((b) => b.textContent === 'Mary Had a Little Lamb').setAttribute('data-q4b2', 'x')");
  await page.clickSelector('[data-q4b2="x"]');
}
// The Songs lesson is open on Mary in Check mode: skip the listen step and play the rhythm exactly (a fresh try if a busy machine lands it a beat off).
async function passRhythm(page) {
  await page.waitFor("document.querySelector('.panel-songs-practice') && !document.querySelector('.panel-songs-practice').hidden");
  await clickButton(page, 'Next');
  const tried = [];
  for (let i = 0; i < ATTEMPTS; i++) {
    await page.clickSelector(REC);
    await page.waitFor("(document.querySelector('.panel-songs-count') || {}).textContent === 'Counting in…'");
    // The fake keyboard plays the phrase on a timer inside the page, started in the task that sees the count-in end
    // (sent from here, each note rode a CDP round trip that a busy machine delayed by up to 290 ms).
    await page.evaluate(`new Promise((resolve, reject) => { const root = document.querySelector('.panel-songs-practice'), notes = ${JSON.stringify(MIDIS.map((m, k) => [m, BEATS[k] * BEAT_MS]))};
      const done = () => /^Notes heard/.test((root.querySelector('.panel-songs-count') || {}).textContent || '');
      const start = () => { const t0 = performance.now(); notes.forEach(([m, at]) => { setTimeout(() => window.__midiSend('p1', [0x90, m, 100]), t0 + at - performance.now()); setTimeout(() => window.__midiSend('p1', [0x80, m, 0]), t0 + at + 120 - performance.now()); }); setTimeout(resolve, notes[notes.length - 1][1] + 200); };
      const to = setTimeout(() => reject(new Error('the count-in never ended')), 30000);
      if (done()) { clearTimeout(to); return start(); }
      const mo = new MutationObserver(() => { if (done()) { clearTimeout(to); mo.disconnect(); start(); } });
      mo.observe(root, { subtree: true, childList: true, characterData: true }); })`);
    await sleep(250);
    await page.clickSelector(REC);
    await page.waitFor("document.querySelector('.panel-songs-msg') && document.querySelector('.panel-songs-msg').textContent.trim() !== ''");
    const m = await read(page, '.panel-songs-msg');
    if (NICE.test(m)) return;
    tried.push(m); console.warn(`retention: rhythm try discarded (${m})`);
  }
  assert.fail(`the exact rhythm did not pass in ${ATTEMPTS} tries: ${tried.join(' | ')}`);
}
// The app saves a moment after a try; wait for the new row to land before the page is left.
const saved = (page, rows) => page.waitFor(`JSON.parse(localStorage.getItem('bandcoach.v1')).events.length >= ${rows}`);

test('A08: the day away, visit by visit: waiting, a rhythm that retains by the 20 h rule, a day with nothing played, a retained check, a transfer, a pass with no MIDI behind it', async (t) => {
  const init = FAKE_MIDI_INIT + profileScheduleInit(VISITS);
  await withAcceptancePage(t, { initScript: init, simulated: ['fake MIDI keyboard (FAKE_MIDI_INIT)', 'seeded profile and virtual clock per visit (profile-seed.mjs schedule)'] }, async (page) => {
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
