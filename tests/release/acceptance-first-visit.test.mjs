// Acceptance scenario A01: a first visit played on the computer keys, start to
// finish, on the release file. A learner picks Keyboard, presses Start, plays
// what the screen asks (one wrong key on the way), pauses, resumes, ends,
// reloads at once and comes back. Everything the learner does is real input
// (mouse clicks and key presses from the browser's Input domain); everything
// asserted is what the screen says or what the page stored. No debug hook, no
// app function called from the test.
//
// The two things a person would notice and a unit test cannot show: playing the
// prompted notes on the computer keys is judged, corrected and logged with no
// MIDI device; and those keys are practice, never proof of a real keyboard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';

// Upper computer-key row (src/core/pckeys.js), naturals only: the keys a
// learner is told to press for each note name the prompt can show.
const KEY_FOR = { C: 'a', D: 's', E: 'd', F: 'f', G: 'g', A: 'h', B: 'j', 'C (high)': 'k' };
const NATURALS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

// Test-owned note-taking, installed before the app boots (and again after a
// reload): every new <b> the prompt shows is a new target. Counting new nodes
// tells a fresh target from the one just answered, with no sleeps and no read
// of app state. It also counts every rewrite of #feedback, so a test can wait
// for the screen to answer THIS key press instead of reading the last answer.
const WATCH_PROMPT = `(() => {
  const seen = new WeakSet();
  window.__q3bTargets = [];
  window.__q3bFeedback = 0;
  const scan = () => { const b = document.querySelector('#prompt b'); if (b && !seen.has(b)) { seen.add(b); window.__q3bTargets.push(b.textContent); } };
  new MutationObserver((records) => { scan(); for (const m of records) if (m.target.id === 'feedback') window.__q3bFeedback++; }).observe(document, { childList: true, subtree: true });
})()`;

const text = (page, id) => page.evaluate(`document.getElementById(${JSON.stringify(id)}).textContent.trim()`);
const cls = (page, id) => page.evaluate(`document.getElementById(${JSON.stringify(id)}).className`);
const hidden = (page, id) => page.evaluate(`document.getElementById(${JSON.stringify(id)}).hidden`);
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const feedbackCount = (page) => page.evaluate('window.__q3bFeedback');
// Presses a key, then waits until #feedback has been rewritten by that press.
const pressAndWait = async (page, key) => {
  const n = await feedbackCount(page);
  await page.press(key, { text: key });
  await page.waitFor(`window.__q3bFeedback > ${n}`);
};
// A first-try pass names the note that was asked for, so a leftover line from
// the previous note can never satisfy it.
const firstTry = (short) => new RegExp(`^${escapeRe(short)}: yes, in \\d+\\.\\d s\\.$`);
const stored = (page) => page.evaluate("JSON.parse(localStorage.getItem('bandcoach.v1') || 'null')");

