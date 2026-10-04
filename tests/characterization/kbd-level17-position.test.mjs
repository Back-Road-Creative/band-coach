// Level 17 ("hand position change"): the right hand plays the five-finger
// position, then moves UP a fixed interval and plays the same shape in the
// new position, while the left hand keeps holding its own note underneath.
// Untimed (no note-on/note-off synchronisation, unlike levels 14-16) --
// see src/core/hands-together.js's gradePositionChange(). Real entry points
// throughout: a fake MIDI port through the real ioBtn click handler and real
// DOM keydown/keyup -- window.__coach is only ever used here to read state
// (cur(), db(), state(), kbdKeys(), levelDef()).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage, retryFlaky } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort } from '../helpers/fake-midi.mjs';
import { gradePositionChange, POSITION_SHIFT_SEMITONES, HANDS_TOGETHER_EXERCISES } from '../../src/core/hands-together.js';

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

async function startTask(page, level) {
  await toLevel(page, level);
  await midiAddPort(page, 'p1', 'Test Keys');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
}

// Plays the OLD (pre-shift) position -- oldRh + lh together, then lets go of
// the right hand only -- and waits for the coach to register the shift
// (e.pair.moved) before continuing. Mirrors kbd-levels-15-16.test.mjs's
// learnPass, this level's own equivalent of "LEARN, then move on".
async function playOldPosition(page, port, oldRh, lh) {
  await page.evaluate(`(function () {
    window.__midiSend('${port}', [${onBytes(oldRh, true).join(',')}]);
    window.__midiSend('${port}', [${onBytes(lh, true).join(',')}]);
  })()`);
  await page.waitFor("window.__coach.cur() && window.__coach.cur().pair && window.__coach.cur().pair.moved === true");
  await page.evaluate(`window.__midiSend('${port}', [${onBytes(oldRh, false).join(',')}])`);
  await clearFeedback(page);
}

test('level 17: exists in the kbd curriculum, staged, labelled "Not yet checked by a player"', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await toLevel(page, 17);

  const def = await page.evaluate('window.__coach.levelDef()');
  assert.equal(def.stage, 'position');
  assert.match(def.name, /position change/i);

  const reviewText = await page.evaluate("document.getElementById('kbdPositionReview').textContent");
  assert.match(reviewText, /Not yet checked by a player/);

  assert.deepEqual(page.exceptions, []);
});

test('the shift interval is a fourth, and every shifted right-hand target stays inside the fixed 60-72 right-hand row', () => {
  assert.equal(POSITION_SHIFT_SEMITONES, 5);
  HANDS_TOGETHER_EXERCISES.forEach(ex => {
    const shifted = ex.rh.midi + POSITION_SHIFT_SEMITONES;
    assert.ok(shifted <= 72, ex.name + ' position: shifted target ' + shifted + ' must stay at or under MIDI 72');
  });
});

test('level 17: after the shift, the new target is drawn inside the on-screen window and a correct MIDI pass passes', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await startTask(page, 17);

  const id = await page.evaluate('window.__coach.cur().id');
  assert.match(id, /^j\dp$/);
  const info = await page.evaluate('window.__coach.cur().info');
  const oldRh = info.ex.oldRh.midi, rh = info.ex.rh.midi, lh = info.ex.lh.midi;

  await playOldPosition(page, 'p1', oldRh, lh);

  const drawn = await page.evaluate('window.__coach.kbdKeys().map(k => k.m)');
  assert.ok(drawn.includes(rh), 'the shifted right-hand target ' + rh + ' must be drawn on screen after the shift');
  assert.ok(drawn.includes(lh), 'the held left-hand note must stay drawn on screen throughout');

  await sendOne(page, 'p1', rh, true);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");

  const idAfter = await page.evaluate('window.__coach.cur() ? window.__coach.cur().id : null');
  assert.notEqual(idAfter, id, 'a passed element moves the task on');

  assert.deepEqual(page.exceptions, []);
});

test('level 17: playing the old position after the shift fails, naming the old position', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await startTask(page, 17);

  const info = await page.evaluate('window.__coach.cur().info');
  const oldRh = info.ex.oldRh.midi, lh = info.ex.lh.midi;
  const idBefore = await page.evaluate('window.__coach.cur().id');

  await playOldPosition(page, 'p1', oldRh, lh);

  // Same old right-hand key, still with the bass held -- must fail, not
  // silently do nothing and not silently pass.
  await sendOne(page, 'p1', oldRh, true);

  await page.waitFor("document.getElementById('feedback').className === 'no'");
  const msg = await page.evaluate("document.getElementById('feedback').textContent");
  assert.match(msg, /old position/i);

  const idAfter = await page.evaluate('window.__coach.cur().id');
  assert.equal(idAfter, idBefore, 'a failed element is not passed on to the next one');

  assert.deepEqual(page.exceptions, []);
});

