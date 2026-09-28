// Level 14 ("Hands together: matching rhythms"): both hands' notes from the
// same C five-finger position pair (HANDS_TOGETHER_EXERCISES), but this time
// timed -- LEARN (both held together, untimed) then CHECK (press together
// within PAIR_ONSET_TOL_MS, let go together within PAIR_RELEASE_TOL_MS).
// Real entry points throughout: a fake MIDI port through the real ioBtn
// click handler, real DOM keydown/keyup, and a real canvas pointerdown --
// never window.__coach.note() as a shortcut past them (window.__coach is
// only ever used here to read state: cur(), db(), state(), kbdKeys()).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort, midiNoteOn, midiNoteOff, midiSend } from '../helpers/fake-midi.mjs';
import { isIndependentOk } from '../../src/core/learning-events.js';

const htmlPath = HTML_PATH;

async function connectMidi(page) {
  await page.evaluate("document.getElementById('ioBtn').click()");
}

// Precedent for forcing a re-render onto a level already set before the
// mod's options box first drew: tests/characterization/kbd-hand-alone-gate
// .test.mjs's toLevel13.
async function toLevel14(page) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate('window.__coach.state().level = 14');
  await page.evaluate("window.__coach.setMod('kbd')");
}

function onBytes(note, on) {
  return [(on ? 0x90 : 0x80), note, on ? 100 : 0];
}

test('label + real-MIDI LEARN then in-time CHECK passes', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await toLevel14(page);

  const reviewText = await page.evaluate("document.getElementById('kbdRhythmReview').textContent");
  assert.match(reviewText, /Not yet checked by a player/);
  assert.equal(await page.evaluate("document.getElementById('kbdBothLock')"), null);

  await midiAddPort(page, 'p1', 'Test Keys');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const id = await page.evaluate('window.__coach.cur().id');
  assert.match(id, /^j\dt$/);
  const info = await page.evaluate('window.__coach.cur().info');
  const rh = info.ex.rh.midi, lh = info.ex.lh.midi;

  // LEARN: both note-ons in one evaluate.
  await page.evaluate(`(function () {
    window.__midiSend('p1', [${onBytes(rh, true).join(',')}]);
    window.__midiSend('p1', [${onBytes(lh, true).join(',')}]);
  })()`);
  await page.waitFor("window.__coach.cur() && window.__coach.cur().pair && window.__coach.cur().pair.phase === 'check'");

  await page.evaluate(`(function () {
    window.__midiSend('p1', [${onBytes(rh, false).join(',')}]);
    window.__midiSend('p1', [${onBytes(lh, false).join(',')}]);
  })()`);
  await page.evaluate("document.getElementById('feedback').className = ''; document.getElementById('feedback').textContent = '';");

  // CHECK: both note-ons together, hold ~150ms, both note-offs together.
  await page.evaluate(`(function () {
    window.__midiSend('p1', [${onBytes(rh, true).join(',')}]);
    window.__midiSend('p1', [${onBytes(lh, true).join(',')}]);
  })()`);
  await new Promise((r) => setTimeout(r, 150));
  await page.evaluate(`(function () {
    window.__midiSend('p1', [${onBytes(rh, false).join(',')}]);
    window.__midiSend('p1', [${onBytes(lh, false).join(',')}]);
  })()`);

  await page.waitFor("document.getElementById('feedback').className === 'ok'");
  await page.waitFor('window.__coach.task() && window.__coach.task().done', 5000);

  const events = await page.evaluate('window.__coach.db().events');
  const last = events[events.length - 1];
  assert.match(last.skill, /^j\dt$/);
  assert.equal(last.assistance, 'none');
  assert.equal(last.hands, 'both');

  assert.deepEqual(page.exceptions, []);
});

test('right hand 200ms late in CHECK fails with a timing reason', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await toLevel14(page);
  await midiAddPort(page, 'p1', 'Test Keys');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  const rh = info.ex.rh.midi, lh = info.ex.lh.midi;

  await midiNoteOn(page, 'p1', rh);
  await midiNoteOn(page, 'p1', lh);
  await page.waitFor("window.__coach.cur() && window.__coach.cur().pair && window.__coach.cur().pair.phase === 'check'");
  await midiNoteOff(page, 'p1', rh);
  await midiNoteOff(page, 'p1', lh);
  await page.evaluate("document.getElementById('feedback').className = ''; document.getElementById('feedback').textContent = '';");

  await page.evaluate(`(async function () {
    window.__midiSend('p1', [${onBytes(lh, true).join(',')}]);
    await new Promise(function (r) { setTimeout(r, 200); });
    window.__midiSend('p1', [${onBytes(rh, true).join(',')}]);
  })()`);

  await page.waitFor("document.getElementById('feedback').className === 'no'");
  const msg = await page.evaluate("document.getElementById('feedback').textContent");
  assert.match(msg, /right hand came in \d+ ms after the left hand/i);

  assert.deepEqual(page.exceptions, []);
});

