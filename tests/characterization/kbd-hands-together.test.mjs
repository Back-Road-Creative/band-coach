// CURRENT BEHAVIOUR: piano "hands together" on the keyboard mod (level 13).
// A real MIDI note-on stream (exact=true) can report two independent notes,
// so both the right-hand and left-hand notes are checked exactly, together,
// within a short window. A single detected pitch (exact=false, as a
// monophonic microphone pitch detector would report) can only ever confirm
// one of the two notes, so that grading is approximate and says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { retrievability } from '../../src/core/srs.js';

const htmlPath = HTML_PATH;
const masteryOf = (item, now) => (item ? retrievability(item, now) : 0.4);

async function toHandsTogether(page) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate('window.__coach.state().level = 13');
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
}

test('hands together: exact MIDI input needs both hands correct, at their standard fingering', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await toHandsTogether(page);

  const info = await page.evaluate('window.__coach.cur().info');
  assert.equal(info.kind, 'hands-together');
  assert.ok(info.ex.rh.midi > info.ex.lh.midi, 'right hand note is written above the left hand note');
  assert.ok(info.ex.rh.finger >= 1 && info.ex.rh.finger <= 5);
  assert.ok(info.ex.lh.finger >= 1 && info.ex.lh.finger <= 5);

  const id = await page.evaluate('window.__coach.cur().id');
  const now = await page.evaluate('window.__coach.modelNow()');
  const itemBefore = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}]`);
  const masteryBefore = masteryOf(itemBefore, now);

  // Only the right-hand note: no pass yet.
  await page.evaluate(`window.__coach.note(${info.ex.rh.midi}, true)`);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await page.evaluate("document.getElementById('feedback').className"), '');

  // Left-hand note joins it within the "together" window: both hands, passes.
  await page.evaluate(`window.__coach.note(${info.ex.lh.midi}, true)`);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");

  const itemAfter = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}]`);
  const masteryAfter = masteryOf(itemAfter, now);
  assert.ok(masteryAfter > masteryBefore, `mastery should rise after both hands land together (${masteryBefore} -> ${masteryAfter})`);
});

test('hands together: a wrong note held alongside both correct ones fails the element', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await toHandsTogether(page);

  const info = await page.evaluate('window.__coach.cur().info');
  await page.evaluate(`window.__coach.note(${info.ex.rh.midi}, true)`);
  await page.evaluate(`window.__coach.note(${info.ex.rh.midi + 1}, true)`); // a wrong note, still exact input
  await page.waitFor("document.getElementById('feedback').className === 'no'");
  assert.equal(await page.evaluate('window.__coach.cur().failed'), true);
});

test('hands together: a single non-MIDI pitch (mic-style, exact=false) is graded approximate, one hand at a time', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await toHandsTogether(page);

  const info = await page.evaluate('window.__coach.cur().info');

  // The right-hand note alone, reported the way a monophonic mic pitch
  // detector would (exact=false): passes, but the feedback text must call
  // out that it is approximate, never claiming both hands were confirmed.
  await page.evaluate(`window.__coach.note(${info.ex.rh.midi}, false)`);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");
  const msg = await page.evaluate("document.getElementById('feedback').textContent");
  assert.match(msg, /approximate/i);
  assert.match(msg, /microphone/i);
});

// B3: an approximate hands-together pass is graded for real (SRS reviewed,
// same as today) but must not raise level progress, since only one hand was
// actually heard.
test('hands together: an approximate pass is reviewed by the SRS but does not raise level progress', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await toHandsTogether(page);

  const info = await page.evaluate('window.__coach.cur().info');
  const id = await page.evaluate('window.__coach.cur().id');
  const now = await page.evaluate('window.__coach.modelNow()');
  const itemBefore = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}]`);
  const masteryBefore = masteryOf(itemBefore, now);
  const readyBefore = await page.evaluate('window.__coach.state().ready');

  await page.evaluate(`window.__coach.note(${info.ex.rh.midi}, false)`);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");
  await page.waitFor('window.__coach.task() && window.__coach.task().done', 5000);

  const itemAfter = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}]`);
  const masteryAfter = masteryOf(itemAfter, now);
  const readyAfter = await page.evaluate('window.__coach.state().ready');
  assert.ok(masteryAfter > masteryBefore, `an approximate pass must still be reviewed by the SRS (${masteryBefore} -> ${masteryAfter})`);
  assert.equal(readyAfter, readyBefore, 'an approximate pass must not move level progress');
});