test('level 17: lifting the left hand after the shift fails naming the left hand, and a later re-press cannot pass it', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await startTask(page, 17);

  const info = await page.evaluate('window.__coach.cur().info');
  const oldRh = info.ex.oldRh.midi, lh = info.ex.lh.midi, newRh = info.ex.rh.midi;
  const idBefore = await page.evaluate('window.__coach.cur().id');

  await playOldPosition(page, 'p1', oldRh, lh);
  await sendOne(page, 'p1', lh, false); // left hand lifts during the move

  await page.waitFor("document.getElementById('feedback').className === 'no'");
  const msg = await page.evaluate("document.getElementById('feedback').textContent");
  assert.match(msg, /left hand/i);
  assert.match(msg, /hold|down/i);

  // Re-pressing the left hand with the new right-hand key must not pass.
  await sendOne(page, 'p1', lh, true);
  await sendOne(page, 'p1', newRh, true);
  const idAfter = await page.evaluate('window.__coach.cur().id');
  assert.equal(idAfter, idBefore, 'a lifted left hand is not passed on by pressing it again');

  assert.deepEqual(page.exceptions, []);
});

test('level 17: computer-key input passes the same way as MIDI', async (t) => {
  await retryFlaky({
    attempts: 3,
    what: 'level 17: computer-key pass after the shift',
    describe: (r) => r.error || 'ok',
    accept: (r) => r.ok,
    attempt: async () => {
      const page = await launchPage(htmlPath);
      try {
        await toLevel(page, 17);
        await page.evaluate("document.getElementById('playBtn').click()");
        await page.waitFor('window.__coach.task()');

        const info = await page.evaluate('window.__coach.cur().info');
        const UPPER_KEY_FOR_MIDI = { 60: 'a', 61: 'w', 62: 's', 63: 'e', 64: 'd', 65: 'f', 66: 't', 67: 'g', 68: 'y', 69: 'h', 70: 'u', 71: 'j', 72: 'k' };
        const LOWER_KEY_FOR_MIDI = { 48: 'z', 50: 'x', 52: 'c', 53: 'v', 55: 'b' };
        const oldRhKey = UPPER_KEY_FOR_MIDI[info.ex.oldRh.midi], rhKey = UPPER_KEY_FOR_MIDI[info.ex.rh.midi], lhKey = LOWER_KEY_FOR_MIDI[info.ex.lh.midi];
        if (!oldRhKey || !rhKey || !lhKey) return { ok: false, error: 'no computer-key mapping for ' + JSON.stringify(info.ex) };

        await page.evaluate(`(function () {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: '${oldRhKey}' }));
          document.dispatchEvent(new KeyboardEvent('keydown', { key: '${lhKey}' }));
        })()`);
        await page.waitFor("window.__coach.cur() && window.__coach.cur().pair && window.__coach.cur().pair.moved === true", 3000);
        await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keyup', { key: '${oldRhKey}' }))`);
        await page.evaluate("document.getElementById('feedback').className = ''; document.getElementById('feedback').textContent = '';");

        await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${rhKey}' }))`);
        await page.waitFor("document.getElementById('feedback').className === 'ok'", 3000);

        if (page.exceptions.length) return { ok: false, error: 'page exceptions: ' + JSON.stringify(page.exceptions) };
        return { ok: true };
      } finally {
        await page.close();
      }
    }
  });
});

test('gradePositionChange (pure): before the shift only the old right-hand key passes; after the shift the old key fails naming itself, and the new key passes', () => {
  const ex = { rh: { midi: 65, finger: 1 }, lh: { midi: 48, finger: 5 }, oldRh: { midi: 60, finger: 1 } };

  const beforeWrong = gradePositionChange(ex, [65, 48], false);
  assert.equal(beforeWrong.ok, false);
  assert.ok(beforeWrong.wrong.length > 0, 'the new-position key played before the shift is a wrong note, not silently accepted');

  const beforeOk = gradePositionChange(ex, [60, 48], false);
  assert.equal(beforeOk.ok, true);

  const afterOldPosition = gradePositionChange(ex, [60, 48], true);
  assert.equal(afterOldPosition.ok, false);
  assert.equal(afterOldPosition.oldPosition, true);
  assert.equal(afterOldPosition.wrong.length, 0, 'the old key is reported as oldPosition, not folded into wrong');

  const afterOk = gradePositionChange(ex, [65, 48], true);
  assert.equal(afterOk.ok, true);
  assert.equal(afterOk.oldPosition, false);
});

test('level 17: screen taps are graded the same way, not silently ignored', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await toLevel(page, 17);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  const oldRh = info.ex.oldRh.midi, lh = info.ex.lh.midi;
  const keys = await page.evaluate('window.__coach.kbdKeys()');
  const rKey = keys.find((k) => k.m === oldRh), lKey = keys.find((k) => k.m === lh);
  assert.ok(rKey && lKey, 'both starting keys must be drawn');

  const rects = await page.evaluate(`
    (function () {
      const cv = document.getElementById('cv'), r = cv.getBoundingClientRect();
      return [${JSON.stringify({ x: rKey.x + rKey.w / 2, y: rKey.y + rKey.h / 2 })}, ${JSON.stringify({ x: lKey.x + lKey.w / 2, y: lKey.y + lKey.h / 2 })}].map(function (p) {
        return { clientX: r.left + p.x * r.width / cv.width, clientY: r.top + p.y * r.height / cv.height };
      });
    })()
  `);
  await page.evaluate(`
    (${JSON.stringify(rects)}).forEach(function (pt) {
      document.getElementById('cv').dispatchEvent(new PointerEvent('pointerdown', { clientX: pt.clientX, clientY: pt.clientY, bubbles: true }));
    });
  `);

  await page.waitFor("window.__coach.cur() && window.__coach.cur().pair && window.__coach.cur().pair.moved === true", 3000);

  assert.deepEqual(page.exceptions, []);
});
