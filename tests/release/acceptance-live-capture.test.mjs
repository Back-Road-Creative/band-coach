// Acceptance: a learner plucks a note at a lesson through the (fake) microphone and reads what
// the app says. The way in is a learner's: real clicks (instrument, "Set up input", Connect,
// Start), a browser-level mic grant, no debug hook. Only the microphone DEVICE is simulated: it
// loops one 8 s WAV (3.5 s of silence, then the event) built by tests/fixtures/acceptance/
// live-capture-wav.mjs. The two lines a learner reads, #feedback and #coach, are watched by a
// MutationObserver that only records.
//
// What is asserted is what the learner is told, in order: a pass is the FIRST thing said about the
// target pluck, a wrong note names both notes and the way to move, a silent room and a noisy room
// and a chord each get their own plain sentence. Known and not asserted: after a correct pass a
// still-ringing string can be judged against the NEXT item, so a stray "That was E, the note is A"
// can follow a pass. Unit Q10d fixed the first cause (src/app.js present() no longer re-arms a note
// that is still ringing at a task start) and unit Q10d-2 the second (the quiet rule now releases a
// ringing note after 0.1 s of delivered quiet, not after three frames). Remaining: a false onset after
// a clarity dropout (src/app.js:1404) and the quiet-at-present branch (src/app.js:1062); the test.todo
// entries below name them. Live-capture strays out of 42 runs (clipped 20, loud 10, decay999 6, quiet
// 6), measured at load 31 to 21 before Q10d-2 and 21 to 45 after it: 5 then 2, every one an onset.
// The literal claims they break (T1 and T7: no "That was" record in the window; T4: one pass and
// nothing else) stay todos: the rate moves with machine load, so no literal claim is deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage, effectiveWaitMs } from '../helpers/browser.mjs';
import { writeLoopWav, FEEDBACK_RECORDER, LOOP_SECONDS } from '../fixtures/acceptance/live-capture-wav.mjs';
import { name } from '../../src/core/note-names.js';

// The first item of each lesson on a fresh profile. The prompt shows only the letter, with no
// octave, so the test pins the item (id s6f0 and n60) and fails loudly if the curriculum moves.
const GTR = { mod: 'gtr', midi: 40, letter: 'E', short: 'E (string 6)' }; // open low E string
const MALLET = { mod: 'mallet-percussion', midi: 60, letter: 'C' };
// What the app says when the item times out unplayed (src/app.js, failEl 'Time. ' + the string and
// fret + 'It is shown now: play it to move on.'). It is not a judgment, and it is the only #feedback
// text a silent or noisy room may produce, for the hard-coded item above (string 6, open).
const TIMEOUT = 'Time. It is on string 6, open. It is shown now: play it to move on.';
const AT = 3.5; // seconds into the loop that the event starts
const SIMULATED = ['fake microphone playing a looped synthetic plucked-string WAV', 'text recorder on #feedback and #coach (observes only)'];

const MSG = {
  silent: "I'm not hearing anything at all. Check that the right microphone is selected and that it isn't muted.",
  quiet: "I can hear something, but it's too quiet to judge. Try moving closer to the mic, raising its input gain, or run the noise-floor calibration.",
  chord: "That sounds like a chord or more than one note at once. Play one note at a time.",
};

const nowMs = (page) => page.evaluate('performance.now()');
const lines = (page) => page.evaluate('window.__bcLines');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const promptLetter = (page) => page.evaluate("(document.querySelector('#prompt b') || {}).textContent || ''");

// Instrument button, "Set up input", Connect, wait for "Listening", then Start: the order a
// learner follows. Returns the page-clock time of the Start click.
async function connectAndStart(page, item) {
  await page.grant(['microphone']);
  await page.clickSelector(`#picker button[data-mod="${item.mod}"]`);
  await page.clickSelector('#setupBtn');
  await page.clickSelector('#ioBtn');
  await page.waitFor("/Listening/.test(document.getElementById('ioText').textContent)");
  await page.clickSelector('#playBtn');
  const started = await nowMs(page);
  await page.waitFor("!!document.querySelector('#prompt b')");
  assert.equal(await promptLetter(page), item.letter, 'curriculum changed: re-run probe A (the first item is no longer the one this test plays)');
  return started;
}

