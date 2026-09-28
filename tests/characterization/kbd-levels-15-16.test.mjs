// Levels 15-16 ("held bass under the melody" / "different rhythms in each
// hand"): two more LEARN-then-CHECK stages built on the same five
// hands-together pairs as level 14 (tests/characterization/
// kbd-level14-rhythm.test.mjs, whose harness this borrows). Real entry
// points throughout: a fake MIDI port through the real ioBtn click handler,
// real DOM keydown/keyup, and a real canvas pointerdown -- window.__coach is
// only ever used here to read state (cur(), db(), state(), kbdKeys()).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort } from '../helpers/fake-midi.mjs';
import { isIndependentOk } from '../../src/core/learning-events.js';
import { heldBassMelody } from '../../src/core/hands-together.js';

const htmlPath = HTML_PATH;

async function connectMidi(page) {
  await page.evaluate("document.getElementById('ioBtn').click()");
}

async function toLevel(page, n) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate(`window.__coach.state().level = ${n}`);
  await page.evaluate("window.__coach.setMod('kbd')");
}

function onBytes(note, on) {
  return [(on ? 0x90 : 0x80), note, on ? 100 : 0];
}

async function clearFeedback(page) {
  await page.evaluate("document.getElementById('feedback').className = ''; document.getElementById('feedback').textContent = '';");
}

async function sendOne(page, port, note, on) {
  await page.evaluate(`window.__midiSend('${port}', [${onBytes(note, on).join(',')}])`);
}

async function learnPass(page, port, rh, lh) {
  await page.evaluate(`(function () {
    window.__midiSend('${port}', [${onBytes(rh, true).join(',')}]);
    window.__midiSend('${port}', [${onBytes(lh, true).join(',')}]);
  })()`);
  await page.waitFor("window.__coach.cur() && window.__coach.cur().pair && window.__coach.cur().pair.phase === 'check'");
  await page.evaluate(`(function () {
    window.__midiSend('${port}', [${onBytes(rh, false).join(',')}]);
    window.__midiSend('${port}', [${onBytes(lh, false).join(',')}]);
  })()`);
  await clearFeedback(page);
}

async function startTask(page, level) {
  await toLevel(page, level);
  await midiAddPort(page, 'p1', 'Test Keys');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
}

test('level 15: label, review note, and level-14/13 UI are absent', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await toLevel(page, 15);

  const reviewText = await page.evaluate("document.getElementById('kbdHeldReview').textContent");
  assert.match(reviewText, /Not yet checked by a player/);
  assert.equal(await page.evaluate("document.getElementById('kbdBothLock')"), null);
  assert.equal(await page.evaluate("document.getElementById('kbdRhythmNote')"), null);

  assert.deepEqual(page.exceptions, []);
});

test('level 15: releasing the bass before the melody finishes fails with a hold reason, and the element is not passed', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await startTask(page, 15);

  const id = await page.evaluate('window.__coach.cur().id');
  assert.match(id, /^j\dh$/);
  const info = await page.evaluate('window.__coach.cur().info');
  const rh = info.ex.rh.midi, lh = info.ex.lh.midi;

  await learnPass(page, 'p1', rh, lh);
  const idBefore = await page.evaluate('window.__coach.cur().id');

  // CHECK: bass on, first melody note on then off, then bass off (too soon).
  await page.evaluate(`(function () {
    window.__midiSend('p1', [${onBytes(lh, true).join(',')}]);
    window.__midiSend('p1', [${onBytes(rh, true).join(',')}]);
    window.__midiSend('p1', [${onBytes(rh, false).join(',')}]);
    window.__midiSend('p1', [${onBytes(lh, false).join(',')}]);
  })()`);

  await page.waitFor("document.getElementById('feedback').className === 'no'");
  const msg = await page.evaluate("document.getElementById('feedback').textContent");
  assert.match(msg, /left hand/i);
  assert.match(msg, /hold/i);

  const idAfter = await page.evaluate('window.__coach.cur().id');
  assert.equal(idAfter, idBefore, 'a failed element is not passed on to the next one');

  assert.deepEqual(page.exceptions, []);
});

