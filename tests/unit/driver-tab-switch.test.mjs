// The driver's tab switch (page.background() / page.foreground()). A real tab
// switch is one Target.activateTarget the browser may lose or answer late on a
// starved box; the release gate's A02 test then timed out on the driver, not on
// the app (1 run in about 29). makeTabSwitcher re-sends the activation inside
// the same budget, says so when it had to, names what it was waiting for when it
// gives up, and never lets its bookkeeping (the held extra tab) disagree with
// the browser. U1-U10 run it against a scripted stand-in on a virtual clock (no
// process, no socket, no real wait). B1/B2 are the one real browser launch: the
// proof stays the page's own trusted visibilitychange events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as driver from '../helpers/browser.mjs';
import { launchPage, WAIT_FLOOR_MS } from '../helpers/browser.mjs';

const DRIVER = fileURLToPath(new URL('../fixtures/acceptance/driver-fixture.html', import.meta.url));
const BUDGET = 20000;
const ATTEMPTS = 4;
const POLL = 50;
const PAGE = 'PAGE';

// The scripted browser connection. Virtual clock: sleep() registers a timer,
// and a timer fires (the clock jumps to it) only once every promise that can
// make progress has, so the order of events is the real order, at no cost.
// Every send and read is logged in order. createTarget returns a fresh id each
// time (X1, X2, ...); an activation of an extra tab hides the page and an
// activation of PAGE shows it, `delayMs` later; closing the extra tab leaves
// the page visible. `rules` scripts the trouble.
function world({ limit = BUDGET * 10 } = {}) {
  let clock = 0;
  let seq = 0;
  let scheduled = false;
  const timers = [];
  const w = {
    log: [],
    warns: [],
    page: 'visible',
    open: new Set(),
    acts: {},
    rules: { delayMs: 300, lose: {}, dead: new Set(), never: false, hangActivate: false, hangRead: false, rejectActivate: null, lateCreateMs: null },
  };
  const schedule = () => {
    if (scheduled || !timers.some((t) => t.live)) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      const live = timers.filter((t) => t.live).sort((a, b) => a.at - b.at);
      if (live.length) {
        const t = live[0];
        t.live = false;
        timers.splice(timers.indexOf(t), 1);
        if (t.at > limit) t.rej(new Error('stand-in: virtual time passed ten budgets'));
        else { clock = Math.max(clock, t.at); t.res(); }
      }
      schedule();
    });
  };
  // A reply that never comes. The pending timer keeps the virtual clock running, so a driver with no deadline
  // of its own ends in the stand-in's ten-budget error (an assertion failure), never in an emptied event loop.
  const hang = () => new Promise((_, rej) => { w.sleep(limit + 1).catch(rej); });
  w.now = () => clock;
  w.sleep = (ms) => {
    let t;
    const p = new Promise((res, rej) => { t = { at: clock + Math.max(1, ms), res, rej, live: true }; timers.push(t); });
    p.cancel = () => { t.live = false; const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); };
    schedule();
    return p;
  };
  w.settle = async () => { for (let i = 0; i < 200 && timers.some((t) => t.live); i++) await new Promise((r) => setImmediate(r)); };
  w.send = async (method, params = {}) => {
    w.log.push({ m: method, targetId: params.targetId, at: clock });
    if (method === 'Target.createTarget') {
      if (w.rules.lateCreateMs !== null) await w.sleep(w.rules.lateCreateMs);
      const id = `X${++seq}`;
      w.open.add(id);
      return { targetId: id };
    }
    if (method === 'Target.activateTarget') {
      const id = params.targetId;
      if (w.rules.rejectActivate) throw new Error(w.rules.rejectActivate);
      if (w.rules.hangActivate) return hang();
      const n = (w.acts[id] = (w.acts[id] || 0) + 1);
      if (w.rules.never || w.rules.dead.has(id) || n <= (w.rules.lose[id] || 0)) return {};
      w.sleep(w.rules.delayMs).then(() => {
        if (id === PAGE) w.page = 'visible';
        else if (w.open.has(id)) w.page = 'hidden';
      }, () => {});
      return {};
    }
    if (method === 'Target.closeTarget') {
      w.open.delete(params.targetId);
      if (params.targetId !== PAGE) w.page = 'visible';
      return { success: true };
    }
    throw new Error(`stand-in: unexpected ${method}`);
  };
  w.read = async () => {
    w.log.push({ m: 'read', v: w.page, at: clock });
    if (w.rules.hangRead) return hang();
    return w.page;
  };
  w.switcher = (extra = {}) => driver.makeTabSwitcher({
    send: w.send, pageTargetId: PAGE, readState: w.read, budgetMs: BUDGET, attempts: ATTEMPTS, pollMs: POLL, now: w.now, sleep: w.sleep, warn: (m) => w.warns.push(m), ...extra,
  });
  w.sent = (m, id) => w.log.filter((e) => e.m === m && (id === undefined || e.targetId === id));
  return w;
}

