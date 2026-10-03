// A microphone track that ends (a USB mic unplugged, a revoked permission) used
// to leave the app saying 'Listening through your microphone.' with Connect
// hidden: nothing listened for the track ending, so micReady stayed true. The
// app now reacts: it stops treating the microphone as connected, shows the
// not-connected text and the Connect button, and discards a room check that was
// still running. An old stream's end (after a device switch) must not tear
// down the NEW stream.
//
// A real unplug cannot be driven here, so 'ended' is dispatched on a captured
// track. initScript (runs before ANY page script, per tests/helpers/browser.mjs)
// wraps getUserMedia to keep each stream on window.__streams and pass the real
// stream through. A real end is stop() plus an 'ended' event (stop() alone
// fires none): endTracks(i). fireEnded(i) is the event alone, so the handler's
// own stop() can be seen. dispatchEvent is synchronous: the listener has run
// when the call returns. Whether Chrome fires 'ended' for an unplugged device
// needs hardware.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LISTENING = 'Listening through your microphone.';
const NOT_CONNECTED = 'This one listens through a microphone or audio interface.';
const CHECKING = 'Checking the room — stay quiet for a moment…';

const CAPTURE_STREAMS_SCRIPT = `
  window.__streams = [];
  const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async function (...args) {
    const st = await origGetUserMedia(...args);
    window.__streams.push(st);
    return st;
  };
  window.endTracks = (i) => window.__streams[i].getTracks().forEach((t) => { t.stop(); t.dispatchEvent(new Event('ended')); });
  window.fireEnded = (i) => window.__streams[i].getTracks().forEach((t) => t.dispatchEvent(new Event('ended')));
`;

const io = (page) => page.evaluate("({ text: document.getElementById('ioText').textContent, dot: document.getElementById('ioDot').className, btnHidden: document.getElementById('ioBtn').hidden, btnText: document.getElementById('ioBtn').textContent, meterHidden: document.getElementById('practiceMeter').hidden })");
const states = (page, i) => page.evaluate(`window.__streams[${i}].getTracks().map((t) => t.readyState)`);

async function connected(t) {
  const page = await launchPage(HTML_PATH, { initScript: CAPTURE_STREAMS_SCRIPT });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor(`document.getElementById('ioBtn').hidden && document.getElementById('ioText').textContent === ${JSON.stringify(LISTENING)}`, 8000);
  return page;
}

test('T1 the track ends: the app stops saying it is listening and offers Connect', async (t) => {
  const page = await connected(t);
  // The meter is shown once the microphone is up (the pitch worklet shows it): without this the hidden check below would prove nothing.
  await page.waitFor("document.getElementById('practiceMeter').hidden === false", 5000);
  await page.evaluate('window.fireEnded(0)');
  const s = await io(page);
  assert.equal(s.text, NOT_CONNECTED, 'the not-connected text is back');
  assert.ok(!s.btnHidden, 'Connect is offered again');
  assert.equal(s.btnText, 'Connect microphone');
  assert.doesNotMatch(s.dot, /\bon\b/, `the status dot is not on: ${s.dot}`);
  assert.ok(s.meterHidden, 'the practice meter is hidden');
  // fireEnded never stops a track, so only the handler's own stop() can have ended these.
  assert.deepEqual(await states(page, 0), ['ended'], 'the app released the ended microphone');
});

test('T2 the guard: the OLD stream ending after a device switch leaves the new stream alone', async (t) => {
  const page = await connected(t);
  await page.waitFor('window.__coach.devices().length > 1', 5000);
  const ids = await page.evaluate('window.__coach.devices().map(d => d.deviceId)');
  assert.ok(ids.length > 1, 'this test needs at least two distinct fake input devices');
  await page.evaluate(`(function () { const sel = document.getElementById('micDeviceSelect'); sel.value = ${JSON.stringify(ids[1])}; sel.dispatchEvent(new Event('change')); })()`);
  await page.waitFor('window.__streams.length === 2', 8000);
  await page.waitFor(`document.getElementById('ioBtn').hidden && document.getElementById('ioText').textContent === ${JSON.stringify(LISTENING)}`, 8000);
  await page.evaluate('window.endTracks(0)');
  const s = await io(page);
  assert.equal(s.text, LISTENING, 'the new stream is still listened to');
  assert.ok(s.btnHidden, 'Connect stays hidden');
  assert.deepEqual(await states(page, 1), ['live'], 'the new stream is still live');
});

test('T3 reconnect after the end: Connect works again and the new stream has its own listener', async (t) => {
  const page = await connected(t);
  await page.evaluate('window.endTracks(0)');
  assert.ok(!(await io(page)).btnHidden, 'Connect is offered after the track ended');
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor(`document.getElementById('ioBtn').hidden && document.getElementById('ioText').textContent === ${JSON.stringify(LISTENING)}`, 8000);
  assert.equal(await page.evaluate('window.__streams.length'), 2, 'a second microphone stream was opened');
  assert.deepEqual(await states(page, 1), ['live']);
  await page.evaluate('window.endTracks(1)');
  const s = await io(page);
  assert.equal(s.text, NOT_CONNECTED, 'the second end is noticed too');
  assert.ok(!s.btnHidden, 'Connect shows again');
});

test('T4 the track ends during the first room check: that check says nothing and stores nothing', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: CAPTURE_STREAMS_SCRIPT });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('gtr')");
  assert.equal(await page.evaluate('window.__coach.db().prefs.noiseFloor'), null, 'a fresh profile: no floor, so Connect starts a room check');
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor(`document.getElementById('calibrateResult').textContent === ${JSON.stringify(CHECKING)}`, 8000);
  await page.evaluate('window.endTracks(0)');
  // The check resolves 1.5 s after its first signal, or after 3 s with none; the text is only '' once it has resolved as stale, so wait it out.
  await sleep(3500);
  assert.equal(await page.evaluate("document.getElementById('calibrateResult').textContent"), '', 'the stale check wrote nothing');
  assert.equal(await page.evaluate('window.__coach.db().prefs.noiseFloor'), null, 'and stored no floor');
});
