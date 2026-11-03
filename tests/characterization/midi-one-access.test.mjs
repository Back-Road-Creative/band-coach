import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchPage } from '../helpers/browser.mjs';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { FAKE_MIDI_INIT, midiNoteOn } from '../helpers/fake-midi.mjs';

// The page keeps ONE MIDI access (audit F10): every Connect press used to make a new
// requestMIDIAccess and never release the old one. Counts every call the app makes.
const INIT = FAKE_MIDI_INIT + `
  (function () { const real = navigator.requestMIDIAccess; window.__midiCalls = 0; window.__denyNext = false; Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: function () { window.__midiCalls += 1; if (window.__denyNext) { window.__denyNext = false; return Promise.reject(new DOMException('dismissed', 'NotAllowedError')); } return real.call(this); } }); })();
`;
const prompt = page => page.evaluate("document.getElementById('kitLearnStatus').textContent");
const calls = page => page.evaluate('window.__midiCalls');
const press = (page, n = 1) => page.evaluate(`(() => { for (let i = 0; i < ${n}; i++) document.getElementById('ioBtn').click(); })()`);
const open = async t => { const page = await launchPage(HTML_PATH, { initScript: INIT }); t.after(() => page.close()); return page; };

test('control: one press with the kit present, then one note, advances the walk-through once', async t => {
  const page = await open(t);
  await page.evaluate("window.__coach.setMod('drum-kit'); window.__midiAddPort('p1', 'XKORCE Kit', 'connected')");
  await press(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  await page.evaluate("document.getElementById('setupBtn').click(); document.getElementById('kitLearn').click()");
  assert.match(await prompt(page), /Kick/);
  await midiNoteOn(page, 'p1', 60);
  assert.match(await prompt(page), /Snare/, 'one note, one pad');
  assert.equal(await calls(page), 1);
});

test('two presses with no kit present, then the kit plugged in, then one note: the walk-through advances once', async t => {
  const page = await open(t);
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await press(page, 2);
  await page.waitFor("document.getElementById('ioText').textContent.trim() !== ''");
  await page.evaluate("document.getElementById('setupBtn').click(); document.getElementById('kitLearn').click()");
  await page.evaluate("window.__midiAddPort('p1', 'XKORCE Kit', 'connected')");
  await page.waitFor("window.__midiPorts.get('p1').onmidimessage || (window.__midiAccesses.every(a => { let ok = false; a.inputs.forEach(i => { if (i.onmidimessage) ok = true; }); return ok; }))", 5000);
  assert.match(await prompt(page), /Kick/);
  await midiNoteOn(page, 'p1', 60);
  assert.match(await prompt(page), /Snare/, 'advanced one pad, not two');
  const listening = await page.evaluate("window.__midiAccesses.map(a => { let n = 0; a.inputs.forEach(i => { if (i.onmidimessage) n++; }); return n; })");
  assert.ok(listening.reduce((a, b) => a + b, 0) <= 1, 'at most one live listener across every access, saw ' + JSON.stringify(listening));
});

test('two quick presses share one request, and a later press reuses the access', async t => {
  const page = await open(t);
  await press(page, 2);
  await page.waitFor("document.getElementById('ioText').textContent.trim() !== ''");
  assert.equal(await calls(page), 1, 'one request for two quick presses');
  await press(page);
  assert.equal(await calls(page), 1, 'the access already granted is reused');
});

test('a refused request is not kept: pressing Connect again asks again', async t => {
  const page = await open(t);
  await page.evaluate('window.__denyNext = true');
  await press(page);
  await page.waitFor("document.getElementById('ioBtn').textContent === 'Try MIDI again'");
  assert.equal(await calls(page), 1);
  await press(page);
  await page.waitFor("document.getElementById('ioBtn').textContent !== 'Try MIDI again'");
  assert.equal(await calls(page), 2, 'asked again');
  assert.equal(await page.evaluate('window.__midiAccesses.length'), 1, 'and got one access');
});