test('U1: a healthy switch costs one activation, no re-send, and prints nothing', async () => {
  const w = world();
  const s = w.switcher();
  await s.background();
  assert.deepEqual(w.log.filter((e) => e.m !== 'read').map((e) => e.m), ['Target.createTarget', 'Target.activateTarget']);
  assert.equal(w.page, 'hidden');
  assert.deepEqual(w.warns, []);
  w.log.length = 0;
  await s.foreground();
  assert.equal(w.sent('Target.activateTarget').length, 1);
  assert.equal(w.sent('Target.activateTarget', PAGE).length, 1);
  assert.equal(w.sent('Target.createTarget').length, 0);
  const closes = w.sent('Target.closeTarget');
  assert.equal(closes.length, 1);
  assert.equal(closes[0].targetId, 'X1');
  const closeAt = w.log.indexOf(closes[0]);
  assert.ok(w.log.slice(0, closeAt).some((e) => e.m === 'read' && e.v === 'visible'), 'the extra tab is closed only after the page was read as visible');
  assert.deepEqual(w.warns, []);
});

test('U2: a lost first activation is re-sent to the same tab, after budget/attempts, and said so', async () => {
  const w = world();
  w.rules.lose.X1 = 1;
  await w.switcher().background();
  assert.equal(w.page, 'hidden');
  assert.equal(w.sent('Target.createTarget').length, 1, 'no second tab');
  const acts = w.sent('Target.activateTarget');
  assert.deepEqual(acts.map((e) => e.targetId), ['X1', 'X1']);
  const gap = acts[1].at - acts[0].at;
  assert.ok(gap >= BUDGET / ATTEMPTS && gap <= BUDGET / ATTEMPTS + POLL, `second activation ${gap}ms after the first`);
  assert.equal(w.warns.length, 1);
  assert.match(w.warns[0], /hidden/);
  assert.match(w.warns[0], /2 activations/);
});

test('U3: foreground, first activation lost: two activations to the page, tab closed only after visible', async () => {
  const w = world();
  const s = w.switcher();
  await s.background();
  w.log.length = 0;
  w.warns.length = 0;
  w.rules.lose[PAGE] = 1;
  await s.foreground();
  assert.equal(w.page, 'visible');
  assert.equal(w.sent('Target.activateTarget', PAGE).length, 2);
  const closes = w.sent('Target.closeTarget');
  assert.equal(closes.length, 1);
  const closeAt = w.log.indexOf(closes[0]);
  assert.ok(w.log.slice(0, closeAt).some((e) => e.m === 'read' && e.v === 'visible'), 'closed after visible was read, never before');
  assert.equal(w.warns.length, 1);
  assert.match(w.warns[0], /visible/);
  assert.match(w.warns[0], /2 activations/);
});