// B1: Both/Right only/Left only. The selector is a real #modOpts control
// (src/app.js renderOpts()), driven here by setting its value and dispatching
// a real 'change' event -- the same event its own addEventListener('change')
// handles -- not by poking DB.prefs through the debug hook.
test('hands together: choosing "Right only" in the Hands selector persists across a reload', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await toHandsTogether(page);

  assert.equal(await page.evaluate("document.getElementById('optKbdHands').value"), 'both', 'both hands is the default');
  await page.evaluate("const s = document.getElementById('optKbdHands'); s.value = 'right'; s.dispatchEvent(new Event('change', { bubbles: true }));");
  assert.equal(await page.evaluate('window.__coach.db().prefs.kbdHands'), 'right');

  await page.reload();
  assert.equal(await page.evaluate('window.__coach.db().prefs.kbdHands'), 'right', 'the choice survives a reload');
  assert.equal(await page.evaluate("document.getElementById('optKbdHands').value"), 'right', 'the selector itself reflects the saved choice after reload');
});

test('hands together: choosing "Right only" restarts the current task and credits a right-suffixed id, never the shared both-hands id', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await toHandsTogether(page);

  const bothId = await page.evaluate('window.__coach.cur().id');
  assert.match(bothId, /^j\d+$/, 'the default both-hands element is credited on the plain j<n> id');

  await page.evaluate("const s = document.getElementById('optKbdHands'); s.value = 'right'; s.dispatchEvent(new Event('change', { bubbles: true }));");
  await page.waitFor('window.__coach.cur() && /^j\\d+r$/.test(window.__coach.cur().id)');

  const id = await page.evaluate('window.__coach.cur().id');
  const info = await page.evaluate('window.__coach.cur().info');
  assert.equal(info.kind, 'hands-together');

  // Only the right-hand note, exact MIDI input: passes, and the left hand's
  // note was never required (finding B1(1) never leaves an unfinished,
  // half-graded task behind after the mode switch).
  await page.evaluate(`window.__coach.note(${info.ex.rh.midi}, true)`);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");
  await page.waitFor('window.__coach.task() && window.__coach.task().done', 5000);

  const events = await page.evaluate('window.__coach.db().events');
  const last = events[events.length - 1];
  assert.equal(last.hands, 'right', 'the logged event names which hand was checked');
  assert.equal(last.skill, id);

  const item = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}]`);
  assert.ok(item, 'the right-suffixed id has its own SRS item, separate from j<n>');
  // Not just bothId (the first task's element): none of the five shared
  // both-hands ids may have gained reps from a right-only pass, whichever
  // one happened to be first.
  for (let n = 1; n <= 5; n++) {
    const bothItem = await page.evaluate(`window.__coach.state().item[${JSON.stringify('j' + n)}]`);
    assert.equal((bothItem && bothItem.reps) || 0, 0, 'a right-only pass must never advance any shared both-hands item (j' + n + ')');
  }
});

test('hands together: a j1r item (right-only practice) survives a save and reload, not silently dropped by validId', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await toHandsTogether(page);

  await page.evaluate("const s = document.getElementById('optKbdHands'); s.value = 'right'; s.dispatchEvent(new Event('change', { bubbles: true }));");
  await page.waitFor('window.__coach.cur() && /^j\\d+r$/.test(window.__coach.cur().id)');

  const id = await page.evaluate('window.__coach.cur().id');
  const info = await page.evaluate('window.__coach.cur().info');
  await page.evaluate(`window.__coach.note(${info.ex.rh.midi}, true)`);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");
  await page.waitFor('window.__coach.task() && window.__coach.task().done', 5000);

  const before = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}]`);
  assert.ok(before && before.reps > 0);

  await page.reload();
  const after = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}]`);
  assert.ok(after, 'the j1r item must not be erased on reload');
  assert.equal(after.reps, before.reps, 'the survived item keeps its recorded reps, not reset to a fresh default');
});

test('hands together: an approximate Right-only pass names the hand, never the both-hands MIDI line', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await toHandsTogether(page);

  await page.evaluate("const s = document.getElementById('optKbdHands'); s.value = 'right'; s.dispatchEvent(new Event('change', { bubbles: true }));");
  await page.waitFor('window.__coach.cur() && /^j\\d+r$/.test(window.__coach.cur().id)');

  const info = await page.evaluate('window.__coach.cur().info');
  await page.evaluate(`window.__coach.note(${info.ex.rh.midi}, false)`);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");
  const msg = await page.evaluate("document.getElementById('feedback').textContent");
  assert.match(msg, /right hand/i);
  assert.doesNotMatch(msg, /connect a midi keyboard to grade both hands together/i, 'a one-hand mode must not tell the learner to grade "both hands together"');
});

// Above level 13 (the last dedicated "hands" level), levelDef falls into
// task 'mix' (levelDef's synthesised "Everything, faster (k)"), which cycles
// through every task kind seen across the mod's own levels -- including
// 'seq' and 'one', whose pool is every active id except chords and note
// names by letter, so it can still hand out a PLAIN (unsuffixed) 'j<n>' id
// even while the Hands selector is set to Right/Left only. Grading, hintFor
// and finishTask must key off THAT element's own id (handsModeFromId), not
// the current global preference, or a plain j<n> gets graded one-handed
// while still crediting the shared both-hands mastery item.
// Takes the already-fetched element (rather than re-reading window.__coach.cur()
// a second time) so a task boundary landing between two evaluate() calls can
// never hand this a null cur() to read .info off of.
async function completeElement(page, e) {
  const info = e.info;
  if (info.kind === 'chord') { for (const p of info.pcs) await page.evaluate(`window.__coach.note(${60 + p}, true)`); }
  else if (info.kind === 'hands-together') { await page.evaluate(`window.__coach.note(${info.ex.rh.midi}, true)`); await page.evaluate(`window.__coach.note(${info.ex.lh.midi}, true)`); }
  else if (info.kind === 'note') { await page.evaluate(`window.__coach.note(${info.midi}, true)`); }
  else { return false; }
  return true;
}

test('hands together: a plain both-hands id inside a mixed (level 14+) task is still graded and credited as both-hands, even in Right-only mode', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate('window.__coach.state().level = 14');
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  await page.evaluate("const s = document.getElementById('optKbdHands'); s.value = 'right'; s.dispatchEvent(new Event('change', { bubbles: true }));");
  assert.equal(await page.evaluate('window.__coach.db().prefs.kbdHands'), 'right');

  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    await page.waitFor('window.__coach.cur()', 3000);
    const e = await page.evaluate('window.__coach.cur()');
    if (!e) continue;
    if (e.info.kind === 'hands-together' && /^j\d+$/.test(e.id)) { target = e; break; }
    const advanced = await completeElement(page, e);
    if (!advanced) { await page.waitFor('!window.__coach.task() || window.__coach.task().done', 3000); }
  }
  assert.ok(target, 'a plain j<n> element must show up in a mixed-level task within a reasonable number of tasks');

  const id = target.id, info = target.info;
  const before = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}]`);
  const repsBefore = (before && before.reps) || 0;

  // Clear any leftover feedback text/class from whichever element finished
  // just before this one was reached (the feedback area is only ever
  // updated by the next pass/fail, never reset between tasks) so the check
  // below reflects THIS note, not a stale prior pass.
  await page.evaluate("document.getElementById('feedback').className = ''; document.getElementById('feedback').textContent = '';");

  // Only the right-hand note: in Right-only mode this is the whole
  // exercise, but a plain j<n> id names the BOTH-hands exercise, so it must
  // not pass on one hand alone.
  await page.evaluate(`window.__coach.note(${info.ex.rh.midi}, true)`);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await page.evaluate("document.getElementById('feedback').className"), '', 'the right-hand note alone must not pass a both-hands (j<n>) element');

  await page.evaluate(`window.__coach.note(${info.ex.lh.midi}, true)`);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");
  await page.waitFor('window.__coach.task() && window.__coach.task().done', 5000);

  const events = await page.evaluate('window.__coach.db().events');
  const last = events[events.length - 1];
  assert.equal(last.hands, 'both', 'a plain j<n> element is always logged as both hands, regardless of the current global preference');

  const after = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}]`);
  assert.ok(after.reps > repsBefore, 'the both-hands pass must still credit the shared both-hands item');
});
