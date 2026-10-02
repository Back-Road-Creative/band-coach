// Acceptance: a learner's first microphone minutes on the file they download.
// Connect in a quiet room, begin playing at once, recalibrate, switch input,
// hide the tab, be denied and allow again. Every step is real input through
// the driver (a mouse click, a key, the browser's own permission store, a real
// second tab); the page is only OBSERVED, by the recorder in
// tests/fixtures/acceptance/mic-journey.mjs and by reading the DOM. No debug
// hook is used or exists in this build.
//
// Probes behind the choices here (full header of the fixtures in mic-journey.mjs):
//   P3  A real key changes the Input select in headless Chrome and fires a
//       trusted `change`. Clicking the select opens its popup, where ArrowDown
//       only moves the highlight (the value does not change) and Enter commits
//       it: 4 ArrowDown + Enter landed on 'Fake Audio Input 2' with one trusted
//       change event. Escape and then ArrowDown on the closed select instead
//       changes the value at once (to 'Fake Default Audio Input'). The popup
//       route fires ONE change however far it moves, so switchInput() uses it:
//       no simulated change event is needed anywhere in this file. The Windows
//       lane (Q9-B) should re-run it with its own real key.
//   P4  After page.deny(['microphone']) with a stream already open, Chrome left
//       the stream alone: #ioText stayed 'Listening through your microphone.'
//       and the dot stayed on for the 4 s watched, while
//       navigator.permissions.query said 'denied'. The app has no listener for
//       a track that ends, so a person who revokes the microphone while
//       connected is still told it is listening if Chrome ever does end the
//       track. This driver cannot end a track, so nothing here pins that.
//   P5  After a blocked Connect, 'Check my microphone', then Allow and a
//       reconnect, #calibrateResult kept 'The microphone was blocked, so it
//       could not be checked.' beside 'Listening through your microphone.'.
//       The text is written only by calibrateNoiseFloor and nothing clears it
//       on a successful reconnect (a stored floor starts no check). T7 pins it
//       as a todo until a src unit fixes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage, effectiveWaitMs } from '../helpers/browser.mjs';
import { quietRoom, learnerPlaying, writeFixture, RECORDER_SCRIPT } from '../fixtures/acceptance/mic-journey.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHECKING = 'Checking the room — stay quiet for a moment…';
const LISTEN3 = 'Listening for 3 seconds — stay quiet…';
const QUIET = 'Your room is quiet.';
const HEARD_PLAYING = 'I heard playing during the check, so nothing was changed. Try again in silence.';
const LISTENING = 'Listening through your microphone.';
const NOT_CONNECTED = 'This one listens through a microphone or audio interface.';

let files;
const fixtureFile = (name) => (files ||= { quiet: writeFixture('quiet-room', quietRoom()), playing: writeFixture('learner-playing', learnerPlaying()) })[name];

// A learner on the release file with the microphone allowed: instrument, "Set
// up input", then Connect, all real clicks.
async function learner(t, fixture, fn) {
  await withAcceptancePage(t, { fakeAudioFile: fixtureFile(fixture), initScript: RECORDER_SCRIPT }, async (page) => {
    await page.grant(['microphone']);
    await page.clickSelector('#picker button[data-mod="gtr"]');
    await page.clickSelector('#setupBtn');
    await fn(page);
  });
}
const connect = (page) => page.clickSelector('#ioBtn');

