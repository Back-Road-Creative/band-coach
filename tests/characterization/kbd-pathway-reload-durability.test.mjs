// Pathway state is derived from the stored DB, not memory: a learner whose
// sitting left a due recheck (an independent whole-piece check a day+ ago)
// and a weak item (a later wrong-note row) must still be offered the
// recheck step after a real page reload -- and after a second reload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

test('a due recheck and a weak item survive page reloads: the panel still offers the check step', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await page.evaluate(`(function () {
    const db = window.__coach.db();
    db.mods.kbd.level = 2;
    const day = 24 * 3600 * 1000;
    db.events = (db.events || []).concat([
      { v: 1, id: 'seed-check', at: Date.now() - 2 * day, instrument: 'kbd', skill: 'whole:null', source: 'song', songId: 'hot-cross-buns', assistance: 'none', dims: { pitch: 'ok', rhythm: 'ok' }, unassessed: [], activeMs: 0, input: 'midi' },
      { v: 1, id: 'seed-weak', at: Date.now() - 60000, instrument: 'kbd', skill: 'C4', source: 'drill', assistance: 'none', dims: { pitch: 'miss' }, unassessed: [], activeMs: 0, input: 'midi' },
    ]);
    db.sessions = (db.sessions || []).concat([{ d: '2020-01-01', mod: 'kbd', min: 5, acc: 1, a1: 1, a2: 1, from: 2, to: 2, breaks: 0, source: 'song', songId: 'hot-cross-buns' }]);
    window.localStorage.setItem('bandcoach.v1', JSON.stringify(db));
  })()`);

  for (let i = 0; i < 2; i++) {
    await page.reload();
    await page.evaluate("window.__coach.setMod('kbd')");
    await page.evaluate("document.getElementById('kbdPathwayBtn').click()");
    await page.waitFor("!document.getElementById('panelHost').hidden");
    const state = await page.evaluate(`({
      step: (document.querySelector('.pathway-steps li[aria-current="step"]') || {getAttribute: () => null}).getAttribute('data-step'),
      hasAction: !!document.getElementById('pathwayAction'),
      events: window.__coach.db().events.map(e => e.id).filter(id => id.indexOf('seed-') === 0),
    })`);
    assert.equal(state.step, 'return', `reload ${i + 1}: expected step "return", got ${JSON.stringify(state)}`);
    assert.ok(state.hasAction, `reload ${i + 1}: expected the recheck action button`);
    assert.deepEqual(state.events, ['seed-check', 'seed-weak'], `reload ${i + 1}: seeded rows must persist`);
  }
  assert.deepEqual(page.exceptions, []);
});