// The learner's view of "what do I play": the newest <b> in the prompt, typed
// on the computer keys. `consumed` is how many targets were already answered.
function makePlayer(page) {
  let consumed = 0;
  const targetsShown = () => page.evaluate('window.__q3bTargets.length');
  return {
    // Marks everything shown so far as answered (used right before a resume,
    // which always presents a fresh target).
    sync: async () => { consumed = await targetsShown(); },
    // With `wrongFirst` the learner presses a neighbouring natural first, then
    // the right key. Every wait is on something the screen did: the answer to a
    // key press, or the next target appearing. Never a fixed sleep.
    async playTarget({ wrongFirst = false } = {}) {
      await page.waitFor(`window.__q3bTargets.length > ${consumed}`);
      const shown = await page.evaluate("({ n: window.__q3bTargets.length, label: document.querySelector('#prompt b').textContent })");
      consumed = shown.n;
      const key = KEY_FOR[shown.label];
      if (!key) throw new Error(`the prompt asks for "${shown.label}", which has no computer key in this test's table`);
      // The note's letter as the feedback prints it ("C (high)" is shown as "C").
      const short = shown.label.split(' ')[0];
      if (!wrongFirst) {
        await pressAndWait(page, key);
        return { label: shown.label, short, feedback: await text(page, 'feedback'), feedbackClass: await cls(page, 'feedback') };
      }
      // A neighbour on the same row only exists for a plain natural: for anything
      // else (C (high) has no neighbour here) refuse rather than guess a key.
      if (!NATURALS.includes(shown.label)) throw new Error(`wrongFirst has no neighbouring natural to press for the prompted note "${shown.label}"`);
      await pressAndWait(page, KEY_FOR[NATURALS[(NATURALS.indexOf(shown.label) + 1) % NATURALS.length]]);
      const wrong = { text: await text(page, 'feedback'), cls: await cls(page, 'feedback') };
      const n = await feedbackCount(page);
      await page.press(key, { text: key });
      // The right key's own answer, or (if it was swallowed) the next target: either
      // ends the wait, and `answered` says which one it was.
      await page.waitFor(`window.__q3bFeedback > ${n} || window.__q3bTargets.length > ${shown.n}`);
      const answered = (await feedbackCount(page)) > n;
      const right = { text: await text(page, 'feedback'), cls: await cls(page, 'feedback') };
      // No check here that the prompt "moves on exactly once": a count read as
      // soon as the next target appears can never see a second advance, so it
      // could not fail. Spec rule 4 (a wrong key leaves the prompt unchanged)
      // rests on 4c and 5a (the right key is answered as "That is the one" for the
      // note that was asked, which a moved prompt would break), on the alignment of
      // played notes against targets shown, and on the 90% session figure.
      return { label: shown.label, short, wrong, right, answered };
    },
  };
}

const chooseKeyboard = (page) => page.clickSelector('#picker button[data-mod="kbd"]');