const recorder = (page) => page.evaluate('window.__a04');
// Waits for the first recorder entry matching `pred` (source text over `e`),
// and fails with the whole recording rather than a bare timeout.
// The deadline honours the driver's wait floor (BAND_COACH_WAIT_FLOOR_MS), like page.waitFor.
async function until(page, what, pred, ms = 10000) {
  const limit = effectiveWaitMs(ms);
  const start = Date.now();
  for (;;) {
    const hit = await page.evaluate(`(window.__a04.find((e) => ${pred}) || null)`);
    if (hit) return hit;
    if (Date.now() - start > limit) assert.fail(`${what}: never recorded in ${limit} ms. Recorder: ${JSON.stringify((await recorder(page)).filter((e) => e.kind !== 'dot'))}`);
    await sleep(50);
  }
}
const isResultText = (e) => e.kind === 'result' && e.text !== '' && e.text !== CHECKING && e.text !== LISTEN3;
const resultText = (text, after) => `e.kind === 'result' && e.text === ${JSON.stringify(text)} && e.t > ${after}`;
const floorStored = (e) => e.kind === 'setItem' && e.floor !== null;
// The same two tests as source text, for until(), which runs them in the page.
const RESULT_TEXT = `(e.kind === 'result' && e.text !== '' && e.text !== ${JSON.stringify(CHECKING)} && e.text !== ${JSON.stringify(LISTEN3)})`;
const FLOOR = "(e.kind === 'setItem' && e.floor !== null)";
const io = (page) => page.evaluate("({ text: document.getElementById('ioText').textContent, dot: document.getElementById('ioDot').className, connectShown: !document.getElementById('ioBtn').hidden, meterShown: !document.getElementById('practiceMeter').hidden })");
const resultVisible = (page) => page.evaluate("(() => { const el = document.getElementById('calibrateResult'); return el.getClientRects().length > 0 && el.getAttribute('role') === 'status'; })()");
const pageNow = (page) => page.evaluate('performance.now()');
const holdUntil = async (page, t) => sleep(Math.max(0, t - (await pageNow(page))));

async function assertListening(page, why) {
  const s = await io(page);
  assert.equal(s.text, LISTENING, why);
  assert.match(s.dot, /\bon\b/, `the status dot is on: ${s.dot}`);
  assert.ok(!s.connectShown, 'Connect is gone once connected');
}
async function assertNotListening(page, why) {
  const s = await io(page);
  assert.equal(s.text, NOT_CONNECTED, why);
  assert.doesNotMatch(s.dot, /\bon\b/, `the status dot is not on: ${s.dot}`);
  assert.ok(s.connectShown, 'Connect is offered again');
  assert.ok(!s.meterShown, 'the practice meter is hidden');
}

// Picks `label` in the Input select with real keys: click it open, ArrowDown to
// the option, Enter (probe P3). Returns the option's value.
async function switchInput(page, label) {
  await page.waitFor(`[...document.getElementById('micDeviceSelect').options].some((o) => o.textContent.trim() === ${JSON.stringify(label)})`);
  const { from, to, value } = await page.evaluate(`(() => { const s = document.getElementById('micDeviceSelect'), o = [...s.options], i = o.findIndex((x) => x.textContent.trim() === ${JSON.stringify(label)}); return { from: s.selectedIndex, to: i, value: o[i].value }; })()`);
  await page.clickSelector('#micDeviceSelect');
  for (let i = from; i < to; i++) {
    const k = { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 };
    await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k });
    await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
  }
  await page.press('Enter');
  const change = await until(page, `the Input select changing to "${label}"`, "e.kind === 'change'", 3000);
  assert.equal(change.value, value, `the select committed "${label}"`);
  assert.equal(change.trusted, true, 'the change came from a real key, not a dispatched event');
  return { change, value };
}

