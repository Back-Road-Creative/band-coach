// Acceptance: the MIDI Connect path as a learner meets it, on the release file
// in a full Chrome. The browser's own permission answer (page.deny / page.grant)
// reaches the app through the stub's navigator.permissions.query, so a denial is
// a real NotAllowedError, not a stub flag. The learner does everything with real
// clicks (instrument, "Set up input", Connect, Start, MIDI details). The stub
// helpers (midiAddPort, midiNoteOn, ...) are the keyboard and the operating
// system, never the learner, and call no app code. Everything asserted is DOM
// text or attributes, or navigator.permissions.query; there is no window.__coach
// in the release build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';
import {
  FAKE_MIDI_BROWSER_PERMISSION_INIT,
  midiAddPort,
  midiRemovePort,
  midiNoteOn,
  midiSetOpenResult,
  midiRejectWith,
  midiReject,
  midiSetPortState,
  midiMakeUnavailable,
} from '../helpers/fake-midi.mjs';
import { HANDS_TOGETHER_EXERCISES } from '../../src/core/hands-together.js';

const PORTS = 'MIDI ports are stubbed (fake-midi.mjs): which keyboards exist, their open() result and their bytes; MIDI permission comes from the browser (page.grant / page.deny), read by the stub through navigator.permissions.query';
// A returning learner at level 13, "Hands together: five-finger position", with a
// plain j1 used (src/core/hands-together.js bothUnlocked), so "Both" hands is
// open. State setup like RETURNING_LEARNER_INIT in a11y-focus-restore; the
// initScript re-seeds on each document load and these tests never reload.
const LEVEL_13_SEED = `localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'kbd' }, mods: { kbd: { level: 13, item: { j1: { reps: 1, seen: 1, stability: 1, difficulty: 0.3, lastSeen: Date.now() } } } } }));`;
const SEEDED = 'returning learner at level 13 (seeded localStorage)';

const STATUS = "document.getElementById('ioText').textContent";
const waitStatus = (page, re) => page.waitFor(`${re}.test(${STATUS})`);
const waitConnect = (page, shown) => page.waitFor(`document.getElementById('ioBtn').hidden === ${!shown}`);
const readIo = (page) =>
  page.evaluate(`({ text: ${STATUS}, dot: document.getElementById('ioDot').className, connectShown: !document.getElementById('ioBtn').hidden, connectDisabled: document.getElementById('ioBtn').disabled, connectLabel: document.getElementById('ioBtn').textContent, actDotHidden: document.getElementById('midiActDot').hidden })`);
const permission = (page) => page.evaluate("navigator.permissions.query({ name: 'midi' }).then((p) => p.state)");
const asks = (page) => page.evaluate('window.__midiAsks');

// A first-time learner: picks the keyboard, opens "Set up input", presses Connect.
async function pickKeyboardAndConnect(page) {
  await page.clickSelector('#picker button[data-mod="kbd"]');
  await page.clickSelector('#setupBtn');
  await page.clickSelector('#ioBtn');
}

test('MIDI blocked in the browser: Connect says so, Try MIDI again stays, and allowing it then works', async (t) => {
  await withAcceptancePage(t, { initScript: FAKE_MIDI_BROWSER_PERMISSION_INIT, simulated: [PORTS] }, async (page) => {
    await page.deny(['midi']);
    await pickKeyboardAndConnect(page);
    await waitStatus(page, /Chrome asked/);
    const io = await readIo(page);
    assert.match(io.text, /Chrome asked to use your MIDI devices and the answer was no/);
    assert.match(io.text, /click the icon left of the address bar/, 'it says where to allow it');
    assert.match(io.text, /practice, not proof/);
    assert.ok(io.connectShown && !io.connectDisabled, 'the learner can press it again');
    assert.equal(io.connectLabel, 'Try MIDI again');
    assert.ok(/\boff\b/.test(io.dot) && !/\bon\b/.test(io.dot), `the status dot is off: ${io.dot}`);
    assert.doesNotMatch(io.text, /found|working/, 'no connected claim');
    assert.equal(await permission(page), 'denied', 'the browser itself holds MIDI as denied');
    assert.equal(await asks(page), 1);

    // The person allows it from the address bar, then presses the visible retry button.
    await page.grant(['midi']);
    await page.clickSelector('#ioBtn');
    await waitStatus(page, /No MIDI device is plugged in/);
    const after = await readIo(page);
    assert.doesNotMatch(after.text, /Chrome asked/, 'the denial text is gone once the browser allows it');
    assert.equal(await asks(page), 2);
    assert.equal(await permission(page), 'granted');
  });
});