test('A01: first visit on computer keys -- choose, start, play, pause, play, end, reload, return', async (t) => {
  await withAcceptancePage(t, { initScript: WATCH_PROMPT }, async (page) => {
    // ---- T1: first visit -------------------------------------------------
    // 1. The first screen, then the pick.
    assert.equal(await text(page, 'navInstrument'), 'Choose an instrument', 'a fresh profile is asked to choose');
    assert.equal(await hidden(page, 'picker'), false, 'the instrument sheet is open on a first visit');
    await chooseKeyboard(page);
    assert.equal(await hidden(page, 'picker'), true, 'picking Keyboard closes the sheet');
    assert.equal(await text(page, 'navInstrument'), 'Instrument: Keyboard');
    assert.equal(await text(page, 'coach'), 'Press Start. Level 1: C, D and E.');

    // 2. Start.
    await page.clickSelector('#playBtn');
    await page.waitFor("document.getElementById('playBtn').textContent.trim() === 'Pause'");
    const coach = await text(page, 'coach');
    assert.match(coach, /^Level 1: C, D and E\. Today: your first sitting here -- play what the screen asks/, `first-sitting line: ${coach}`);
    await page.waitFor('window.__q3bTargets.length > 0');
    assert.match(await text(page, 'prompt'), /^Play [CDE]$/);
    assert.equal(await text(page, 'playBtn'), 'Pause');

    // 3-5. Five prompted notes; the third gets a wrong key first.
    const player = makePlayer(page);
    const played = [];
    for (let i = 0; i < 5; i++) {
      const r = await player.playTarget({ wrongFirst: i === 2 });
      played.push(r.label);
      if (i === 2) {
        // 4. The wrong key is heard and corrected. 5. The right key after it is
        // recognised, answered, and not credited as first-try. Each is checked on
        // its own and reported together, so one broken rule names every check it breaks.
        const misses = [];
        const check = (name, fn) => { try { fn(); } catch (e) { misses.push(`${name}: ${e.message.split('\n')[0]}`); } };
        check('4a wrong key says what it heard', () => assert.match(r.wrong.text, new RegExp(`^That was [A-G][♯♭]?, the note is ${escapeRe(r.short)}\\. `), `wrong key: ${r.wrong.text}`));
        check('4b wrong key is a miss', () => assert.equal(r.wrong.cls, 'no', 'a wrong key is shown as a miss'));
        check('4c right key gets its own answer', () => assert.equal(r.answered, true, 'the right key after a wrong one was never answered'));
        check('5a right key recognised', () => assert.match(r.right.text, new RegExp(`^That is the one\\. ${escapeRe(r.short)}\\.$`), `right key after a miss: ${r.right.text}`));
        check('5b not shown as a pass', () => assert.notEqual(r.right.cls, 'ok', 'a note that needed a second try is not shown as a pass'));
        check('5c not a first-try line', () => assert.doesNotMatch(r.right.text, /yes, in/));
        assert.deepEqual(misses, [], 'wrong key then right key');
      } else {
        // 3. A first-try note.
        assert.match(r.feedback, firstTry(r.short), `first-try note ${i + 1} (${r.label}): ${r.feedback}`);
        assert.equal(r.feedbackClass, 'ok');
      }
    }

    // 6. Pause: the card says so, a key pressed while paused is not judged, Back resumes.
    await page.clickSelector('#playBtn');
    await page.waitFor("!document.getElementById('breakCard').hidden");
    assert.equal(await text(page, 'breakTitle'), 'Paused');
    assert.equal(await text(page, 'playBtn'), 'Resume');
    const before = { text: await text(page, 'feedback'), cls: await cls(page, 'feedback') };
    await page.press('a', { text: 'a' });
    assert.deepEqual({ text: await text(page, 'feedback'), cls: await cls(page, 'feedback') }, before, 'a key pressed while paused is neither judged nor credited');
    await player.sync();
    await page.clickSelector('#backBtn');
    await page.waitFor("document.getElementById('breakCard').hidden");
    assert.match(await text(page, 'coach'), /^Resuming level [12]\.$/);

    // 7. Five more, then End.
    for (let i = 0; i < 5; i++) {
      const r = await player.playTarget();
      played.push(r.label);
      assert.match(r.feedback, firstTry(r.short), `first-try note ${i + 6} (${r.label}): ${r.feedback}`);
      assert.equal(r.feedbackClass, 'ok');
    }
    await page.clickSelector('#endBtn');
    const endedAt = Date.now();
    await page.waitFor("/^Session /.test(document.getElementById('coach').textContent)");
    const done = await text(page, 'coach');
    assert.match(done, /^Session done: \d+(?:\.\d)? min, (\d+)% right/, `session line: ${done}`);
    assert.doesNotMatch(done, /Too short to log/);
    t.diagnostic(`A01 start line: ${coach}`);
    t.diagnostic(`A01 targets shown: ${JSON.stringify(await page.evaluate('window.__q3bTargets'))}; session line: ${done}`);
    // Every note the learner played was the one the screen asked for, in order.
    assert.deepEqual(played, (await page.evaluate('window.__q3bTargets')).slice(0, played.length), 'played notes match the targets shown');
    const pct = Number(/(\d+)% right/.exec(done)[1]);
    assert.equal(pct, 90, `nine first-try passes in ten judged notes is 90%, got ${pct}%`);

    // ---- T2: reload at once, come back -----------------------------------
    // No wait for the 1200 ms save debounce: the page's own pagehide flush has
    // to keep the sitting.
    await page.reload();
    t.diagnostic(`A01 End click to reload finished: ${Date.now() - endedAt} ms (save debounce is 1200 ms)`);
    assert.equal(await hidden(page, 'picker'), true, 'the instrument is remembered');
    assert.equal(await text(page, 'navInstrument'), 'Instrument: Keyboard');
    assert.match(await text(page, 'coach'), /^Welcome back\. You are on level \d+: .+\. Press Start\.$/);

    // The keyboard path says Setup: nothing played on computer keys is proof of a real keyboard.
    await page.clickSelector('#kbdPathwayBtn');
    await page.waitFor("document.querySelector('li[aria-current=\"step\"]')");
    const step = await page.evaluate("({ step: document.querySelector('li[aria-current=\"step\"]').dataset.step, text: document.querySelector('li[aria-current=\"step\"]').textContent })");
    assert.equal(step.step, 'setup', 'computer keys never move the learner past setting up a real keyboard');
    assert.match(step.text, /You are here/);

    await page.clickSelector('#mainNav button[data-route="progress"]');
    await page.waitFor("/session/.test(document.getElementById('historySummary').textContent)");
    assert.match(await text(page, 'historySummary'), /^1 session logged\./);
    const retention = await text(page, 'historyRetention');
    assert.match(retention, /Tries with help: 0/, retention);
    assert.match(retention, /Passed on your own: 0/, 'computer-key passes are never "on your own"');

    // Storage, observation only.
    const db = await stored(page);
    const inputs = db.events.map((e) => e.input);
    assert.ok(inputs.filter((x) => x === 'computer-key').length >= 10, `at least ten computer-key rows, got ${JSON.stringify(inputs)}`);
    assert.ok(!inputs.includes('midi'), 'no row claims a MIDI keyboard');
    // The coach line's minutes are the stored row's minutes, not a whole-minute rounding of them.
    assert.equal(db.sessions.length, 1, 'one session row stored');
    assert.equal(Number(/^Session done: (\d+(?:\.\d)?) min/.exec(done)[1]), db.sessions[0].min, `coach line minutes match the stored session (${done})`);

    assert.deepEqual(page.exceptions, [], 'no uncaught exceptions');
  });
});

