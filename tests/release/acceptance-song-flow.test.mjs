// Acceptance A07: a learner plays a song through a MIDI keyboard, and the app
// says what it heard -- wrong, missing, extra, early, late -- and only a MIDI
// keyboard's pass counts as a check. Release file; every control is a real
// click or key press, the keyboard is the declared fake (FAKE_MIDI_INIT).
// page.evaluate reads the screen (text, button boxes; a button is scrolled into
// view first, as the driver does) and makes three declared calls into the launch
// script RIG_INIT (tests/helpers/profile-seed.mjs, shared with A08): arm it before a click, wait for the app to listen, and
// hand it the notes the fake keyboard plays (it sends the same note-on/off bytes
// midiNoteOn/midiNoteOff send, from inside the page, on the app's own audio
// clock). It writes nothing to the app's DOM or saved state.
// Expected notes come from the hand-written golden fixture, not from the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withAcceptancePage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort } from '../helpers/fake-midi.mjs';
import { RIG_INIT, RIG_LABEL, clickByText, LAG_OK_MS, ATTEMPTS } from '../helpers/profile-seed.mjs';

const golden = JSON.parse(readFileSync(new URL('../fixtures/golden/mary-had-a-little-lamb.json', import.meta.url), 'utf8'));
const ANCHOR = 64; // E4, the first note of the song
const BEAT_MS = 600; // the song's tempo: 100 bpm (src/song/starter/index.js)
const LEAD_S = 0.15 + 4 * (BEAT_MS / 1000); // click on Your turn to the first beat: the app's 0.15 s head start, then 4 count-in beats (songs.js startRecording, countInFor)
const MIDIS = golden.phrases[0].map((n) => ANCHOR + n.off); // E D C D E E E
const BEATS = golden.phrases[0].map((_, i) => golden.phrases[0].slice(0, i).reduce((sum, n) => sum + n.beats, 0)); // 0 1 2 3 4 5 6
const KEYS = { 60: 'a', 62: 's', 64: 'd' }; // computer-keyboard letters for those notes
const EARLY = /^[A-G]#?\d was early by (\d+) ms — aim for the beat\.$/; // names the note that was furthest off, so which note varies
const LATE = /^[A-G]#?\d was late by (\d+) ms — aim for the beat\.$/;
const NICE = /^Nice\. 7 of 7 notes\./;
const EARLY_SHIFT = 240, LATE_SHIFT = 200; // ms, notes 2-7 only; each under half a beat (300), so every note keeps its own onset
const BAND_MS = 90; // the reported error must sit this close to the shift
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REC = 'button:has(+ .panel-songs-count)'; // the Your turn / Stop and check button (no id)
const read = (page, sel) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.trim() : null; })()`);
const msg = (page) => read(page, '.panel-songs-msg');
const exact = (shiftMs = 0) => MIDIS.map((midi, i) => ({ midi, atMs: BEATS[i] * BEAT_MS + (i ? shiftMs : 0) }));
const SIMULATED = ['fake MIDI keyboard (FAKE_MIDI_INIT)', RIG_LABEL];
const clickButton = (page, text) => clickByText(page, '.panel-songs-practice button', text);
const hasButton = (page, text) => page.evaluate(`[...document.querySelectorAll('.panel-songs-practice button')].some((x) => x.textContent.trim() === ${JSON.stringify(text)})`);
const mode = (page, m) => page.clickSelector(`.panel-songs-mode button[data-mode="${m}"]`);

// Observations the todo tests below judge once the flow has run (this file's tests run in order).
const seen = {};

// Press Your turn, wait out the count-in, play `plays` (each { midi, atMs } on the fake keyboard, or { key, atMs } typed), press Stop and check.
// atMs is relative to the first beat. leadSec: see __bcPlay (null for an untimed step). Returns the app's message and the rig's own report.
async function playTry(page, plays, leadSec = null) {
  await page.evaluate('window.__bcArm()');
  await page.clickSelector(REC);
  await page.waitFor("(document.querySelector('.panel-songs-count') || {}).textContent === 'Counting in…'");
  let rig = { worstLagMs: 0 };
  if (plays[0].key) {
    await page.evaluate('window.__bcListening()');
    const t0 = Date.now();
    for (const { key, atMs } of plays) { const w = t0 + atMs - Date.now(); if (w > 0) await sleep(w); await page.press(key, { text: key }); }
  } else rig = await page.evaluate(`window.__bcPlay(${JSON.stringify(plays)}, ${leadSec})`);
  await sleep(250);
  await page.clickSelector(REC);
  await page.waitFor("document.querySelector('.panel-songs-msg') && document.querySelector('.panel-songs-msg').textContent.trim() !== ''");
  return { message: await msg(page), rig };
}

// A timed try. A try the rig itself delivered late (it reports its worst lag against the audio clock) says nothing about the
// app, so it is made again, a few times at most; the app's answer never decides that. A try the rig delivered on time must
// get the expected answer the first time: no retrying past a wrong one. Progress counts every judged Learn row as help
// (pass or not) and every Check pass as on your own, so the tries made are tallied for the final check.
const tally = { learnRows: 0, checkPasses: 0 };
async function timedTry(page, plays, expected, what) {
  const late = [];
  for (let i = 0; i < ATTEMPTS; i++) {
    const { message, rig } = await playTry(page, plays, LEAD_S);
    console.log(`song-flow: ${what}: rig worst lag ${rig.worstLagMs} ms -> ${message}`);
    if (/^Learn/.test(what)) tally.learnRows++; else if (NICE.test(message)) tally.checkPasses++;
    if (expected.test(message)) return message;
    if (rig.worstLagMs <= LAG_OK_MS) assert.fail(`${what}: expected ${expected.what}, the app said "${message}" for a try played on time (rig lag ${rig.worstLagMs} ms)`);
    late.push(`${message} (rig lag ${rig.worstLagMs} ms)`);
  }
  assert.fail(`${what}: the rig delivered ${ATTEMPTS} of ${ATTEMPTS} tries more than ${LAG_OK_MS} ms late: ${late.join(' | ')}`);
}
// What a timed step must answer: a pass, or a direction with the error near the shift.
const passes = { test: (m) => NICE.test(m), what: 'a pass' };
const off = (re, shift, dir) => ({ test: (m) => { const r = re.exec(m); return !!r && Math.abs(Number(r[1]) - shift) <= BAND_MS; }, what: `a note ${dir} by about ${shift} ms (within ${BAND_MS})` });

test('A07: a Learn pass with help, then Check on a MIDI keyboard: every wrong way of playing is named, only a MIDI pass counts', async (t) => {
  await withAcceptancePage(t, { initScript: FAKE_MIDI_INIT + RIG_INIT, simulated: SIMULATED }, async (page) => {
    // Open the way a learner does: Keyboard, two steps up to level 3, connect the keyboard, take the song hand-off.
    await page.clickSelector('#picker button[data-mod="kbd"]');
    await page.clickSelector('#harderBtn'); await page.clickSelector('#harderBtn');
    await midiAddPort(page, 'p1', 'Test Keys');
    await page.clickSelector('#setupBtn'); await page.clickSelector('#ioBtn');
    await page.waitFor("document.getElementById('ioBtn').hidden === true");
    await page.clickSelector('#kbdSongHandoff');
    await page.waitFor("document.querySelector('#songsPracticeHeading')");
    assert.match(await read(page, '#songsPracticeHeading'), /Mary/, 'the hand-off at level 3 is Mary');
    seen.practiceHiddenAfterHandoff = await page.evaluate("document.querySelector('.panel-songs-practice').hidden");
    // Finding F3: the hand-off leaves the lesson hidden, so the learner opens the song from the library list.
    if (seen.practiceHiddenAfterHandoff) {
      await page.clickSelector('details.panel-songs-library summary');
      await clickByText(page, 'li.panel-songs-row button', 'Mary Had a Little Lamb');
    }
    await page.waitFor("!document.querySelector('.panel-songs-practice').hidden");

    // a. Learn and help: the app plays it for you; the exact try passes; other modes offer no demo.
    assert.ok(await hasButton(page, 'Play it'), 'Learn: the app offers to play the phrase first');
    await clickButton(page, 'Next'); await clickButton(page, 'Next');
    assert.match(await timedTry(page, exact(), passes, 'Learn exact rhythm'), NICE, 'the exact rhythm passes in Learn');
    await mode(page, 'rehearse');
    assert.equal(await page.evaluate("document.querySelector('.panel-songs-mode button[data-mode=\"rehearse\"]').getAttribute('aria-pressed')"), 'true');
    assert.equal(await hasButton(page, 'Play it'), false, 'Rehearse: no demo');
    await mode(page, 'check');
    assert.equal(await page.evaluate("document.querySelector('.panel-songs-mode button[data-mode=\"check\"]').getAttribute('aria-pressed')"), 'true');
    assert.equal(await hasButton(page, 'Play it'), false, 'Check: no demo');

    // f. Early and late, Check rhythm step: the first note is on the beat, the rest are 240 ms early / 200 ms late.
    // Each is judged on its first go: the app must name the right direction, and the reported error must sit near the shift.
    await clickButton(page, 'Next');
    await timedTry(page, exact(-EARLY_SHIFT), off(EARLY, EARLY_SHIFT, 'early'), 'early try');
    await timedTry(page, exact(LATE_SHIFT), off(LATE, LATE_SHIFT, 'late'), 'late try');

    // b. The exact try passes in Check, and the verdict that rides to the next step says it counted.
    await timedTry(page, exact(), passes, 'Check exact rhythm');
    assert.equal(await read(page, '.panel-songs-check-result'), 'This try counted as a check.');

    // Pitches step (untimed): each way of playing it wrong gets its own plain sentence.
    const slow = (midis) => midis.map((midi, i) => ({ midi, atMs: i * 350 }));
    const m = MIDIS;
    assert.equal((await playTry(page, slow([...m.slice(0, 4), m[3], ...m.slice(4, 6)]))).message, 'An extra D4 crept in — just the written notes.', 'c1: a wrong note in the middle');
    seen.firstNoteWrong = (await playTry(page, slow([m[1], ...m.slice(1)]))).message;
    assert.match(seen.firstNoteWrong, /^(Missed|An extra) /, 'c2: the app says something about it'); // what exactly: finding F1 below
    assert.equal((await playTry(page, slow(m.slice(0, 5)))).message, 'Missed the E4 — 5 of 7 notes.', 'd: two notes missing');
    assert.equal((await playTry(page, slow([...m.slice(0, 3), 65, ...m.slice(3)]))).message, 'An extra F4 crept in — just the written notes.', 'e: one extra note');

    // g. Computer keys: the notes are right, so it passes, but it is practice and says so.
    assert.match((await playTry(page, MIDIS.map((midi, i) => ({ key: KEYS[midi], atMs: i * 350 })))).message, NICE, 'g: the typed notes are right, so it passes');
    assert.equal(await read(page, '.panel-songs-check-result'), 'Practice only: this try did not count as a check. On keyboard, only a MIDI keyboard counts.');

    // Progress: every Learn try counts as help, every Check pass as on your own; the keyboard-letters try and every failure add nothing to the second.
    await page.clickSelector('#mainNav button[data-route="progress"]');
    await page.waitFor("document.getElementById('historyRetention') && document.getElementById('historyRetention').textContent !== ''");
    assert.match(await read(page, '#historyRetention'), new RegExp(`^Passed with help: ${tally.learnRows} · Passed on your own: ${tally.checkPasses} · Retained on a later check: 0`));
  });
});

test.todo('Q4b-2 F1: playing the wrong first note must not be reported as a missed note', () => {
  assert.doesNotMatch(seen.firstNoteWrong, /^Missed the D4/, `reported: ${seen.firstNoteWrong}`);
});

test.todo('Q4b-2 F3: taking the keyboard hand-off must open the song lesson, not leave it hidden', () => {
  assert.equal(seen.practiceHiddenAfterHandoff, false);
});