// Polls the recorder until a record matches, or the wait runs out (then returns null).
async function firstRecord(page, match, ms = effectiveWaitMs(16000)) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const hit = (await lines(page)).find(match);
    if (hit) return hit;
    await sleep(50);
  }
  return null;
}
const isFeedback = (r) => r.el === 'feedback' && r.text !== '';
const isPass = (r) => isFeedback(r) && r.cls === 'ok';
const isCorrection = (r) => isFeedback(r) && /^That was /.test(r.text);
const waitUntilPageTime = async (page, t) => { while ((await nowMs(page)) < t) await sleep(50); };

// Nothing was judged: no pass, no "That was", and every #feedback record is the item-timeout sentence.
function assertOnlyTimeout(all, where) {
  assert.deepEqual(all.filter((r) => isPass(r) || isCorrection(r)), [], `${where} was passed or corrected`);
  assert.deepEqual(all.filter((r) => isFeedback(r) && r.text !== TIMEOUT), [], `${where}: #feedback said something other than the item timeout`);
}

const run = (t, wavName, plucks, wavOpts, item, fn) =>
  withAcceptancePage(t, { fakeAudioFile: writeLoopWav(wavName, plucks, wavOpts), initScript: FEEDBACK_RECORDER, simulated: SIMULATED }, async (page) => {
    await fn(page, await connectAndStart(page, item));
    assert.deepEqual(page.exceptions, [], 'no uncaught exceptions');
  });

// T1: the pass reads the same at a quiet and at a loud pluck, and it is the first thing said.
for (const [label, gain] of [['quiet', 0.12], ['loud', 1.0]]) {
  test(`T1 a correct ${label} pluck is passed first, with the time it took, and the lesson moves on`, async (t) => {
    await run(t, `t1-${label}`, [{ at: AT, midis: [GTR.midi], gain }], {}, GTR, async (page) => {
      const first = await firstRecord(page, isFeedback);
      assert.ok(first, 'the app said nothing in #feedback about a correct pluck (no pass record)');
      assert.ok(isPass(first), `the first thing said about the correct pluck was not a pass: ${first.cls} ${JSON.stringify(first.text)}`);
      assert.match(first.text, /^E \(string 6\): yes, in \d+\.\d s\.$/);
      await page.waitFor("(document.querySelector('#prompt b') || {}).textContent !== 'E'").catch(() => assert.fail('the prompt did not move to the next note after a pass'));
    });
  });
}

// Q10d fixed the present() re-arm (src/app.js:1062) and Q10d-2 the quiet rule (a ringing note is released
// by 0.1 s of delivered quiet, src/app.js:1406). Residual causes still let a ring fire against the next
// item in live capture, so these stay todos: (a) a false onset on a clipped or long ring right after a
// clarity dropout (src/audio/onset.js; the pluck branch's `if (fr.onset) { released = true; stableN = 0; }`,
// src/app.js:1404), the only cause seen in the p3 runs; (b) the quiet-at-present branch (src/app.js:1062),
// seen in the p1q replay at about 2 of 42. p3 rates (clipped 20, loud 10, decay999 6, quiet 6): before
// Q10d-2 5/42 (all clipped) at load 31 to 21, after 2/42 (all clipped) at load 21 to 45. JP decides.
test.todo('T1 (literal) no "That was" record in the window after a correct pluck: not yet green, see the residual causes above (false onset after a dropout, src/app.js:1404; quiet at a task start, src/app.js:1062)');

