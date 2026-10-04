// Canvas text is drawn in canvas pixels, and the canvas is 2x its CSS width on
// a phone (see size() in src/app.js), so a fixed pixel floor is half as big on
// screen. This pins what a learner sees: tuner labels readable in CSS pixels,
// a tuned string's row label kept inside its row (clear of the reference-tone
// button), and a long verdict kept inside the canvas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage, effectiveWaitMs } from '../helpers/browser.mjs';
import { waitForAudioHeard } from '../helpers/audio-heard.mjs';

// Every fillText of this frame: text, font px (canvas pixels), x, align, measured width.
const SPY = `
  window.__ct = [];
  (function () {
    var proto = CanvasRenderingContext2D.prototype, orig = proto.fillText, clr = proto.clearRect;
    proto.clearRect = function () { window.__ct = []; return clr.apply(this, arguments); };
    proto.fillText = function (s) { window.__ct.push({ s: String(s), px: parseFloat(this.font.match(/([0-9.]+)px/)[1]), x: arguments[1], y: arguments[2], align: this.textAlign, w: this.measureText(String(s)).width }); return orig.apply(this, arguments); };
  })();
`;
const PHONE = { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 };
const KPX = "document.getElementById('cv').width / document.getElementById('cv').getBoundingClientRect().width";

function writeSteadyWav(path, freq, seconds = 8, sampleRate = 48000) {
  const n = Math.round(seconds * sampleRate), buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8, 'ascii'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36, 'ascii'); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * i / sampleRate) * 0.85 * 32767), 44 + i * 2);
  writeFileSync(path, buf); return path;
}

test('tuner labels are readable on a phone and a tuned row label stays inside its row', async (t) => {
  const wav = writeSteadyWav(join(mkdtempSync(join(tmpdir(), 'band-coach-wav-')), 'e2.wav'), 82.41);
  const page = await launchPage(HTML_PATH, { initScript: SPY, fakeAudioFile: wav });
  t.after(() => page.close());
  await page.setViewport(PHONE);
  await page.evaluate("document.querySelector('#picker button[data-mod=\"tuner\"]').click()");
  const k = await page.evaluate(KPX);
  await page.waitFor('window.__ct.some(x => x.s === "play one string" || x.s === "press Connect first")');
  const css = (s) => page.evaluate(`(() => { const e = window.__ct.filter(x => x.s === ${JSON.stringify(s)}); return e.length ? Math.min(...e.map(x => x.px)) / (${KPX}) : null; })()`);
  assert.ok(await css('flat') >= 10.5, 'flat/sharp are at least 10.5 CSS px, got ' + await css('flat'));
  assert.ok(await css('press Connect first') >= 12, 'the gauge message is at least 12 CSS px, got ' + await css('press Connect first'));

  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true", effectiveWaitMs(5000));
  await waitForAudioHeard(page);
  await page.waitFor('window.__ct.some(x => /in tune|\u2713/.test(x.s) && /^String/.test(x.s))', effectiveWaitMs(15000));
  const d = await page.evaluate(`(() => { const W = document.getElementById('cv').width, H = document.getElementById('cv').height, rows = window.__ct.filter(x => /^String/.test(x.s)), play = window.__ct.find(x => x.s === '♪'), hold = window.__ct.find(x => /to confirm|tuned, holding/.test(x.s)), verdict = window.__ct.find(x => /cents|in tune$/.test(x.s) && x.align === 'center'); return { W, H, rows, playX: play && play.x, hold, verdict }; })()`);
  // the reference-tone button starts at (play centre - playW/2); the row text must end before it
  const playW = Math.min(d.W * 0.05, d.H * 0.5 / 6 - 8), btnLeft = d.playX - playW / 2;
  for (const r of d.rows) assert.ok(r.x + r.w <= btnLeft, `"${r.s}" ends at ${r.x + r.w}, under the button at ${btnLeft}`);
  const small = d.rows.filter(r => r.px / k < 9);
  assert.equal(small.length, 0, 'row labels are at least 9 CSS px: ' + JSON.stringify(small.map(r => [r.s, r.px / k])));
  if (d.hold) assert.ok(d.hold.px / k >= 10.5, 'the hold line is at least 10.5 CSS px, got ' + d.hold.px / k);
});

test('a long tuner verdict stays inside the canvas at a narrow desktop size', async (t) => {
  const wav = writeSteadyWav(join(mkdtempSync(join(tmpdir(), 'band-coach-wav-')), 'a440.wav'), 440);
  const page = await launchPage(HTML_PATH, { initScript: SPY, fakeAudioFile: wav });
  t.after(() => page.close());
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.evaluate("document.querySelector('#picker button[data-mod=\"tuner\"]').click()");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true", effectiveWaitMs(5000));
  await waitForAudioHeard(page);
  await page.waitFor('window.__ct.some(x => /cents (sharp|flat)/.test(x.s))', effectiveWaitMs(15000));
  const v = await page.evaluate(`(() => { const e = window.__ct.find(x => /cents (sharp|flat)/.test(x.s)); return { x: e.x, w: e.w, W: document.getElementById('cv').width }; })()`);
  assert.ok(v.x - v.w / 2 >= 0 && v.x + v.w / 2 <= v.W, `verdict spans ${v.x - v.w / 2}..${v.x + v.w / 2} of ${v.W}`);
});