test('MIDI allowed, nothing plugged in: a keyboard plugged in later is "found", and only a byte makes it "working"', async (t) => {
  await withAcceptancePage(t, { initScript: FAKE_MIDI_BROWSER_PERMISSION_INIT, simulated: [PORTS] }, async (page) => {
    await page.grant(['midi']);
    await pickKeyboardAndConnect(page);
    await waitStatus(page, /No MIDI device is plugged in/);
    assert.ok((await readIo(page)).connectShown, 'Connect stays while there is nothing to connect to');

    await midiAddPort(page, 'p1', 'Test Keys');
    await waitConnect(page, false);
    const found = await readIo(page);
    t.diagnostic(`at "found" the status dot class is "${found.dot}" (a green light ahead of the "working" text)`);
    assert.match(found.text, /Test Keys found\. Press any key on it\./);
    assert.doesNotMatch(found.text, /is working/, 'no working claim before a byte has arrived');
    assert.equal(found.actDotHidden, true, 'the MIDI activity light has not shown yet');

    await midiNoteOn(page, 'p1', 60);
    await waitStatus(page, /Test Keys is working\./);
    assert.equal((await readIo(page)).actDotHidden, false, 'the activity light shows once a byte is heard');

    // Proof of the old keyboard is not proof of a new one.
    await midiRemovePort(page, 'p1');
    await waitConnect(page, true);
    await midiAddPort(page, 'p2', 'Spare Keys');
    await waitStatus(page, /Spare Keys found\. Press any key on it\./);
    assert.doesNotMatch((await readIo(page)).text, /is working/, 'a never-heard second keyboard is only "found"');
  });
});

test('a keyboard that will not open: Connect says another program may have it, MIDI details says why, and a byte still counts', async (t) => {
  await withAcceptancePage(t, { initScript: FAKE_MIDI_BROWSER_PERMISSION_INIT, simulated: [PORTS, 'keyboard p1 whose open() fails: could not open MIDI input (in use elsewhere)'] }, async (page) => {
    await page.grant(['midi']);
    await midiAddPort(page, 'p1', 'Test Keys');
    await midiSetOpenResult(page, 'p1', false);
    await pickKeyboardAndConnect(page);
    await waitStatus(page, /Another program/);
    const io = await readIo(page);
    assert.match(io.text, /Another program may be using this keyboard\. Close it and press Connect again\./);
    assert.ok(io.connectShown, 'Connect stays so the learner can press it again');
    assert.ok(/\boff\b/.test(io.dot), `the status dot is off: ${io.dot}`);

    await page.clickSelector('#midiDetailsBtn');
    await page.waitFor("document.getElementById('midiDetailsText').textContent.includes('Test Keys')");
    const details = () => page.evaluate("document.getElementById('midiDetailsText').textContent");
    const before = await details();
    assert.match(before, /open failed: could not open MIDI input \(in use elsewhere\)/);
    assert.doesNotMatch(before, /, opened\./);

    // A byte is better proof than open().
    await midiNoteOn(page, 'p1', 60);
    await waitStatus(page, /is working/);
    await page.waitFor("/sending messages anyway\\.$/m.test(document.getElementById('midiDetailsText').textContent)");
    assert.match(await details(), /open failed: could not open MIDI input \(in use elsewhere\), but it is sending messages anyway\./);
  });
});

test('control for the test above: the same clicks with a keyboard that opens read "found", never "Another program"', async (t) => {
  await withAcceptancePage(t, { initScript: FAKE_MIDI_BROWSER_PERMISSION_INIT, simulated: [PORTS] }, async (page) => {
    await page.grant(['midi']);
    await midiAddPort(page, 'p1', 'Test Keys');
    await pickKeyboardAndConnect(page);
    await waitStatus(page, /Test Keys found\. Press any key on it\./);
    assert.doesNotMatch((await readIo(page)).text, /Another program/);
  });
});

