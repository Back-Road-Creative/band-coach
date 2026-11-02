// Field report (v1.11.0, 2026-11-02): connecting a drum kit could not be
// diagnosed. The Store app said "Chrome asked ... the answer was no" although it
// is not Chrome and no box ever appears. Chrome, with no kit seen, quietly opened
// the microphone and left the status line on "MIDI is optional". These tests
// drive the real Set up input / Connect clicks and read what the learner sees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort, midiSetOpenResult, midiMakeUnavailable } from '../helpers/fake-midi.mjs';

const MIC_OK = `navigator.mediaDevices.getUserMedia = async function () { return new AudioContext().createMediaStreamDestination().stream; };`;
const MIC_BLOCKED = `navigator.mediaDevices.getUserMedia = async function () { throw new DOMException('simulated', 'NotAllowedError'); };`;
const NO_SERVICE = `
  const realRequest = navigator.requestMIDIAccess;
  Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: function () {
    if (window.__midiRefuseNext) { window.__midiRefuseNext = false; return Promise.reject(new DOMException('Permission to use Web MIDI API was not granted.', 'NotAllowedError')); }
    if (window.__noMidiService) return Promise.reject(new DOMException('Platform dependent initialization failed.', 'InvalidStateError'));
    return realRequest.call(navigator);
  } });
`;
const STORE = `document.documentElement.setAttribute('data-shell', 'store');`;
const ioText = (page) => page.evaluate("document.getElementById('ioText').textContent");
const ioBtn = (page, prop) => page.evaluate(`document.getElementById('ioBtn').${prop}`);

async function open(t, { mod = 'drum-kit', mic = MIC_OK, store = false } = {}) {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT + mic + NO_SERVICE });
  t.after(() => page.close());
  if (store) await page.evaluate(STORE);
  await page.evaluate(`window.__coach.setMod('${mod}')`);
  await page.evaluate("document.getElementById('setupBtn').click()");
  return page;
}
const midiReject = (page) => page.evaluate('window.__midiRefuseNext = true');
const connect = (page) => page.evaluate("document.getElementById('ioBtn').click()");
const waitIo = (page, re) => page.waitFor(`${re}.test(document.getElementById('ioText').textContent)`);

test('kit, no MIDI device: says no kit was found, what to check, and that the mic is listening', async (t) => {
  const page = await open(t);
  await connect(page);
  await waitIo(page, '/No drum kit found/');
  const text = await ioText(page);
  assert.match(text, /USB/);
  assert.match(text, /5-pin/);
  assert.match(text, /listening through your microphone/i);
  assert.match(text, /kick, snare and hi-hat/);
  assert.doesNotMatch(text, /MIDI is optional/);
  assert.match(await page.evaluate("document.getElementById('ioDot').className"), /\bon\b/);
});

test('kit plugged in after the mic fallback: the mic sentence goes and the kit is named', async (t) => {
  const page = await open(t);
  await connect(page);
  await waitIo(page, '/No drum kit found/');
  await midiAddPort(page, 'k1', 'Roland TD');
  await waitIo(page, '/Roland TD found/');
  const text = await ioText(page);
  assert.match(text, /Hit any pad/);
  assert.doesNotMatch(text, /No drum kit found|microphone|Press any key/);
});

test('kit, no MIDI device and the mic blocked: says nothing can hear the drums', async (t) => {
  const page = await open(t, { mic: MIC_BLOCKED });
  await connect(page);
  await waitIo(page, '/No drum kit found/');
  assert.match(await ioText(page), /nothing can hear your drums/);
  assert.match(await page.evaluate("document.getElementById('ioDot').className"), /\boff\b/);
});

test('Store app, kit, MIDI refused: blames the app, not Chrome, and the mic takes over', async (t) => {
  const page = await open(t, { store: true });
  await midiReject(page);
  await connect(page);
  await waitIo(page, '/Band Coach could not get access to MIDI/');
  const text = await ioText(page);
  assert.doesNotMatch(text, /Chrome|address bar|browser/i);
  assert.match(text, /not your drum kit/);
  assert.match(text, /Copy diagnostics/);
  assert.match(text, /listening through your microphone/i);
  assert.equal(await ioBtn(page, 'hidden'), false);
  assert.equal(await ioBtn(page, 'textContent'), 'Try MIDI again');
});

test('Store app, keyboard, MIDI refused: no Chrome advice, retry offered, and no mic is opened', async (t) => {
  const page = await open(t, { mod: 'kbd', store: true, mic: MIC_BLOCKED });
  await midiReject(page);
  await connect(page);
  await waitIo(page, '/Band Coach could not get access to MIDI/');
  const text = await ioText(page);
  assert.doesNotMatch(text, /Chrome|address bar/i);
  assert.match(text, /not your keyboard/);
  assert.match(text, /practice, not proof/);
  assert.equal(await ioBtn(page, 'textContent'), 'Try MIDI again');
});

test('Store app, no MIDI service: never says "browser"', async (t) => {
  const page = await open(t, { mod: 'kbd', store: true });
  await page.evaluate('window.__noMidiService = true');
  await connect(page);
  await waitIo(page, '/could not reach MIDI/');
  assert.doesNotMatch(await ioText(page), /browser/i);
});

test('Chrome, kit, MIDI refused: keeps the Chrome advice, drops the keyboard line, mic takes over', async (t) => {
  const page = await open(t);
  await midiReject(page);
  await connect(page);
  await waitIo(page, '/Chrome asked/');
  const text = await ioText(page);
  assert.match(text, /address bar/);
  assert.doesNotMatch(text, /real keyboard/);
  assert.match(text, /listening through your microphone/i);
  assert.equal(await ioBtn(page, 'textContent'), 'Try MIDI again');
});

test('MIDI details shows the exact refusal, and a later success clears it', async (t) => {
  const page = await open(t, { store: true });
  await midiReject(page);
  await connect(page);
  await waitIo(page, '/Band Coach could not get access to MIDI/');
  await page.evaluate("document.getElementById('midiDetailsBtn').click()");
  assert.match(await page.evaluate("document.getElementById('midiDetailsText').textContent"), /Last MIDI error: NotAllowedError/);
  await midiAddPort(page, 'k1', 'Roland TD');
  await connect(page);
  await waitIo(page, '/Roland TD found/');
  await page.evaluate("document.getElementById('midiDetailsBtn').click(); document.getElementById('midiDetailsBtn').click()");
  assert.doesNotMatch(await page.evaluate("document.getElementById('midiDetailsText').textContent"), /Last MIDI error/);
});

test('kit held by another program says drum kit, not keyboard', async (t) => {
  const page = await open(t);
  await midiAddPort(page, 'k1', 'Roland TD');
  await midiSetOpenResult(page, 'k1', false);
  await connect(page);
  await waitIo(page, '/Another program/');
  assert.match(await ioText(page), /using this drum kit/);
});

test('browser with no Web MIDI, kit: says so rather than opening the mic in silence', async (t) => {
  const page = await open(t);
  await midiMakeUnavailable(page);
  await connect(page);
  await waitIo(page, '/cannot read MIDI/');
  assert.match(await ioText(page), /listening through your microphone/i);
});

test("the keyboard range button is not offered on a drum kit", async (t) => {
  const page = await open(t);
  assert.equal(await page.evaluate("document.getElementById('midiRangeBtn').hidden"), true);
  await page.evaluate("window.__coach.setMod('kbd')");
  assert.equal(await page.evaluate("document.getElementById('midiRangeBtn').hidden"), false);
});