test('T1 a quiet room: Connect shows a visible room check, then says the room is quiet and stores it', async (t) => {
  await learner(t, 'quiet', async (page) => {
    await connect(page);
    const checking = await until(page, 'a visible room check after Connect', `e.kind === 'result' && e.text === ${JSON.stringify(CHECKING)}`);
    const first = (await recorder(page)).find((e) => e.kind === 'result' && e.text !== '');
    assert.equal(first.text, CHECKING, 'the check is the first thing said');
    assert.ok(await resultVisible(page), 'the message is visible and is a status region');
    const quiet = await until(page, 'the room result', resultText(QUIET, checking.t));
    assert.ok(quiet.t - checking.t >= 1300, `the check listened for its 1.5 s window: result ${Math.round(quiet.t - checking.t)} ms after it began`);
    const stored = await until(page, 'a stored room floor', `${FLOOR} && e.t > ${quiet.t}`, 5000);
    assert.ok(Number.isFinite(stored.floor) && stored.floor < 0.003, `a quiet floor was stored: ${stored.floor}`);
    assert.equal(stored.v, 2, 'with the room-check version marker');
    await assertListening(page, 'and the microphone is listening');
    assert.equal(page.audio.contexts().length, 1, 'one AudioContext');
    assert.equal(page.audio.running().length, 1, 'and it is running');
  });
});

test('T2 playing at once: the check does not learn the playing as the room, and Check my microphone says so too', async (t) => {
  // Control for the test above: the same clicks with a different file.
  await learner(t, 'playing', async (page) => {
    await connect(page);
    const checking = await until(page, 'a visible room check after Connect', `e.kind === 'result' && e.text === ${JSON.stringify(CHECKING)}`);
    const heard = await until(page, 'a result for the check', `${RESULT_TEXT} && e.t > ${checking.t}`);
    assert.match(heard.text, /Heard sound/, 'the learner is told what it heard');
    assert.match(heard.text, /standard settings/, 'and what the app does instead');
    assert.ok(heard.text.includes('Check my microphone'), 'and what to press');
    assert.ok(await resultVisible(page), 'visibly');
    await assertListening(page, 'the microphone is still open: only the check refused');
    await page.clickSelector('#calibrateBtn');
    const click = await until(page, 'the Check my microphone click', "e.kind === 'click' && e.id === 'calibrateBtn'", 3000);
    assert.equal(click.trusted, true, 'a real click');
    const listening = await until(page, 'the 3 second listening text', resultText(LISTEN3, heard.t));
    await until(page, 'the refusal after the manual check', resultText(HEARD_PLAYING, listening.t));
    await sleep(1500); // past the 1.2 s save throttle, so a store would have reached storage
    const log = await recorder(page);
    assert.deepEqual(log.filter(floorStored), [], 'nothing was ever saved as the room floor');
    assert.equal(await page.evaluate("(JSON.parse(localStorage.getItem('bandcoach.v1') || '{}').prefs || {}).noiseFloor ?? null"), null, 'and storage holds no floor');
  });
});

test('T3 Check my microphone pressed twice in a quiet room: the first, older check stays silent', async (t) => {
  await learner(t, 'quiet', async (page) => {
    await connect(page);
    const quiet = await until(page, 'the first room result', resultText(QUIET, 0));
    await page.clickSelector('#calibrateBtn');
    const a = await until(page, 'the first press', `e.kind === 'click' && e.id === 'calibrateBtn' && e.t > ${quiet.t}`, 3000);
    await until(page, 'the 3 second listening text', resultText(LISTEN3, quiet.t));
    await sleep(800); // hold
    await page.clickSelector('#calibrateBtn');
    const b = await until(page, 'the second press', `e.kind === 'click' && e.id === 'calibrateBtn' && e.t > ${a.t}`, 3000);
    await holdUntil(page, b.t + 2800);
    const early = (await recorder(page)).filter((e) => isResultText(e) && e.t > b.t && e.t < b.t + 2800);
    assert.deepEqual(early, [], 'the first check ended inside the second one and wrote nothing');
    await holdUntil(page, b.t + 6000);
    const after = (await recorder(page)).filter((e) => e.kind === 'result' && e.text === QUIET && e.t > b.t);
    assert.equal(after.length, 1, `the second check says the room is quiet once: ${JSON.stringify(after)}`);
    assert.ok(after[0].t - b.t >= 2800, `after its own 3 s window: ${Math.round(after[0].t - b.t)} ms`);
    const stored = await until(page, 'a floor stored by the second check', `${FLOOR} && e.t > ${after[0].t} && e.v === 2`, 5000);
    assert.ok(Number.isFinite(stored.floor));
  });
});

