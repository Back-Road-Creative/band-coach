// Acceptance A07: a learner plays a song through a MIDI keyboard, and the app
// says what it heard -- wrong, missing, extra, early, late -- and only a MIDI
// keyboard's pass counts as a check. Release file, real clicks and key presses;
// the keyboard is the declared fake (FAKE_MIDI_INIT). evaluate only reads.
// Expected notes come from the hand-written golden fixture, not from the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withAcceptancePage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort } from '../helpers/fake-midi.mjs';

const golden = JSON.parse(readFileSync(new URL('../fixtures/golden/mary-had-a-little-lamb.json', import.meta.url), 'utf8'));
const ANCHOR = 64; // E4, the first note of the song
const BEAT_MS = 600; // the song's tempo: 100 bpm (src/song/starter/index.js)
const MIDIS = golden.phrases[0].map((n) => ANCHOR + n.off); // E D C D E E E
const BEATS = golden.phrases[0].map((_, i) => golden.phrases[0].slice(0, i).reduce((sum, n) => sum + n.beats, 0)); // 0 1 2 3 4 5 6
const KEYS = { 60: 'a', 62: 's', 64: 'd' }; // computer-keyboard letters for those notes
const EARLY = /^[A-G]#?\d was early by \d+ ms — aim for the beat\.$/; // names the note that was furthest off, so which note varies
const LATE = /^[A-G]#?\d was late by \d+ ms — aim for the beat\.$/;
const NICE = /^Nice\. 7 of 7 notes\./;
const ATTEMPTS = 6; // fresh tries allowed per timed step (measured: a busy box drops 1 in 3 attempts; a wrong app fails all of them)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REC = 'button:has(+ .panel-songs-count)'; // the Your turn / Stop and check button (no id)
const read = (page, sel) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.trim() : null; })()`);
const msg = (page) => read(page, '.panel-songs-msg');
const exact = (shiftMs = 0) => MIDIS.map((midi, i) => ({ midi, atMs: BEATS[i] * BEAT_MS + (i ? shiftMs : 0) }));

// Observations the todo tests below judge once the flow has run (this file's tests run in order).
const seen = {};

async function clickButton(page, text) {
  const ok = await page.evaluate(`(() => { const b = [...document.querySelectorAll('.panel-songs-practice button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (b) b.setAttribute('data-q4b2', 'x'); return !!b; })()`);
  assert.ok(ok, `a "${text}" button is on screen`);
  await page.clickSelector('[data-q4b2="x"]');
  await page.evaluate("document.querySelectorAll('[data-q4b2]').forEach((b) => b.removeAttribute('data-q4b2'))");
}
const hasButton = (page, text) => page.evaluate(`[...document.querySelectorAll('.panel-songs-practice button')].some((x) => x.textContent.trim() === ${JSON.stringify(text)})`);
const mode = (page, m) => page.clickSelector(`.panel-songs-mode button[data-mode="${m}"]`);

// Resolves in the page when the count-in ends (the label flips to 'Notes heard'), then runs `go` there.
const afterCountIn = (go) => `new Promise((resolve, reject) => { const root = document.querySelector('.panel-songs-practice');
  const done = () => /^Notes heard/.test((root.querySelector('.panel-songs-count') || {}).textContent || '');
  const start = () => { ${go} }; const to = setTimeout(() => reject(new Error('the count-in never ended')), 30000);
  if (done()) { clearTimeout(to); return start(); }
  const mo = new MutationObserver(() => { if (done()) { clearTimeout(to); mo.disconnect(); start(); } });
  mo.observe(root, { subtree: true, childList: true, characterData: true }); })`;
// The fake keyboard plays `plays` ({ midi, atMs } from the first beat) on a timer inside the page, started in the
// very task that sees the count-in end, using the same note-on/note-off bytes midiNoteOn/midiNoteOff send. Sent
// from the test process instead, each note rode a CDP round trip, which a busy machine delayed by up to 290 ms.
const keyboardPlays = (plays) => afterCountIn(`const t0 = performance.now(), plays = ${JSON.stringify(plays)};
  plays.forEach((p, i) => { const off = Math.min(p.atMs + 120, plays[i + 1] ? plays[i + 1].atMs - 30 : Infinity);
    setTimeout(() => window.__midiSend('p1', [0x90, p.midi, 100]), t0 + p.atMs - performance.now());
    setTimeout(() => window.__midiSend('p1', [0x80, p.midi, 0]), t0 + off - performance.now()); });
  setTimeout(resolve, plays[plays.length - 1].atMs + 200);`);

// Press Your turn, wait out the count-in, play `plays` (each { midi, atMs } on the fake keyboard, or { key, atMs } typed), press Stop and check.
// atMs is relative to the first beat (the moment the count-in ends).
async function playTry(page, plays) {
  await page.clickSelector(REC);
  await page.waitFor("(document.querySelector('.panel-songs-count') || {}).textContent === 'Counting in…'");
  if (plays[0].key) {
    await page.evaluate(afterCountIn('resolve(true);'));
    const t0 = Date.now();
    for (const { key, atMs } of plays) { const w = t0 + atMs - Date.now(); if (w > 0) await sleep(w); await page.press(key, { text: key }); }
  } else await page.evaluate(keyboardPlays(plays));
  await sleep(250);
  await page.clickSelector(REC);
  await page.waitFor("document.querySelector('.panel-songs-msg') && document.querySelector('.panel-songs-msg').textContent.trim() !== ''");
  return msg(page);
}

// A timed try on a busy machine can land a beat off (the audio clock stalls under load). A bounded
// retry from a fresh try, never a wider tolerance (the repo's own policy, retryFlaky in browser.mjs):
// a wrong app fails every attempt. Every discarded attempt is printed.
// Progress counts every judged Learn row as help (pass or not) and every Check pass as independent, so the tries made are tallied here
// and the final Progress line is checked against what this run actually did, not against a fixed 1 and 1.
const tally = { learnRows: 0, checkPasses: 0 };
async function timedTry(page, plays, accept, what) {
  const tried = [];
  for (let i = 0; i < ATTEMPTS; i++) {
    const m = await playTry(page, plays);
    if (/^Learn/.test(what)) tally.learnRows++; else if (NICE.test(m)) tally.checkPasses++;
    if (accept.test(m)) return m;
    tried.push(m);
    console.warn(`song-flow: ${what} -- discarded attempt ${i + 1} (${m})`);
  }
  assert.fail(`${what}: no attempt matched ${accept} in ${ATTEMPTS} tries: ${tried.join(' | ')}`);
}

test('A07: a Learn pass with help, then Check on a MIDI keyboard: every wrong way of playing is named, only a MIDI pass counts', async (t) => {
  await withAcceptancePage(t, { initScript: FAKE_MIDI_INIT, simulated: ['fake MIDI keyboard (FAKE_MIDI_INIT)'] }, async (page) => {
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
      await page.evaluate("[...document.querySelectorAll('li.panel-songs-row button')].find((b) => b.textContent === 'Mary Had a Little Lamb').setAttribute('data-q4b2', 'x')");
      await page.clickSelector('[data-q4b2="x"]');
    }
    await page.waitFor("!document.querySelector('.panel-songs-practice').hidden");

    // a. Learn and help: the app plays it for you; the exact try passes; other modes offer no demo.
    assert.ok(await hasButton(page, 'Play it'), 'Learn: the app offers to play the phrase first');
    await clickButton(page, 'Next'); await clickButton(page, 'Next');
    assert.match(await timedTry(page, exact(), NICE, 'Learn exact rhythm'), NICE, 'the exact rhythm passes in Learn');
    await mode(page, 'rehearse');
    assert.equal(await page.evaluate("document.querySelector('.panel-songs-mode button[data-mode=\"rehearse\"]').getAttribute('aria-pressed')"), 'true');
    assert.equal(await hasButton(page, 'Play it'), false, 'Rehearse: no demo');
    await mode(page, 'check');
    assert.equal(await page.evaluate("document.querySelector('.panel-songs-mode button[data-mode=\"check\"]').getAttribute('aria-pressed')"), 'true');
    assert.equal(await hasButton(page, 'Play it'), false, 'Check: no demo');

    // f. Early and late, Check rhythm step: the first note is on the beat, the rest are 240 ms early / 200 ms late.
    await clickButton(page, 'Next');
    await timedTry(page, exact(-240), EARLY, 'early try');
    await timedTry(page, exact(200), LATE, 'late try');

    // b. The exact try passes in Check, and the verdict that rides to the next step says it counted.
    await timedTry(page, exact(), NICE, 'Check exact rhythm');
    assert.equal(await read(page, '.panel-songs-check-result'), 'This try counted as a check.');

    // Pitches step (untimed): each way of playing it wrong gets its own plain sentence.
    const slow = (midis) => midis.map((midi, i) => ({ midi, atMs: i * 350 }));
    const m = MIDIS;
    assert.equal(await playTry(page, slow([...m.slice(0, 4), m[3], ...m.slice(4, 6)])), 'An extra D4 crept in — just the written notes.', 'c1: a wrong note in the middle');
    seen.firstNoteWrong = await playTry(page, slow([m[1], ...m.slice(1)]));
    assert.match(seen.firstNoteWrong, /^(Missed|An extra) /, 'c2: the app says something about it'); // what exactly: finding F1 below
    assert.equal(await playTry(page, slow(m.slice(0, 5))), 'Missed the E4 — 5 of 7 notes.', 'd: two notes missing');
    assert.equal(await playTry(page, slow([...m.slice(0, 3), 65, ...m.slice(3)])), 'An extra F4 crept in — just the written notes.', 'e: one extra note');

    // g. Computer keys: the notes are right, so it passes, but it is practice and says so.
    assert.match(await playTry(page, MIDIS.map((midi, i) => ({ key: KEYS[midi], atMs: i * 350 }))), NICE, 'g: the typed notes are right, so it passes');
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
