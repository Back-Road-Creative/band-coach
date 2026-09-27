// User reports (field): "the midi connection for the keyboard doesnt seem to
// work"; "the midi shows connected, but keyboard input isnt registered";
// "no key lit up"; "(with an exercise running) the d key lit up but when i
// hit the keyboard keys nothing happened". Root cause on the user's own
// machine is unknown and unknowable from here -- these tests instead pin
// down two things: (1) the REAL path (a fake Web MIDI port feeding the
// app's actual `ioBtn` click handler, not the debug hook) still judges a
// note and still picks up a hot-plugged device, and (2) "connected" is now
// EARNED -- a port that fails to open, or a browser with no Web MIDI at
// all, gets a truthful status instead of a green light for nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort, midiRemovePort, midiSend, midiNoteOn, midiNoteOff, midiSetOpenResult, midiReject, midiMakeUnavailable } from '../helpers/fake-midi.mjs';

const htmlPath = HTML_PATH;

async function connectMidi(page) {
  await page.evaluate("document.getElementById('ioBtn').click()");
}

// ---------- characterization: the real ioBtn path already does this ----------

test('CURRENT: a real MIDI note-on through the fake port is judged during a running keyboard exercise', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await midiAddPort(page, 'p1', 'Test Keys');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioText').textContent.length > 0");

  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const midi = await page.evaluate('window.__coach.cur().info.midi');

  await midiNoteOn(page, 'p1', midi);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");
});

test('CURRENT: a device plugged in after Connect is picked up without another click (hot-plug)', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === false"); // no device yet -> still asking to connect

  await midiAddPort(page, 'p1', 'Hot-plugged Keys');
  await page.waitFor("document.getElementById('ioBtn').hidden === true");

  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await midiNoteOn(page, 'p1', midi);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");
});

// ---------- new behaviour: "connected" is earned ----------

test('NEW: a port whose open() rejects (in use elsewhere) is not counted as connected, and says so', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await midiAddPort(page, 'p1', 'Busy Keys');
  await midiSetOpenResult(page, 'p1', false);
  await connectMidi(page);
  await page.waitFor("/another program/i.test(document.getElementById('ioText').textContent)");

  const text = await page.evaluate("document.getElementById('ioText').textContent");
  assert.match(text, /another program/i);
  assert.equal(await page.evaluate("document.getElementById('ioBtn').hidden"), false, 'still asking to connect: nothing actually opened');
});

test('NEW: a disconnected port is not counted even though the input map still lists it', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await midiAddPort(page, 'p1', 'Ghost Keys', 'disconnected');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioText').textContent.length > 0");
  assert.equal(await page.evaluate("document.getElementById('ioBtn').hidden"), false);
});

test('NEW: status names the device and says "found" before any byte, then "is working" after the first byte', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await midiAddPort(page, 'p1', 'Test Keys');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");

  const before = await page.evaluate("document.getElementById('ioText').textContent");
  assert.match(before, /Test Keys/);
  assert.match(before, /found/i);
  assert.doesNotMatch(before, /is working/i);

  await midiSend(page, 'p1', [0x90, 60, 100]);
  await page.waitFor("document.getElementById('ioText').textContent.indexOf('is working') >= 0");
});

test('NEW: multiple connected devices are each named in the status', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await midiAddPort(page, 'p1', 'Keys One');
  await midiAddPort(page, 'p2', 'Keys Two');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");

  const text = await page.evaluate("document.getElementById('ioText').textContent");
  assert.match(text, /Keys One/);
  assert.match(text, /Keys Two/);
});

test('NEW: a visible MIDI-activity blink fires on any byte, even with no exercise running', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await midiAddPort(page, 'p1', 'Test Keys');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");

  assert.equal(await page.evaluate("document.getElementById('midiActDot').classList.contains('on')"), false);
  await midiSend(page, 'p1', [0x90, 60, 100]);
  await page.waitFor("document.getElementById('midiActDot').classList.contains('on') === true");
});

test('NEW: a key played with no exercise running says plainly which note was heard', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await midiAddPort(page, 'p1', 'Test Keys');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");

  await midiNoteOn(page, 'p1', 60);
  await page.waitFor("document.getElementById('coach').textContent.length > 0");
  const text = await page.evaluate("document.getElementById('coach').textContent");
  assert.match(text, /heard/i);
});

test('NEW: a key played outside the keyboard drawing\'s current range says it was heard but not shown', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await midiAddPort(page, 'p1', 'Test Keys');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  // The drawn range tops out at 72 (see src/app.js kbdRange()); 84 is a full octave above it.
  await midiNoteOn(page, 'p1', 84);
  await page.waitFor("document.getElementById('coach').textContent.length > 0");
  const text = await page.evaluate("document.getElementById('coach').textContent");
  assert.match(text, /heard/i);
  assert.match(text, /not.*(shown|drawn|screen)/i);
});

test('NEW: hands-together grades from real note-on/note-off state, not a 600ms timer, over MIDI', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate('window.__coach.state().level = 13');
  await midiAddPort(page, 'p1', 'Test Keys');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  assert.equal(info.kind, 'hands-together');

  // Hold the right-hand note well past 600ms (the old timer window), THEN
  // add the left-hand note. A real player holding a chord for a second is
  // normal; the old 0.6s-since-note-on window would have expired and failed
  // to see the right hand as still "held" by the time the left hand landed.
  await midiNoteOn(page, 'p1', info.ex.rh.midi);
  await new Promise((r) => setTimeout(r, 900));
  await midiNoteOn(page, 'p1', info.ex.lh.midi);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");
});