test('T4a switching input while the first check runs: the new input gets its own full check', async (t) => {
  await learner(t, 'quiet', async (page) => {
    await connect(page);
    const checking = await until(page, 'a visible room check after Connect', `e.kind === 'result' && e.text === ${JSON.stringify(CHECKING)}`);
    const { change, value } = await switchInput(page, 'Fake Audio Input 1');
    assert.ok(change.t - checking.t < 1000, `switch landed too late for this test: ${Math.round(change.t - checking.t)} ms into the check`);
    const first = await until(page, 'a result after the switch', `${RESULT_TEXT} && e.t > ${change.t}`, 8000);
    assert.ok(first.t - change.t >= 1300, `the first result is the new input's own 1.5 s window, not the old one's: ${Math.round(first.t - change.t)} ms after the switch`);
    await holdUntil(page, change.t + 4500);
    assert.equal(await page.evaluate("document.getElementById('calibrateResult').textContent"), QUIET, 'the room is quiet');
    const afterSwitch = (await recorder(page)).filter((e) => e.kind === 'result' && e.t > change.t);
    const emptied = afterSwitch.findIndex((e, i) => i > 0 && e.text === '' && afterSwitch[i - 1].text !== CHECKING);
    assert.equal(emptied, -1, `a result was never wiped: ${JSON.stringify(afterSwitch)}`);
    const stored = await until(page, "a floor stored for the new input", `${FLOOR} && e.t > ${change.t}`, 5000);
    assert.ok(Number.isFinite(stored.floor));
    assert.equal(stored.v, 2);
    assert.equal(stored.id, value, 'saved against the input that was chosen');
    await assertListening(page, 'listening on the new input');
    assert.equal(page.audio.contexts().length, 1, 'still one AudioContext');
  });
});

test('T4b switching input after a floor is stored: the old floor is dropped and measured again', async (t) => {
  await learner(t, 'quiet', async (page) => {
    await connect(page);
    await until(page, 'the first room result', resultText(QUIET, 0));
    await sleep(1500); // hold: the throttled save has written the first floor
    const { change, value } = await switchInput(page, 'Fake Audio Input 1');
    const first = await until(page, 'a save after the switch', `e.kind === 'setItem' && e.t > ${change.t}`, 5000);
    assert.deepEqual({ floor: first.floor, v: first.v, id: first.id }, { floor: null, v: null, id: value }, 'the first save after the switch has the new input and no floor');
    await until(page, 'a new room check', resultText(CHECKING, change.t), 5000);
    const quiet = await until(page, 'the new room result', resultText(QUIET, change.t), 8000);
    assert.ok(quiet.t - change.t >= 1300, `a full new window: ${Math.round(quiet.t - change.t)} ms`);
    const stored = await until(page, 'the new floor', `${FLOOR} && e.t > ${quiet.t}`, 5000);
    assert.equal(stored.v, 2);
    assert.equal(stored.id, value);
  });
});

