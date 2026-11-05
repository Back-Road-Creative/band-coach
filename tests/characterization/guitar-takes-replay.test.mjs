// Real guitar takes, recorded by the lane's G1 (docs/windows-lane.md), played back through the real
// worklet by Chromium's fake mic: one reply per pluck, the right note, and silence stays unjudged.
// The three made-up takes prove this harness before and without real ones, and judge nothing about a
// real instrument. Passing here is not a real-device check: only G1 itself is.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { writePluckWav } from '../helpers/pluck-wav.mjs';
import { FEEDBACK_RECORDER } from '../fixtures/acceptance/live-capture-wav.mjs';
import { LEAD_SEC, RATE } from '../acceptance/win/g1-guitar-takes.win.mjs';

const REAL = fileURLToPath(new URL('../fixtures/real-guitar/', import.meta.url));
const manifest = JSON.parse(readFileSync(join(REAL, 'manifest.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const judged = (page) => page.evaluate("window.__bcLines.filter((r) => r.el === 'feedback' && (r.cls === 'ok' || r.cls === 'no') && !r.text.startsWith('Time.'))");

// Many elements asking for the take's note, with the time limit out of the way.
const forceTarget = (page, midi) => page.evaluate(`(() => {
  const t = window.__coach.task(); t.limit = 1e9; t.idx = 0;
  const e = t.els[0]; e.info = Object.assign({}, e.info, { midi: ${midi} });
  t.els = Array.from({ length: 50 }, () => Object.assign({}, e));
})()`);

// Chromium loops the file, so any one loop's length holds exactly the take's plucks. The first loop
// only settles the app, because the target is set at a point in the loop nobody controls.
async function replay(t, wav, take) {
  const page = await launchPage(HTML_PATH, { fakeAudioFile: wav, initScript: FEEDBACK_RECORDER });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor('window.__coach.devices().length > 0', 8000);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.cur()', 8000);
  await forceTarget(page, take.midi ?? 40);
  const loop = take.sec * 1000;
  if (take.plucks === 0) {
    await sleep(loop * 1.5);
    assert.deepEqual((await judged(page)).map((r) => r.text), [], `${take.file}: silence was judged`);
    return;
  }
  await sleep(loop);
  const seen = (await judged(page)).length;
  await page.waitFor(`window.__bcLines.filter((r) => r.el === 'feedback' && (r.cls === 'ok' || r.cls === 'no') && !r.text.startsWith('Time.')).length > ${seen}`, loop + 4000);
  const first = (await judged(page))[seen];
  const until = first.t + loop - 700;
  await sleep(loop - 700);
  const replies = (await judged(page)).filter((r) => r.t >= first.t && r.t <= until);
  assert.deepEqual(replies.filter((r) => r.cls !== 'ok').map((r) => r.text), [], `${take.file}: said the wrong note`);
  assert.equal(replies.length, take.plucks, `${take.file}: ${replies.length} replies to ${take.plucks} pluck(s): ${replies.map((r) => r.text).join(' | ')}`);
}

function madeUpTake(file, midi, plucks) {
  const sec = LEAD_SEC + (plucks > 1 ? 5 : 3.5), n = Math.round(sec * RATE), x = new Float32Array(n), f = 440 * Math.pow(2, (midi - 69) / 12);
  for (let p = 0; p < plucks; p++) {
    const from = Math.round((LEAD_SEC + p * 2.5) * RATE);
    for (let k = from; k < n; k++) {
      const s = (k - from) / RATE;
      for (let h = 1; h <= 4; h++) x[k] += (0.2 / h) * Math.sin(2 * Math.PI * f * h * s) * Math.exp(-s / (0.5 + 0.3 * h));
    }
  }
  return { take: { file, midi, plucks, sec }, wav: writePluckWav(join(mkdtempSync(join(tmpdir(), 'take-')), file), x, RATE) };
}

describe('takes through the real worklet', { concurrency: 3 }, () => {
  for (const [file, midi, plucks] of [['made-up-one.wav', 55, 1], ['made-up-twice.wav', 55, 2], ['made-up-room.wav', 40, 0]]) {
    test(`${file} (the harness, not a guitar)`, async (t) => {
      const { take, wav } = madeUpTake(file, midi, plucks);
      await replay(t, wav, take);
    });
  }
  for (const take of manifest) test(`${take.file}: ${take.kind}`, (t) => replay(t, join(REAL, take.file), take));
});