test('level 15: a full held-bass pass', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await startTask(page, 15);

  const info = await page.evaluate('window.__coach.cur().info');
  const rh = info.ex.rh.midi, lh = info.ex.lh.midi;
  const melody = heldBassMelody(info.ex);

  await learnPass(page, 'p1', rh, lh);

  await sendOne(page, 'p1', lh, true);
  for (const n of melody) {
    await sendOne(page, 'p1', n.midi, true);
    await sendOne(page, 'p1', n.midi, false);
  }
  await sendOne(page, 'p1', lh, false);

  await page.waitFor("document.getElementById('feedback').className === 'ok'");
  await page.waitFor('window.__coach.task() && window.__coach.task().done', 5000);

  const events = await page.evaluate('window.__coach.db().events');
  const last = events[events.length - 1];
  assert.match(last.skill, /^j\dh$/);
  assert.equal(last.assistance, 'none');
  assert.equal(last.hands, 'both');
  assert.equal(last.input, 'midi');

  assert.deepEqual(page.exceptions, []);
});

test('level 16: right hand wrong (second note not near the midpoint) fails naming the right hand', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await startTask(page, 16);

  const id = await page.evaluate('window.__coach.cur().id');
  assert.match(id, /^j\dd$/);
  const info = await page.evaluate('window.__coach.cur().info');
  const rh = info.ex.rh.midi, lh = info.ex.lh.midi;

  await learnPass(page, 'p1', rh, lh);

  await page.evaluate(`(async function () {
    window.__midiSend('p1', [${onBytes(lh, true).join(',')}]);
    window.__midiSend('p1', [${onBytes(rh, true).join(',')}]);
    await new Promise(function (r) { setTimeout(r, 20); });
    window.__midiSend('p1', [${onBytes(rh, false).join(',')}]);
    window.__midiSend('p1', [${onBytes(rh, true).join(',')}]);
    await new Promise(function (r) { setTimeout(r, 1000); });
    window.__midiSend('p1', [${onBytes(rh, false).join(',')}]);
    window.__midiSend('p1', [${onBytes(lh, false).join(',')}]);
  })()`);

  await page.waitFor("document.getElementById('feedback').className === 'no'", 5000);
  const msg = await page.evaluate("document.getElementById('feedback').textContent");
  assert.match(msg, /right hand/i);

  const last = await page.evaluate('window.__coach.cur().pair.last');
  assert.deepEqual(last, { rh: 'fail', lh: 'pass' });

  assert.deepEqual(page.exceptions, []);
});

test('level 16: left hand late fails naming the left hand, without failing the right hand', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await startTask(page, 16);

  const info = await page.evaluate('window.__coach.cur().info');
  const rh = info.ex.rh.midi, lh = info.ex.lh.midi;

  await learnPass(page, 'p1', rh, lh);

  await page.evaluate(`(async function () {
    window.__midiSend('p1', [${onBytes(rh, true).join(',')}]);
    await new Promise(function (r) { setTimeout(r, 300); });
    window.__midiSend('p1', [${onBytes(lh, true).join(',')}]);
  })()`);

  await page.waitFor("document.getElementById('feedback').className === 'no'", 5000);
  const msg = await page.evaluate("document.getElementById('feedback').textContent");
  assert.match(msg, /left hand/i);

  const last = await page.evaluate('window.__coach.cur().pair.last');
  assert.equal(last.lh, 'fail');
  assert.notEqual(last.rh, 'fail');

  assert.deepEqual(page.exceptions, []);
});

test('level 16: a full split-rhythm pass', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await startTask(page, 16);

  const info = await page.evaluate('window.__coach.cur().info');
  const rh = info.ex.rh.midi, lh = info.ex.lh.midi;

  await learnPass(page, 'p1', rh, lh);

  await page.evaluate(`(async function () {
    window.__midiSend('p1', [${onBytes(lh, true).join(',')}]);
    window.__midiSend('p1', [${onBytes(rh, true).join(',')}]);
    await new Promise(function (r) { setTimeout(r, 500); });
    window.__midiSend('p1', [${onBytes(rh, false).join(',')}]);
    window.__midiSend('p1', [${onBytes(rh, true).join(',')}]);
    await new Promise(function (r) { setTimeout(r, 500); });
    window.__midiSend('p1', [${onBytes(rh, false).join(',')}]);
    window.__midiSend('p1', [${onBytes(lh, false).join(',')}]);
  })()`);

  await page.waitFor("document.getElementById('feedback').className === 'ok'", 5000);
  await page.waitFor('window.__coach.task() && window.__coach.task().done', 5000);

  const events = await page.evaluate('window.__coach.db().events');
  const last = events[events.length - 1];
  assert.match(last.skill, /^j\dd$/);
  assert.equal(last.assistance, 'none');

  assert.deepEqual(page.exceptions, []);
});