test('NEW: a note-off releases a held hands-together note from the real held set', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate('window.__coach.state().level = 13');
  await midiAddPort(page, 'p1', 'Test Keys');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  await midiNoteOn(page, 'p1', info.ex.rh.midi);
  await midiNoteOff(page, 'p1', info.ex.rh.midi);
  await new Promise((r) => setTimeout(r, 20));
  await midiNoteOn(page, 'p1', info.ex.lh.midi);
  await new Promise((r) => setTimeout(r, 50));
  // Right hand was released before the left hand landed: not both held together.
  assert.notEqual(await page.evaluate("document.getElementById('feedback').className"), 'ok');
});

test('NEW: the "MIDI details" readout names each port\'s state, connection and open result', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await midiAddPort(page, 'p1', 'Test Keys');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  await midiSend(page, 'p1', [0x90, 60, 100]);

  await page.evaluate("document.getElementById('midiDetailsBtn').click()");
  await page.waitFor("document.getElementById('midiDetails').hidden === false");
  const text = await page.evaluate("document.getElementById('midiDetailsText').textContent");
  assert.match(text, /Test Keys/);
  assert.match(text, /connected/i);
  assert.match(text, /90 3c 64/i); // the raw note-on hex we just sent
});

test('NEW: no Web MIDI API at all keeps the existing truthful message', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await midiMakeUnavailable(page);
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioText').textContent.length > 0");
  const text = await page.evaluate("document.getElementById('ioText').textContent");
  assert.match(text, /cannot read MIDI/i);
});

// ---------- new behaviour: held notes are per-device, and released on
// key-up / blur / hidden / unplug rather than only on a matching note-off ----------

test('NEW: a note-off from a second port does not release a note still held on the first port', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate('window.__coach.state().level = 13');
  await midiAddPort(page, 'p1', 'Keys One');
  await midiAddPort(page, 'p2', 'Keys Two');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  // rh held on p1; the SAME pitch is never sent on p2 here -- p2's own
  // note-off for a pitch it never turned on must not cancel p1's hold.
  await midiNoteOn(page, 'p1', info.ex.rh.midi);
  await midiNoteOff(page, 'p2', info.ex.rh.midi);
  await midiNoteOn(page, 'p1', info.ex.lh.midi);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");
});

test('NEW: window blur releases every held MIDI note', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate('window.__coach.state().level = 13');
  await midiAddPort(page, 'p1', 'Test Keys');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  await midiNoteOn(page, 'p1', info.ex.rh.midi);
  await page.evaluate("window.dispatchEvent(new Event('blur'))");
  await midiNoteOn(page, 'p1', info.ex.lh.midi);
  await new Promise((r) => setTimeout(r, 50));
  // rh was released by the blur, so the left hand landing alone is not both hands together.
  assert.notEqual(await page.evaluate("document.getElementById('feedback').className"), 'ok');
});

// Going hidden also takes a break (existing behaviour: the exercise itself
// pauses, task becomes null), which would make a hands-together check pass
// trivially -- onNote() no-ops the moment there is no task, whether or not
// the held note was ever released. So this one reads the held-note ledger
// directly instead of routing through grading, same evidence as the
// computer-key test below.
test('NEW: the tab going hidden releases every held MIDI note', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await midiAddPort(page, 'p1', 'Test Keys');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");

  await midiNoteOn(page, 'p1', 60);
  assert.deepEqual(await page.evaluate('window.__coach.heldNotes()'), [60]);

  await page.evaluate(
    "Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'))"
  );
  assert.deepEqual(await page.evaluate('window.__coach.heldNotes()'), []);
});

test('NEW: unplugging a MIDI port releases the notes it was holding', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate('window.__coach.state().level = 13');
  await midiAddPort(page, 'p1', 'Test Keys');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  await midiNoteOn(page, 'p1', info.ex.rh.midi);
  await midiRemovePort(page, 'p1');
  await page.waitFor("document.getElementById('ioBtn').hidden === false"); // no device left -> back to asking to connect
  await midiAddPort(page, 'p1', 'Test Keys');
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  await midiNoteOn(page, 'p1', info.ex.lh.midi);
  await new Promise((r) => setTimeout(r, 50));
  // rh was released when the port that held it was unplugged, so a fresh
  // connection sending only the left hand is not both hands together.
  assert.notEqual(await page.evaluate("document.getElementById('feedback').className"), 'ok');
});

test('NEW: releasing a computer key on key-up drops it from the held-note ledger', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))");
  const heldAfterDown = await page.evaluate('window.__coach.heldNotes()');
  assert.ok(heldAfterDown.length > 0, 'expected the computer key to be tracked as held after keydown');

  await page.evaluate("document.dispatchEvent(new KeyboardEvent('keyup', { key: 'a' }))");
  const heldAfterUp = await page.evaluate('window.__coach.heldNotes()');
  assert.deepEqual(heldAfterUp, []);
});

test('NEW: permission denied says so plainly', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await midiReject(page);
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioText').textContent.length > 0");
  const text = await page.evaluate("document.getElementById('ioText').textContent");
  assert.match(text, /blocked/i);
});
