// NEW BEHAVIOUR (declutter plan U4): the side rail no longer reserves boxes
// it has nothing to say in. On a fresh profile, before Start is ever
// pressed, the "Instant feedback" card, the last-20/streak/answer-time
// stats block and "What the coach is leaning on" card are all absent --
// they earn their place once they have real content.
// P2b-2: the help paragraphs and the housekeeping controls (reset, backup
// save/restore, check for updates) no longer live on the Practice screen at
// all -- they moved to the Settings destination (tests/characterization/
// settings-view.test.mjs covers Settings itself; this file only proves
// Practice stays quiet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('fresh profile: feedback, stats and weak-list cards are not shown before Start', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  assert.equal(await page.evaluate("document.getElementById('feedbackCard').hidden"), true);
  assert.equal(await page.evaluate("document.getElementById('statsBlock').hidden"), true);
  assert.equal(await page.evaluate("document.getElementById('weakCard').hidden"), true);
  // No "Been here before? Restore a backup" nudge on a profile with no
  // progress to restore in the first place -- Restore stays reachable in
  // the overflow menu regardless.
  assert.equal(await page.evaluate("document.getElementById('backupNudge').hidden"), true);
});

test('the help paragraphs are not on the Practice screen -- they live in Settings', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  assert.equal(await page.evaluate("document.querySelectorAll('.side .help, .side details.help').length"), 0);
  assert.equal(await page.evaluate("document.getElementById('settingsView').contains(document.getElementById('helpText'))"), true);
  assert.equal(await page.evaluate("document.getElementById('settingsView').hidden"), true, 'Settings is not shown at boot');
});

test('housekeeping controls are not on the Practice screen -- they live in Settings, hidden at boot', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  assert.equal(await page.evaluate("document.getElementById('railMenu')"), null, 'no #railMenu on the page at all');
  for (const id of ['resetBtn', 'backupSaveBtn', 'backupRestoreInput', 'updateCheckBtn', 'updateCheckHelp', 'updateCheckResult']) {
    assert.ok(
      await page.evaluate(`document.getElementById('settingsView').contains(document.getElementById('${id}'))`),
      `#${id} lives inside #settingsView`
    );
    assert.equal(
      await page.evaluate(`document.querySelector('.side').contains(document.getElementById('${id}'))`),
      false,
      `#${id} is no longer in the Practice side rail`
    );
  }
  assert.ok(
    await page.evaluate("document.getElementById('resetBtn').className.indexOf('danger') !== -1"),
    'reset is marked as destructive, distinct from the other settings controls'
  );
});

test('answering a note reveals the instant-feedback card', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");

  assert.equal(await page.evaluate("document.getElementById('feedbackCard').hidden"), false);
});

test('the stats block appears once an answer has actually been judged', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");

  assert.equal(await page.evaluate("document.getElementById('statsBlock').hidden"), false);
  assert.notEqual(await page.evaluate("document.getElementById('sAcc').textContent"), '0%');
});

test('the weak-list card stays hidden until something is actually weak', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  assert.equal(await page.evaluate("document.getElementById('weakCard').hidden"), true);

  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const id = await page.evaluate('window.__coach.cur().id');
  await page.evaluate("document.getElementById('endBtn').click()");

  // Simulate a poorly-retained item the same shape a real review would
  // leave behind (reps >= 2, stale enough to be due) -- setMod() re-renders
  // the rail from current state, same as a fresh page load would.
  await page.evaluate(`(() => {
    const s = window.__coach.state();
    s.item[${JSON.stringify(id)}] = { stability: 0.02, difficulty: 0.5, lastSeen: window.__coach.modelNow() - 20 * 86400000, reps: 3, lapses: 1, seen: 3 };
    window.__coach.setMod('kbd');
  })()`);

  assert.equal(await page.evaluate("document.getElementById('weakCard').hidden"), false);
  assert.ok(await page.evaluate("document.getElementById('weakList').children.length > 0"));
});