async function tapPoints(page, points) {
  const rects = await page.evaluate(`
    (function () {
      const cv = document.getElementById('cv'), r = cv.getBoundingClientRect();
      return ${JSON.stringify(points)}.map(function (p) {
        return { clientX: r.left + p.x * r.width / cv.width, clientY: r.top + p.y * r.height / cv.height };
      });
    })()
  `);
  await page.evaluate(`
    (${JSON.stringify(rects)}).forEach(function (pt) {
      document.getElementById('cv').dispatchEvent(new PointerEvent('pointerdown', { clientX: pt.clientX, clientY: pt.clientY, bubbles: true }));
    });
  `);
}

test('level 15: screen taps write no independent row', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await toLevel(page, 15);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const readyBefore = await page.evaluate('window.__coach.state().ready');

  const info = await page.evaluate('window.__coach.cur().info');
  const rh = info.ex.rh.midi, lh = info.ex.lh.midi;
  const keys = await page.evaluate('window.__coach.kbdKeys()');
  const rKey = keys.find((k) => k.m === rh), lKey = keys.find((k) => k.m === lh);
  assert.ok(rKey && lKey, 'both hand rects must be drawn');

  await tapPoints(page, [
    { x: rKey.x + rKey.w / 2, y: rKey.y + rKey.h / 2 },
    { x: lKey.x + lKey.w / 2, y: lKey.y + lKey.h / 2 }
  ]);

  await page.waitFor("document.getElementById('feedback').textContent.match(/practice only: held notes need a midi keyboard or computer keys/i)", 3000);
  await page.waitFor('window.__coach.task() && window.__coach.task().done', 5000);

  const events = await page.evaluate('window.__coach.db().events');
  const rows = events.filter((e) => /^j\dh$/.test(e.skill));
  assert.ok(rows.length > 0, 'expected at least one j<n>h event row');
  rows.forEach((e) => { assert.equal(e.assistance, 'guided'); assert.equal(e.input, 'screen'); assert.equal(isIndependentOk(e), false); });

  const readyAfter = await page.evaluate('window.__coach.state().ready');
  assert.ok(readyAfter <= readyBefore, 'a practice-only (guided) pass must not raise S.ready');

  assert.deepEqual(page.exceptions, []);
});

test('level 16: screen taps write no independent row', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await toLevel(page, 16);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const readyBefore = await page.evaluate('window.__coach.state().ready');

  const info = await page.evaluate('window.__coach.cur().info');
  const rh = info.ex.rh.midi, lh = info.ex.lh.midi;
  const keys = await page.evaluate('window.__coach.kbdKeys()');
  const rKey = keys.find((k) => k.m === rh), lKey = keys.find((k) => k.m === lh);
  assert.ok(rKey && lKey, 'both hand rects must be drawn');

  await tapPoints(page, [
    { x: rKey.x + rKey.w / 2, y: rKey.y + rKey.h / 2 },
    { x: lKey.x + lKey.w / 2, y: lKey.y + lKey.h / 2 }
  ]);

  await page.waitFor("document.getElementById('feedback').textContent.match(/practice only: held notes need a midi keyboard or computer keys/i)", 3000);
  await page.waitFor('window.__coach.task() && window.__coach.task().done', 5000);

  const events = await page.evaluate('window.__coach.db().events');
  const rows = events.filter((e) => /^j\dd$/.test(e.skill));
  assert.ok(rows.length > 0, 'expected at least one j<n>d event row');
  rows.forEach((e) => { assert.equal(e.assistance, 'guided'); assert.equal(e.input, 'screen'); assert.equal(isIndependentOk(e), false); });

  const readyAfter = await page.evaluate('window.__coach.state().ready');
  assert.ok(readyAfter <= readyBefore, 'a practice-only (guided) pass must not raise S.ready');

  assert.deepEqual(page.exceptions, []);
});