test('U4: the switch can never happen (negative control): a named error after exactly `attempts` activations', async () => {
  const w = world();
  w.rules.never = true;
  const s = w.switcher();
  await assert.rejects(() => s.background(), (e) => {
    assert.match(e.message, /^background: /);
    assert.match(e.message, /wanted document\.visibilityState === 'hidden'/);
    assert.match(e.message, /after 4 Target\.activateTarget/);
    assert.match(e.message, /in \d+ms/);
    return true;
  });
  assert.equal(w.sent('Target.activateTarget').length, ATTEMPTS, 'never more than `attempts`');
  assert.ok(w.now() <= BUDGET, `virtual elapsed ${w.now()}ms is within the budget`);

  const f = world();
  const fs = f.switcher();
  await fs.background();
  f.rules.never = true;
  const t0 = f.now();
  f.log.length = 0;
  await assert.rejects(() => fs.foreground(), (e) => {
    assert.match(e.message, /^foreground: /);
    assert.match(e.message, /wanted document\.visibilityState === 'visible'/);
    assert.match(e.message, /after 4 Target\.activateTarget/);
    assert.match(e.message, /in \d+ms/);
    return true;
  });
  assert.equal(f.sent('Target.activateTarget', PAGE).length, ATTEMPTS);
  assert.ok(f.now() - t0 <= BUDGET);
});

test('U5: a failed background leaves no stale state: the extra tab is closed and the next call makes a new one', async () => {
  const w = world();
  w.rules.never = true;
  const s = w.switcher();
  await assert.rejects(() => s.background(), /wanted document\.visibilityState === 'hidden'/);
  assert.deepEqual(w.sent('Target.closeTarget').map((e) => e.targetId), ['X1'], 'the extra tab was closed exactly once');
  w.rules.never = false;
  await s.background();
  assert.equal(w.sent('Target.createTarget').length, 2, 'a NEW tab, not a skipped call');
  assert.ok(w.sent('Target.activateTarget', 'X2').length >= 1);
  assert.equal(w.page, 'hidden');
});

test('U6: a failed foreground keeps the tab so a later foreground can finish', async () => {
  const w = world();
  const s = w.switcher();
  await s.background();
  w.rules.dead.add(PAGE);
  await assert.rejects(() => s.foreground(), /wanted document\.visibilityState === 'visible'/);
  assert.equal(w.sent('Target.closeTarget').length, 0, 'the extra tab is still open');
  w.rules.dead.delete(PAGE);
  await s.foreground();
  assert.equal(w.page, 'visible');
  assert.deepEqual(w.sent('Target.closeTarget').map((e) => e.targetId), ['X1'], 'the held tab closed once, by the call that finished');
});

test('U7: a hung send or read, or a createTarget that answers after the deadline, ends in the named error within the budget', async () => {
  const hungActivate = world();
  hungActivate.rules.hangActivate = true;
  await assert.rejects(() => hungActivate.switcher().background(), /wanted document\.visibilityState === 'hidden', not reached after 1 Target\.activateTarget/);
  assert.ok(hungActivate.now() <= BUDGET);

  const hungRead = world();
  hungRead.rules.hangRead = true;
  await assert.rejects(() => hungRead.switcher().background(), /wanted document\.visibilityState === 'hidden'/);
  assert.ok(hungRead.now() <= BUDGET);

  const late = world();
  late.rules.lateCreateMs = BUDGET + 5000;
  await assert.rejects(() => late.switcher().background(), /wanted document\.visibilityState === 'hidden', not reached after 0 Target\.activateTarget/);
  assert.ok(late.now() <= BUDGET);
  assert.equal(late.sent('Target.closeTarget').length, 0, 'the reply has not come yet');
  await late.settle();
  assert.deepEqual(late.sent('Target.closeTarget').map((e) => e.targetId), ['X1'], 'the late tab is closed when its reply arrives');
  assert.equal(late.open.size, 0, 'no tab leaked');
});

test('U8: a rejected send is not retried: it propagates with its own message', async () => {
  const w = world();
  w.rules.rejectActivate = 'fake: no such target';
  await assert.rejects(() => w.switcher().background(), /fake: no such target/);
  assert.equal(w.sent('Target.activateTarget').length, 1);
  assert.deepEqual(w.sent('Target.closeTarget').map((e) => e.targetId), ['X1'], 'and the extra tab is not left behind');
  const f = world();
  const s = f.switcher();
  await s.background();
  f.rules.rejectActivate = 'fake: socket closed';
  await assert.rejects(() => s.foreground(), /fake: socket closed/);
  assert.equal(f.sent('Target.activateTarget', PAGE).length, 1);
});