test('platform MIDI failures and a missing MIDI API each say something different, and none says the answer was no', async (t) => {
  // These are SIMULATED platform failures (SecurityError, InvalidStateError, a plain
  // Error) and a deleted API, not permission: MIDI is allowed in the browser here.
  // The control is the first test above: the same Connect click with nothing
  // injected reaches "No MIDI device is plugged in".
  await withAcceptancePage(t, { initScript: FAKE_MIDI_BROWSER_PERMISSION_INIT, simulated: [PORTS, 'platform failures injected into requestMIDIAccess (SecurityError, InvalidStateError, plain Error) and navigator.requestMIDIAccess removed'] }, async (page) => {
    await page.grant(['midi']);
    await page.clickSelector('#picker button[data-mod="kbd"]');
    await page.clickSelector('#setupBtn');
    const BLOCKED = /MIDI was blocked here\. Open the standalone copy in Chrome\./;
    const COULD_NOT = /This browser could not reach MIDI on this computer\./;
    const CANNOT = /This browser cannot read MIDI\. Use Chrome or Edge\./;
    const steps = [
      { inject: () => midiRejectWith(page, 'SecurityError', 'x'), re: BLOCKED, n: 1 },
      { inject: () => midiRejectWith(page, 'InvalidStateError', 'x'), re: COULD_NOT, n: 2 },
      { inject: () => midiRejectWith(page, 'SecurityError', 'x'), re: BLOCKED, n: 3 },
      { inject: () => midiReject(page), re: COULD_NOT, n: 4 },
      { inject: () => midiMakeUnavailable(page), re: CANNOT },
    ];
    const texts = [];
    for (const step of steps) {
      await step.inject();
      await page.clickSelector('#ioBtn');
      if (step.n) await page.waitFor(`window.__midiAsks === ${step.n}`);
      await waitStatus(page, step.re);
      const io = await readIo(page);
      texts.push(io.text);
      assert.match(io.text, step.re);
      assert.match(io.text, /practice, not proof a real keyboard works\.$/);
      assert.doesNotMatch(io.text, /Chrome asked|Try MIDI again/, 'none of these is a "the answer was no" message');
      assert.ok(io.connectShown, 'Connect is still there');
      assert.notEqual(io.connectLabel, 'Try MIDI again');
      assert.ok(/\boff\b/.test(io.dot), `the status dot is off: ${io.dot}`);
    }
    assert.equal(new Set(texts).size, 3, `three different texts, got ${JSON.stringify(texts)}`);
    assert.equal(texts.filter((x) => /standalone copy/.test(x)).length, 2, 'only the blocked-here text sends the learner to the standalone copy');
    assert.deepEqual(texts.map((x) => /Use Chrome or Edge/.test(x)), [false, false, false, false, true], 'only the missing-API text says to use Chrome or Edge');
    assert.equal(texts[0], texts[2]);
    assert.equal(texts[1], texts[3]);
    assert.notEqual(texts[0], texts[1]);
    assert.notEqual(texts[1], texts[4]);
    assert.notEqual(texts[0], texts[4]);
  });
});

// ---- A note held while the cable goes -------------------------------------
// Needs a learner on a "both hands together" exercise: seeded level 13, then real
// clicks. The exercise is read from the screen and its pitches from the same
// table the app is built from, looked up here in Node, not in the page.
async function startBothHandsExercise(page) {
  await page.grant(['midi']);
  await midiAddPort(page, 'p1', 'Test Keys');
  await page.clickSelector('#setupBtn');
  await page.clickSelector('#ioBtn');
  await waitConnect(page, false);
  await page.clickSelector('#midiDetailsBtn');
  await page.clickSelector('#playBtn');
  await page.waitFor("/^Play [A-G], both hands together/.test(document.getElementById('prompt').textContent)");
  const letter = (await page.evaluate("document.getElementById('prompt').textContent")).match(/^Play ([A-G]), both hands together/)[1];
  const ex = HANDS_TOGETHER_EXERCISES.find((e) => e.name === letter);
  assert.ok(ex, `no both-hands exercise named ${letter}`);
  return ex;
}
const hex = (note) => `90 ${note.toString(16).padStart(2, '0')} 64`;
async function waitHeard(page, note) {
  await page.waitFor(`(() => { const l = document.getElementById('midiDetailsText').textContent.split('\\n'); return l[l.indexOf('Last messages heard (hex):') + 1] === ${JSON.stringify(hex(note))}; })()`);
}
const readFeedback = (page) => page.evaluate("({ cls: document.getElementById('feedback').className, text: document.getElementById('feedback').textContent })");
const BOTH_HANDS_PASS = /: both hands together\./;

