// P5-1 regression: today's plan (src/core/curriculum.js's planSession,
// steered through src/app.js's buildLevelTask via nextPlanStep) must only
// ever steer a pitched-item drill (one/chord/seq, or a mix level that draws
// from those) that has a real single "correct id" answer. A hands-together
// keyboard level and a rhythm bar level build their OWN items/choices from
// the level's own pool -- forcing either into a plan-shaped 'one'/'chord'
// task with a pool narrowed to plan ids breaks them outright (kbd's
// hands-together needs BOTH a right- and left-hand note; rhy's bar level
// needs a full bar of cells summing to the metre, not one lone item id).
// A plan being active for the module must not change either level's task
// kind, its blind flag, or what it hands out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('a plan active for kbd does not rewrite a hands-together level into a plan-shaped one/chord task', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  // Seed an overdue, once-lapsed kbd item so planSession() returns a
  // non-empty plan for this module at session start -- the same seed
  // plan-drives-drills.test.mjs uses to prove the plan DOES steer level 1.
  await page.evaluate(`(function () {
    const db = window.__coach.db();
    db.mods.kbd.item = { n60: { stability: 5, difficulty: 0.3, lastSeen: Date.now() - 100 * 86400000, reps: 4, lapses: 1, seen: 5 } };
    db.mods.kbd.judged = 0;
    window.localStorage.setItem('bandcoach.v1', JSON.stringify(db));
  })()`);
  await page.reload();
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.waitFor('window.__coach && window.__coach.db().mods.kbd', 5000);
  // Level 13 = "hands together" (task: 'hands'), a non-pitched-item drill.
  await page.evaluate('window.__coach.state().level = 13');
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()', 5000);

  const plan = await page.evaluate('window.__coach.plan()');
  assert.ok(Array.isArray(plan) && plan.length, 'expected a non-empty plan to be active for kbd');

  const task = await page.evaluate(
    "(function(){ const t = window.__coach.task(); return { kind: t.kind, blind: t.blind, els: t.els.length }; })()"
  );
  assert.equal(task.kind, 'hands', 'a hands-together level must keep its own task kind, not be rewritten to one/chord/seq');
  assert.equal(task.blind, false, 'level 13 carries no blind flag of its own, so the plan must not force one on it');

  const info = await page.evaluate('window.__coach.cur().info');
  assert.equal(info.kind, 'hands-together', "expected the level's own hands-together item, not a plan-forced single note");
});

test('a plan active for rhy does not rewrite a bar level into a plan-shaped one/chord task', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  // Seed an overdue, once-lapsed rhy item ('rq', a quarter-note-and-rest
  // cell added on level 1) so planSession() returns a non-empty plan.
  await page.evaluate(`(function () {
    const db = window.__coach.db();
    db.mods.rhy.item = { rq: { stability: 5, difficulty: 0.3, lastSeen: Date.now() - 100 * 86400000, reps: 4, lapses: 1, seen: 5 } };
    db.mods.rhy.judged = 0;
    window.localStorage.setItem('bandcoach.v1', JSON.stringify(db));
  })()`);
  await page.reload();
  await page.evaluate("window.__coach.setMod('rhy')");
  await page.waitFor('window.__coach && window.__coach.db().mods.rhy', 5000);
  // Level 1 (task: 'bar') is rhy's first level.
  await page.evaluate('window.__coach.state().level = 1');
  await page.evaluate('window.__coach.db().latencyMs = 0');
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()', 5000);

  const plan = await page.evaluate('window.__coach.plan()');
  assert.ok(Array.isArray(plan) && plan.length, 'expected a non-empty plan to be active for rhy');

  const task = await page.evaluate(
    "(function(){ const t = window.__coach.task(); return { kind: t.kind, blind: t.blind, els: t.els.length }; })()"
  );
  assert.equal(task.kind, 'bar', 'a rhythm bar level must keep its own task kind, not be rewritten to one/chord/seq');
  assert.equal(task.blind, false, 'level 1 carries no blind flag of its own, so the plan must not force one on it');
  assert.ok(task.els > 1, 'a bar task should fill the bar with several rhythm cells, not one lone plan id');
});