test('T5 tab hidden during the check: listening stops, nothing stale is written, Connect again measures afresh', async (t) => {
  await learner(t, 'quiet', async (page) => {
    await connect(page);
    const checking = await until(page, 'a visible room check after Connect', `e.kind === 'result' && e.text === ${JSON.stringify(CHECKING)}`);
    await page.background();
    const hidden = await until(page, 'the tab going hidden', "e.kind === 'visibility' && e.state === 'hidden'", 3000);
    assert.ok(hidden.t - checking.t < 1300, `backgrounded too late: ${Math.round(hidden.t - checking.t)} ms into the check`);
    await sleep(2200); // hold: the check's window ends while the tab is away
    await page.foreground();
    const vis = await page.visibilityLog();
    assert.deepEqual(vis.map((v) => [v.state, v.trusted]), [['hidden', true], ['visible', true]], 'the tab really went hidden and came back');
    await assertNotListening(page, 'back in the tab the app does not claim to be listening');
    await until(page, 'the stopped check ending with nothing said', `e.kind === 'result' && e.text === '' && e.t > ${hidden.t}`, 6000);
    await page.clickSelector('#ioBtn');
    const reconnect = await until(page, 'the Connect click', `e.kind === 'click' && e.id === 'ioBtn' && e.t > ${hidden.t}`, 3000);
    const log = await recorder(page);
    const between = log.filter((e) => e.t > hidden.t && e.t < reconnect.t);
    assert.deepEqual(between.filter(isResultText), [], 'the stopped microphone wrote no result');
    assert.deepEqual(between.filter(floorStored), [], 'and no floor');
    await until(page, 'a new room check', resultText(CHECKING, reconnect.t), 5000);
    const quiet = await until(page, 'the room result', resultText(QUIET, reconnect.t), 8000);
    const stored = await until(page, 'the floor', `${FLOOR} && e.t > ${quiet.t}`, 5000);
    assert.equal(stored.v, 2);
    await assertListening(page, 'listening again');
    assert.equal(page.audio.contexts().length, 1, 'still one AudioContext');
    await page.audio.waitForRunning();
    assert.ok(page.audio.running().length > 0, 'and it is running');
  });
});

// Shared by the two tests below: connected with a stored floor, the browser
// blocks the microphone, the tab goes away and comes back (the real teardown),
// and Connect is pressed with the microphone blocked.
async function connectedThenBlocked(page) {
  await connect(page);
  await until(page, 'the first room result', resultText(QUIET, 0));
  await page.deny(['microphone']);
  await page.background();
  await page.foreground();
  await assertNotListening(page, 'after the tab returns the app does not claim to be listening');
  await page.clickSelector('#ioBtn');
  await page.waitFor("/blocked/i.test(document.getElementById('ioText').textContent)");
  const s = await io(page);
  assert.match(s.text, /The microphone was blocked\. Allow it in the browser/, 'the app says what happened and what to do');
  assert.match(s.dot, /\boff\b/, `the status dot says off: ${s.dot}`);
  assert.ok(s.connectShown, 'Connect is still there to try again');
  assert.equal(await page.evaluate("navigator.permissions.query({ name: 'microphone' }).then((p) => p.state)"), 'denied', 'the browser holds the microphone as denied');
}

test('T6 microphone blocked after connecting, then allowed: Connect listens again', async (t) => {
  await learner(t, 'quiet', async (page) => {
    await connectedThenBlocked(page);
    await page.grant(['microphone']);
    await page.clickSelector('#ioBtn');
    await page.waitFor("document.getElementById('ioBtn').hidden");
    await assertListening(page, 'listening after Allow');
    assert.equal(page.audio.contexts().length, 1, 'still one AudioContext');
    await page.audio.waitForRunning();
    assert.ok(page.audio.running().length > 0, 'and it is running');
  });
});

test('T7 microphone allowed again after a blocked check: the old "blocked" message does not stay', { todo: 'src defect: #calibrateResult keeps the blocked text after a reconnect (see the P5 note at the top of this file: the observed text was \'The microphone was blocked, so it could not be checked.\')' }, async (t) => {
  await learner(t, 'quiet', async (page) => {
    await connectedThenBlocked(page);
    await page.clickSelector('#calibrateBtn');
    await page.waitFor("/blocked/.test(document.getElementById('calibrateResult').textContent)");
    await page.grant(['microphone']);
    await page.clickSelector('#ioBtn');
    await page.waitFor("document.getElementById('ioBtn').hidden");
    await assertListening(page, 'listening after Allow');
    assert.doesNotMatch(await page.evaluate("document.getElementById('calibrateResult').textContent"), /blocked/, 'the stale blocked message is gone');
  });
});