test('a note held from before the element starts is never re-credited', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await toLevel14(page);
  await midiAddPort(page, 'p1', 'Test Keys');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");

  // Hold five pitches, covering every exercise's rh, BEFORE Play.
  for (const m of [60, 62, 64, 65, 67]) await midiNoteOn(page, 'p1', m);

  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const info = await page.evaluate('window.__coach.cur().info');
  const rh = info.ex.rh.midi, lh = info.ex.lh.midi;

  // Release the four other pitches, leaving R held over from before.
  for (const m of [60, 62, 64, 65, 67]) if (m !== rh) await midiNoteOff(page, 'p1', m);

  await midiNoteOn(page, 'p1', lh);
  await new Promise((r) => setTimeout(r, 150));
  const cls = await page.evaluate("document.getElementById('feedback').className");
  assert.notEqual(cls, 'ok', 'a naive realMidiHeld/noteState grader would wrongly pass here');
  const phase1 = await page.evaluate('window.__coach.cur().pair.phase');
  assert.equal(phase1, 'learn');

  await midiNoteOff(page, 'p1', rh);
  await midiNoteOff(page, 'p1', lh);
  await page.evaluate("document.getElementById('feedback').className = ''; document.getElementById('feedback').textContent = '';");

  await page.evaluate(`(function () {
    window.__midiSend('p1', [${onBytes(rh, true).join(',')}]);
    window.__midiSend('p1', [${onBytes(lh, true).join(',')}]);
  })()`);
  await page.waitFor("window.__coach.cur() && window.__coach.cur().pair && window.__coach.cur().pair.phase === 'check'");

  await page.evaluate(`(function () {
    window.__midiSend('p1', [${onBytes(rh, false).join(',')}]);
    window.__midiSend('p1', [${onBytes(lh, false).join(',')}]);
  })()`);
  await page.evaluate("document.getElementById('feedback').className = ''; document.getElementById('feedback').textContent = '';");
  await page.evaluate(`(function () {
    window.__midiSend('p1', [${onBytes(rh, true).join(',')}]);
    window.__midiSend('p1', [${onBytes(lh, true).join(',')}]);
  })()`);
  await new Promise((r) => setTimeout(r, 50));
  await page.evaluate(`(function () {
    window.__midiSend('p1', [${onBytes(rh, false).join(',')}]);
    window.__midiSend('p1', [${onBytes(lh, false).join(',')}]);
  })()`);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");

  assert.deepEqual(page.exceptions, []);
});

test('canvas pointerdown-only pass is practice-only, never independent, never moves the level', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await toLevel14(page);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const readyBefore = await page.evaluate('window.__coach.state().ready');

  const info = await page.evaluate('window.__coach.cur().info');
  const rh = info.ex.rh.midi, lh = info.ex.lh.midi;
  const keys = await page.evaluate('window.__coach.kbdKeys()');
  const rKey = keys.find((k) => k.m === rh), lKey = keys.find((k) => k.m === lh);
  assert.ok(rKey && lKey, 'both hand rects must be drawn');

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

  await tapPoints(page, [
    { x: rKey.x + rKey.w / 2, y: rKey.y + rKey.h / 2 },
    { x: lKey.x + lKey.w / 2, y: lKey.y + lKey.h / 2 }
  ]);

  await page.waitFor("document.getElementById('feedback').textContent.match(/practice only: held notes need a midi keyboard or computer keys/i)", 3000);
  await page.waitFor('window.__coach.task() && window.__coach.task().done', 5000);

  const events = await page.evaluate('window.__coach.db().events');
  const rows = events.filter((e) => /^j\dt$/.test(e.skill));
  assert.ok(rows.length > 0, 'expected at least one j<n>t event row');
  rows.forEach((e) => { assert.equal(e.assistance, 'guided'); assert.equal(isIndependentOk(e), false); });

  const readyAfter = await page.evaluate('window.__coach.state().ready');
  assert.ok(readyAfter <= readyBefore, 'a practice-only (guided) pass must not raise S.ready');

  assert.deepEqual(page.exceptions, []);
});

test('a real keydown/keyup CHECK pass works with no MIDI port at all', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await toLevel14(page);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  // src/core/pckeys.js: the upper row (C4-C5) is the right hand's home,
  // the lower row (C3-B3, naturals only) the left hand's -- same maps
  // tests/characterization/pckeys-lower-row.test.mjs already uses.
  const RH_KEY_FOR_MIDI = { 60: 'a', 62: 's', 64: 'd', 65: 'f', 67: 'g' };
  const LH_KEY_FOR_MIDI = { 48: 'z', 50: 'x', 52: 'c', 53: 'v', 55: 'b' };
  const rhKey = RH_KEY_FOR_MIDI[info.ex.rh.midi], lhKey = LH_KEY_FOR_MIDI[info.ex.lh.midi];
  assert.ok(rhKey && lhKey, 'both hand pitches must have a computer key');

  // Both keys of a pair go through in one page.evaluate round trip (as the
  // MIDI tests above do with window.__midiSend), so the onset/release gap
  // is near 0 ms whatever the runner's scheduling load -- a keydown/keyup
  // pair sent as two separate round trips could land more than
  // PAIR_ONSET_TOL_MS/PAIR_RELEASE_TOL_MS apart on a busy shared runner and
  // fail with no bug in the app.
  async function keys(page, ks, type) {
    await page.evaluate(`(() => { ${ks.map((k) => `document.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)}, { key: ${JSON.stringify(k)} }));`).join(' ')} })()`);
  }

  await keys(page, [rhKey, lhKey], 'keydown');
  await page.waitFor("window.__coach.cur() && window.__coach.cur().pair && window.__coach.cur().pair.phase === 'check'");
  await keys(page, [rhKey, lhKey], 'keyup');
  await page.evaluate("document.getElementById('feedback').className = ''; document.getElementById('feedback').textContent = '';");

  await keys(page, [rhKey, lhKey], 'keydown');
  await keys(page, [rhKey, lhKey], 'keyup');

  await page.waitFor("document.getElementById('feedback').className === 'ok'");
  assert.deepEqual(page.exceptions, []);
});