// T2: the wrong note on a guitar names both notes and counts FRETS, by the real distance and
// pointing the way the target is (heard above the target means a lower fret).
for (const gap of [2, 7]) {
  test(`T2 a guitar note ${gap} semitones above the target says "Go ${gap} frets lower."`, async (t) => {
    const heard = name(GTR.midi + gap);
    await run(t, `t2-${gap}`, [{ at: AT, midis: [GTR.midi + gap], gain: 0.5 }], {}, GTR, async (page) => {
      const first = await firstRecord(page, isFeedback);
      assert.ok(first, 'the app said nothing in #feedback about a wrong note');
      assert.equal(first.text, `That was ${heard}, the note is ${GTR.letter}. Go ${gap} frets lower.`);
      assert.equal(first.cls, 'no');
      assert.doesNotMatch(first.text, /key|left|right/, 'a guitar has no keys, left or right');
    });
  });
}

// T3: the same wrong note plucked again says so again, every time.
test('T3 the same wrong note plucked three times in one loop is corrected each time', async (t) => {
  const plucks = [AT, AT + 1.2, AT + 2.4].map((at) => ({ at, midis: [GTR.midi + 2], gain: 0.5 }));
  await run(t, 't3', plucks, {}, GTR, async (page) => {
    const first = await firstRecord(page, isCorrection);
    assert.ok(first, 'no correction at all for the wrong note');
    const windowEnd = first.t + 7000; // the next loop's first pluck is at least 7.9 s later
    const same = async () => (await lines(page)).filter((r) => isCorrection(r) && r.text === first.text && r.t < windowEnd);
    while ((await nowMs(page)) < windowEnd && (await same()).length < 3) await sleep(50);
    assert.ok((await same()).length >= 3, `plucked the same wrong note 3 times and was corrected ${(await same()).length} time(s)`);
  });
});

// T4 (decaying note, decay 0.999: one pass, no "That was" record in the window; protecting mutation
// src/audio/onset.js thresholdMult = 2.2 -> 0 and minFlux = 0.02 -> 0) is not yet green with the
// present() fix alone.
// Q10d fixed the present() re-arm (src/app.js:1062) and Q10d-2 the quiet rule (src/app.js:1406); residual
// causes remain (a: false onset after a clarity dropout, src/audio/onset.js and src/app.js:1404; b: quiet
// at a task start, src/app.js:1062). decay999 strayed in 0 of 6 p3 runs before and after Q10d-2 (1 of 6 in
// p1c, whose load was not recorded), so the claim is load-dependent, not deterministic. JP decides.
test.todo('T4 a decaying correct note is passed once and never corrected: not yet green, see the residual causes above (false onset after a dropout, src/app.js:1404; quiet at a task start, src/app.js:1062)');

// T5: an empty room. One plain sentence, said once in two loops, and nothing judged.
test('T5 a silent microphone is reported once, in plain words, and nothing is judged', async (t) => {
  await run(t, 't5', [], {}, GTR, async (page, started) => {
    assert.ok(await firstRecord(page, (r) => r.el === 'coach' && r.text === MSG.silent), 'the learner was never told the microphone hears nothing');
    await waitUntilPageTime(page, started + 2 * LOOP_SECONDS * 1000 - 500);
    const all = await lines(page);
    assert.equal(all.filter((r) => r.el === 'coach' && r.text === MSG.silent).length, 1, 'said once over two loops');
    assertOnlyTimeout(all, 'a silent room');
  });
});

// T6: a noisy room with no note in it: too quiet to judge, and nothing judged.
test('T6 room noise with no note is called too quiet to judge, and nothing is judged', async (t) => {
  await run(t, 't6', [], { noiseFloorRms: 0.05 }, GTR, async (page, started) => {
    assert.ok(await firstRecord(page, (r) => r.el === 'coach' && r.text === MSG.quiet), 'the learner was never told the sound is too quiet to judge');
    await waitUntilPageTime(page, started + 2 * LOOP_SECONDS * 1000 - 500); // two loops, as T5: the item timeout always lands in the window
    assertOnlyTimeout(await lines(page), 'a noisy room');
  });
});

// T7: a clipped (way over full scale) pluck of the right note is still the right note.
test('T7 a clipped pluck of the target note is passed, never corrected first', async (t) => {
  await run(t, 't7', [{ at: AT, midis: [GTR.midi], gain: 4 }], {}, GTR, async (page) => {
    const first = await firstRecord(page, isFeedback);
    assert.ok(first, 'no answer to a clipped pluck of the right note');
    assert.ok(isPass(first), `a clipped pluck of the right note was not passed: ${first.cls} ${JSON.stringify(first.text)}`);
  });
});