test('control for A01: keys pressed outside a judged note are never credited', async (t) => {
  // If a stray or wrong key were credited, the first-try assertions above would
  // pass for the wrong reason.
  // Deliberately stricter than the unit spec, which only asks for "no events
  // after the debounce": this also presses the right key once and asserts exactly
  // one stored row, logged as a miss. Stray keys before Start, or a k that was
  // credited or advanced the prompt, would add rows or a pass and fail it; the
  // spec's check (nothing stored) could not tell a miss from a pass.
  await withAcceptancePage(t, { initScript: WATCH_PROMPT }, async (page) => {
    await chooseKeyboard(page);
    for (const k of ['a', 's', 'd']) await page.press(k, { text: k });
    assert.equal(await text(page, 'feedback'), '', 'keys before Start say nothing about right or wrong');

    await page.clickSelector('#playBtn');
    await page.waitFor('window.__q3bTargets.length > 0');
    const asked = await page.evaluate('window.__q3bTargets[0]');
    for (let i = 0; i < 4; i++) {
      // k is C5: a mapped key that is never a level-1 target.
      await pressAndWait(page, 'k');
      const fb = await text(page, 'feedback');
      assert.equal(await cls(page, 'feedback'), 'no', `press ${i + 1} is shown as a miss: ${fb}`);
      assert.match(fb, new RegExp(`^That was C, the note is ${escapeRe(asked)}\\. `), `press ${i + 1}: ${fb}`);
      assert.doesNotMatch(fb, /yes, in/);
    }
    // Four misses, each answered for the note that was asked (so the prompt had
    // not moved). The right key then answers that same note. No "moves on exactly
    // once" count: read when the next target appears it could never see a second
    // advance. A stray advance would show as a second stored row below.
    await pressAndWait(page, KEY_FOR[asked]);
    const last = await text(page, 'feedback');
    assert.match(last, new RegExp(`^That is the one\\. ${escapeRe(asked)}\\.$`), `the right key after four misses: ${last}`);
    // That one note is the only thing finished, and it is a miss. Storage is read
    // once the page has written that one row (the app's save debounce is 1200 ms),
    // so the wait is on the row itself, not on time.
    await page.waitFor("(() => { try { return JSON.parse(localStorage.getItem('bandcoach.v1')).events.length >= 1; } catch (e) { return false; } })()");
    const db = await stored(page);
    assert.deepEqual((db.events || []).map((e) => e.dims && e.dims.pitch), ['miss'], 'only the one note finished, logged as a miss, never a pass');
    assert.deepEqual(page.exceptions, [], 'no uncaught exceptions');
  });
});
