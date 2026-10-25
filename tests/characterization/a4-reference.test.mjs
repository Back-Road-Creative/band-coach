// The A4 tuning-reference setting (#optA4, 415..466 Hz). Driven through the
// real control and a real 442 Hz tone in the fake microphone: with A4 = 442 the
// live pitch reading is exactly MIDI 69; at the default 440 it is a little
// sharp. The choice survives a reload, and a nonsense entry snaps back to 440.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage, effectiveWaitMs } from '../helpers/browser.mjs';
import { waitForAudioHeard } from '../helpers/audio-heard.mjs';

function writeSteadyWav(path, { freq, sampleRate = 48000, seconds = 8 }) {
  const n = Math.round(seconds * sampleRate), dataSize = n * 2, buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8, 'ascii'); buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36, 'ascii'); buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.85 * 32767), 44 + i * 2);
  writeFileSync(path, buf); return path;
}
const setA4 = (page, v) => page.evaluate(`(() => { const o = document.getElementById('optA4'); o.value = '${v}'; o.dispatchEvent(new Event('change')); return o.value; })()`);
const stored = "(() => { try { return JSON.parse(localStorage.getItem('bandcoach.v1')).prefs.a4; } catch (e) { return null; } })()";

test('optA4 is a 415..466 number control that defaults to 440', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  assert.equal(await page.evaluate("document.getElementById('optA4').value"), '440');
  assert.equal(await page.evaluate("document.getElementById('optA4').min + '-' + document.getElementById('optA4').max + '/' + document.getElementById('optA4').step"), '415-466/1');
  assert.equal(await setA4(page, 442), '442');
  await page.waitFor(`${stored} === 442`, 10000);
  assert.equal(await setA4(page, 900), '440', 'out of range snaps back to 440');
  assert.equal(await setA4(page, ''), '440', 'empty snaps back to 440');
  await setA4(page, 438);
  await page.waitFor(`${stored} === 438`, 10000);
  await page.reload();
  await page.waitFor('typeof window.__coach !== "undefined"', 8000);
  assert.equal(await page.evaluate("document.getElementById('optA4').value"), '438');
});

test('a 442 Hz tone reads as MIDI 69 when A4 is 442, and a little sharp at 440', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-a4-'));
  const page = await launchPage(HTML_PATH, { fakeAudioFile: writeSteadyWav(join(dir, 'a442.wav'), { freq: 442 }) });
  t.after(() => page.close());
  await page.evaluate("document.querySelector('#picker button[data-mod=\"tuner\"]').click()");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true", effectiveWaitMs(5000));
  await waitForAudioHeard(page);
  const midiNow = async () => { const deadline = Date.now() + effectiveWaitMs(6000); let m = null; while (Date.now() < deadline) { m = await page.evaluate('(() => { const h = window.__coach.heard(); return h && h.freq ? h.midi : null; })()'); if (m !== null) return m; await new Promise((r) => setTimeout(r, 50)); } return m; };
  // The median of 11 readings, not the first one: the first frames after the
  // tone starts can read a few cents off under a loaded CI runner (69.123,
  // about 443 Hz, was seen), and this checks the steady reading.
  const steadyMidi = async () => { const ms = []; for (let i = 0; i < 11; i++) { const m = await midiNow(); if (m !== null) ms.push(m); await new Promise((r) => setTimeout(r, 50)); } ms.sort((a, b) => a - b); return ms.length ? ms[ms.length >> 1] : null; };
  const at440 = await steadyMidi();
  assert.ok(at440 > 69.05 && at440 < 69.11, `A4=440: expected ~69.0785, got ${at440}`);
  await setA4(page, 442);
  let m442 = null; const deadline = Date.now() + effectiveWaitMs(6000);
  while (Date.now() < deadline) { m442 = await midiNow(); if (m442 !== null && Math.abs(m442 - 69) < 0.03) break; }
  assert.ok(Math.abs(m442 - 69) < 0.03, `A4=442: expected ~69, got ${m442}`);
});
