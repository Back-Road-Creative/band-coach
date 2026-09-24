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