test('U9: a held tab does not make background() skip the call unless the page really is hidden', async () => {
  const a = world();
  const sa = a.switcher();
  await sa.background();
  a.log.length = 0;
  await sa.background();
  assert.deepEqual(a.log.filter((e) => e.m !== 'read'), [], 'already hidden: no new send');

  const b = world();
  const sb = b.switcher();
  await sb.background();
  b.page = 'visible'; // something else brought the page forward
  b.log.length = 0;
  await sb.background();
  assert.equal(b.sent('Target.createTarget').length, 0, 'no second tab');
  assert.equal(b.sent('Target.activateTarget', 'X1').length, 1, 'a fresh activation of the held tab');
  assert.equal(b.page, 'hidden');
  assert.deepEqual(b.warns, []);
});

test('U10: the defaults are the wait floor and two attempts', async () => {
  const w = world({ limit: WAIT_FLOOR_MS * 10 });
  w.rules.never = true;
  const s = driver.makeTabSwitcher({ send: w.send, pageTargetId: PAGE, readState: w.read, now: w.now, sleep: w.sleep, warn: () => {} });
  await assert.rejects(() => s.background(), (e) => {
    assert.match(e.message, new RegExp(`budget ${driver.effectiveWaitMs(WAIT_FLOOR_MS)}ms`));
    assert.match(e.message, /after 2 Target\.activateTarget/);
    return true;
  });
});

// One real browser. The shipped promise: a second tab really hides the page and
// closing it really brings it back, as two trusted visibilitychange events per
// switch, with no tab leaked.
test('B1/B2: the real browser, one launch', async (t) => {
  const page = await launchPage(DRIVER, { acceptance: true });
  t.after(() => page.close());
  const pageTargets = async () => (await page.cdp.browserSend('Target.getTargets')).targetInfos.filter((i) => i.type === 'page');
  const count = async (want) => {
    for (let i = 0; i < 100; i++) { const n = (await pageTargets()).length; if (n === want) return n; await new Promise((r) => setTimeout(r, 50)); }
    return (await pageTargets()).length;
  };
  const state = () => page.evaluate('document.visibilityState');
  const n = (await pageTargets()).length;

  await t.test('B1: background and return keep their promise: events, tabs, idempotence', async () => {
    await page.background();
    assert.equal(await state(), 'hidden');
    assert.equal(await count(n + 1), n + 1);
    await page.background();
    assert.equal(await count(n + 1), n + 1, 'a second background() opens no second tab');
    assert.equal(await state(), 'hidden');
    await page.foreground();
    assert.equal(await state(), 'visible');
    assert.equal(await count(n), n, 'foreground() closes the extra tab');
    await page.background();
    await page.foreground();
    const log = await page.visibilityLog();
    assert.deepEqual(log.map((e) => e.state), ['hidden', 'visible', 'hidden', 'visible']);
    assert.ok(log.every((e) => e.trusted), 'the browser fired them');
  });

  await t.test('B2: a held tab with a visible page is switched again', async () => {
    await page.background();
    const own = (await pageTargets()).find((i) => i.url.endsWith('driver-fixture.html'));
    assert.ok(own, 'found the page target');
    await page.cdp.browserSend('Target.activateTarget', { targetId: own.targetId });
    await page.waitFor("document.visibilityState === 'visible'");
    await page.background();
    assert.equal(await state(), 'hidden', 'the page was brought forward by something else; background() hid it again');
    await page.foreground();
    const log = await page.visibilityLog();
    assert.deepEqual(log.slice(4).map((e) => e.state), ['hidden', 'visible', 'hidden', 'visible']);
    assert.equal(log.length, 8);
    assert.ok(log.every((e) => e.trusted));
    assert.equal(await count(n), n, 'no tab leaked');
  });
});