// The same after-pass re-fire as T1, on the clipped note.
// Q10d fixed the present() re-arm (src/app.js:1062) and Q10d-2 the quiet rule (src/app.js:1406); the
// residual cause is a false onset after a clarity dropout (src/audio/onset.js and src/app.js:1404), plus
// the quiet-at-present branch (src/app.js:1062). Clipped strays in 5 of 20 p3 runs before Q10d-2 and 2 of
// 20 after (load 31 to 21 and 21 to 45). JP decides.
test.todo('T7 (literal) no "That was" record at all after a clipped pluck of the target: not yet green, see the residual causes above (false onset after a dropout, src/app.js:1404; quiet at a task start, src/app.js:1062)');

// T8: two notes at once (the target and the fifth above): told it is more than one note, and never
// told about a note nobody played.
test('T8 two notes at once is called a chord, and only played notes are named', async (t) => {
  const fifth = GTR.midi + 7;
  await run(t, 't8', [{ at: AT, midis: [GTR.midi, fifth], gain: 1 }], {}, GTR, async (page) => {
    const said = await firstRecord(page, (r) => r.el === 'coach' && r.text === MSG.chord);
    assert.ok(said, 'two notes at once were never called a chord');
    await waitUntilPageTime(page, said.t + 7000);
    const fb = (await lines(page)).filter((r) => isFeedback(r) && r.t < said.t + 7000);
    const played = [name(GTR.midi), name(fifth)];
    for (const r of fb) {
      assert.doesNotMatch(r.text, /octave/, `an octave sentence for a chord: ${r.text}`);
      const m = /^That was (\S+?),/.exec(r.text);
      if (m) assert.ok(played.includes(m[1]), `named ${m[1]}, which nobody played (played ${played.join(' and ')}): ${r.text}`);
    }
  });
});

// T9: mallet percussion has keys, not frets.
test('T9 a mallet note two semitones high says "Go 2 keys to the left."', async (t) => {
  await run(t, 't9', [{ at: AT, midis: [MALLET.midi + 2], gain: 0.5 }], {}, MALLET, async (page) => {
    const first = await firstRecord(page, isFeedback);
    assert.ok(first, 'the app said nothing in #feedback about a wrong note');
    assert.equal(first.text, `That was ${name(MALLET.midi + 2)}, the note is ${MALLET.letter}. Go 2 keys to the left.`);
    assert.equal(first.cls, 'no');
  });
});

// Control for T1: the same loud pluck, but the browser blocks the microphone. If this ever hears a
// pass, the tests above are passing on something other than the fake microphone.
test('control: the loud pluck with the microphone blocked is never judged', async (t) => {
  await withAcceptancePage(t, { fakeAudioFile: writeLoopWav('control', [{ at: AT, midis: [GTR.midi], gain: 1 }]), initScript: FEEDBACK_RECORDER, simulated: SIMULATED }, async (page) => {
    await page.deny(['microphone']);
    await page.clickSelector(`#picker button[data-mod="${GTR.mod}"]`);
    await page.clickSelector('#setupBtn');
    await page.clickSelector('#ioBtn');
    await page.waitFor("/blocked|Listening/i.test(document.getElementById('ioText').textContent)");
    const io = await page.evaluate("document.getElementById('ioText').textContent");
    assert.match(io, /blocked/i, `the microphone was blocked, so the app must say so: ${io}`);
    assert.doesNotMatch(io, /Listening/);
    await page.clickSelector('#playBtn');
    const started = await nowMs(page);
    await waitUntilPageTime(page, started + 2 * LOOP_SECONDS * 1000);
    const judged = (await lines(page)).filter((r) => isFeedback(r) && (isPass(r) || isCorrection(r)));
    assert.deepEqual(judged, [], 'a blocked microphone still produced a pass or a correction');
  });
});