test('a note held when the keyboard is unplugged is let go: after replugging, the left hand alone is not "both hands"', async (t) => {
  await withAcceptancePage(t, { initScript: FAKE_MIDI_BROWSER_PERMISSION_INIT + LEVEL_13_SEED, simulated: [PORTS, SEEDED] }, async (page) => {
    const ex = await startBothHandsExercise(page);
    await midiNoteOn(page, 'p1', ex.rh.midi); // held, no note-off
    await waitHeard(page, ex.rh.midi);
    await midiRemovePort(page, 'p1');
    await waitConnect(page, true); // no device left
    await midiAddPort(page, 'p1', 'Test Keys');
    await waitConnect(page, false);
    await midiNoteOn(page, 'p1', ex.lh.midi);
    await waitHeard(page, ex.lh.midi);
    const fb = await readFeedback(page);
    assert.doesNotMatch(fb.cls, /\bok\b/, `left hand alone was graded as a pass: ${JSON.stringify(fb)}`);
    assert.doesNotMatch(fb.text, BOTH_HANDS_PASS, 'the right hand was let go when its keyboard left');
  });
});

test('control for the test above: with no unplug, the right hand held and then the left hand is "both hands together"', async (t) => {
  await withAcceptancePage(t, { initScript: FAKE_MIDI_BROWSER_PERMISSION_INIT + LEVEL_13_SEED, simulated: [PORTS, SEEDED] }, async (page) => {
    const ex = await startBothHandsExercise(page);
    await midiNoteOn(page, 'p1', ex.rh.midi);
    await waitHeard(page, ex.rh.midi);
    await midiNoteOn(page, 'p1', ex.lh.midi);
    await waitHeard(page, ex.lh.midi);
    await page.waitFor("document.getElementById('feedback').classList.contains('ok')");
    assert.match((await readFeedback(page)).text, BOTH_HANDS_PASS);
  });
});

// F1 (src/app.js wire()): a port that stays listed but reads "disconnected" is let go like an
// unplugged one, so the note it was holding does not make the next single note grade as "both
// hands". Whether a real Chrome keeps an unplugged port listed still needs hardware (Q9).
test('a keyboard that stays listed but reads "disconnected" while a note is held: that note is let go too', async (t) => {
  await withAcceptancePage(t, { initScript: FAKE_MIDI_BROWSER_PERMISSION_INIT + LEVEL_13_SEED, simulated: [PORTS, SEEDED, 'port p1 stays in the MIDI port list but its state flips to disconnected and back'] }, async (page) => {
    const ex = await startBothHandsExercise(page);
    await midiNoteOn(page, 'p1', ex.rh.midi);
    await waitHeard(page, ex.rh.midi);
    await midiSetPortState(page, 'p1', 'disconnected');
    await waitConnect(page, true);
    t.diagnostic(`while the port reads "disconnected" the status says: ${(await readIo(page)).text}`);
    await midiSetPortState(page, 'p1', 'connected');
    await waitConnect(page, false);
    await midiNoteOn(page, 'p1', ex.lh.midi);
    await waitHeard(page, ex.lh.midi);
    const fb = await readFeedback(page);
    assert.doesNotMatch(fb.cls, /\bok\b/, `left hand alone was graded as a pass: ${JSON.stringify(fb)}`);
    assert.doesNotMatch(fb.text, BOTH_HANDS_PASS, 'the right hand was let go when its keyboard left');
  });
});
