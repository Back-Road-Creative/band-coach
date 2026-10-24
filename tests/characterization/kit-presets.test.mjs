import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchPage } from '../helpers/browser.mjs';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { kitRegions, pieceAt } from '../../src/instruments/how/drum-kit.js';

test('kit setup updates the canvas and reference, survives reload, and stays instrument-specific', async t => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.setViewport({ width: 390, height: 844, mobile: true });
  await page.evaluate("window.__coach.setMod('drum-kit'); document.getElementById('setupBtn').click()");
  assert.equal(await page.evaluate("!!document.getElementById('kitPreset')"), true);
  await page.evaluate(`(() => {
    const p = document.getElementById('kitPreset'); p.value = 'compact'; p.dispatchEvent(new Event('change'));
    document.getElementById('kitLeftHanded').click(); document.getElementById('kitShow-ride').click();
  })()`);
  await page.waitFor("window.__coach.kitLabels().length === 9");
  const opts = { preset: 'compact', leftHanded: true, hiddenPieces: ['ride'] };
  const state = await page.evaluate('({ prefs: window.__coach.db().prefs.kit, box: window.__coach.kitBox() })');
  assert.deepEqual(state.prefs, opts);
  const backup = await page.evaluate('window.__coach.exportProgress()');
  await page.evaluate("document.getElementById('kitLeftHanded').click()");
  assert.equal(await page.evaluate('window.__coach.db().prefs.kit.leftHanded'), false);
  assert.equal(await page.evaluate(`window.__coach.importProgress(${JSON.stringify(JSON.stringify(backup))}).then(r => r.ok)`), true);
  assert.deepEqual(await page.evaluate('window.__coach.db().prefs.kit'), opts);
  const snare = kitRegions(state.box, opts).find(r => r.id === 'snare');
  await page.evaluate(`(() => { const c = document.getElementById('cv'), r = c.getBoundingClientRect(); c.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + ${snare.cx} * r.width / c.width, clientY: r.top + ${snare.cy} * r.height / c.height })); })()`);
  // The saved profile follows the normal backup/restore sanitiser on reload.
  await page.evaluate("window.dispatchEvent(new Event('pagehide'))");
  await page.reload();
  await page.waitFor("window.__coach.kitLabels().length === 9");
  assert.deepEqual(await page.evaluate('window.__coach.db().prefs.kit'), opts);
  await page.evaluate("window.__coach.openPanel('fingerings')");
  await page.waitFor("document.querySelector('.fing-drumkit')");
  assert.equal(await page.evaluate("!!document.querySelector('.fing-drumkit [data-piece=ride]')"), false);
  await page.evaluate("document.getElementById('kitShow-ride').click()");
  assert.equal(await page.evaluate("!!document.querySelector('.fing-drumkit [data-piece=ride]')"), true, 'an already-open reference updates with setup');
  await page.evaluate("window.__coach.setMod('kbd')");
  assert.equal(await page.evaluate("document.getElementById('kitSetup').hidden"), true);
});

for (const [width, height] of [[320, 568], [390, 844], [1440, 900]]) {
  test(`all kit presets and mirrors fit at ${width}x${height}, idle and playing`, async t => {
    const page = await launchPage(HTML_PATH);
    t.after(() => page.close());
    await page.setViewport({ width, height, mobile: width < 500 });
    for (const preset of ['standard', 'compact']) for (const leftHanded of [false, true]) {
      await page.evaluate(`window.__coach.setMod('drum-kit'); window.__coach.db().prefs.kit = ${JSON.stringify({ preset, leftHanded, hiddenPieces: [] })}`);
      for (const playing of [false, true]) {
        if (playing) {
          await page.evaluate("document.getElementById('playBtn').click()");
          await page.waitFor('window.__coach.bar() && window.__coach.bar().staff');
        }
        await page.evaluate('new Promise(r => setTimeout(r, 400))');
        const d = await page.evaluate('({ box: window.__coach.kitBox(), labels: window.__coach.kitLabels(), W: document.getElementById("cv").width, H: document.getElementById("cv").height, cssWidth: document.getElementById("cv").getBoundingClientRect().width })');
        assert.equal(d.labels.length, 10);
        const regions = kitRegions(d.box, { preset, leftHanded });
        const kick = regions.find(r => r.id === 'kick');
        assert.ok(kick.w * d.cssWidth / d.W >= 23.9, 'kick keeps a 24 CSS px wide footboard (subpixel rounding)' );
        const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        for (const l of d.labels) {
          assert.ok(l.x >= 0 && l.y >= 0 && l.x + l.w <= d.W && l.y + l.h <= d.H, `${preset}/${leftHanded}/${playing}: ${l.id} stays inside`);
          for (const other of d.labels) if (other.id !== l.id) assert.ok(!overlaps(l, other), `${preset}/${leftHanded}/${playing}: ${l.id} overlaps ${other.id}`);
          for (const r of regions) if (r.id !== l.id) {
            const hit = r.kind === 'circle' ? Math.hypot(Math.max(l.x - r.cx, 0, r.cx - l.x - l.w), Math.max(l.y - r.cy, 0, r.cy - l.y - l.h)) < r.r : overlaps(l, r);
            assert.ok(!hit, `${preset}/${leftHanded}/${playing}: ${l.id} overlaps ${r.id} shape`);
          }
        }
      }
    }
  });
}

test('hidden lesson pieces reappear and clicks use the visible mirrored targets', async t => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('drum-kit'); window.__coach.db().prefs.kit = { leftHanded: true, hiddenPieces: ['kick', 'snare', 'ride'] }; document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.bar() && window.__coach.bar().staff');
  await page.evaluate('new Promise(r => setTimeout(r, 400))');
  const d = await page.evaluate('({ box: window.__coach.kitBox(), labels: window.__coach.kitLabels(), pieces: [...new Set(window.__coach.bar().onsets.flatMap(o => o.pieces))] })');
  for (const id of d.pieces) assert.ok(d.labels.some(l => l.id === id));
  assert.ok(!d.labels.some(l => l.id === 'ride'));
  const snare = kitRegions(d.box, { leftHanded: true }).find(r => r.id === 'kick');
  await page.evaluate(`(() => { const bar = window.__coach.bar(); bar.playAt = 0; window.__coach.state().offset = 0; window.__coach.db().latencyMs = 0; const c = document.getElementById('cv'), r = c.getBoundingClientRect(); c.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + ${snare.cx} * r.width / c.width, clientY: r.top + ${snare.cy} * r.height / c.height })); })()`);
  assert.equal(await page.evaluate('window.__coach.bar().taps.at(-1).piece'), 'kick');
});

test('dragging a piece on the set-up sheet saves it, moves the click target, and Reset restores the preset', async t => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await page.waitFor('window.__coach.kitBox()');
  await page.evaluate("document.getElementById('setupBtn').click()");
  const drag = (id, dx, dy) => page.evaluate(`(() => {
    const svg = document.getElementById('kitPreview'), el = svg.querySelector('[data-piece="${id}"]'), b = svg.getBoundingClientRect(), e = el.getBoundingClientRect();
    const sx = e.left + e.width / 2, sy = e.top + e.height / 2, fire = (type, x, y) => (type === 'pointerdown' ? el : svg).dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
    fire('pointerdown', sx, sy); fire('pointermove', sx + ${dx} * b.height, sy + ${dy} * b.height); fire('pointerup', sx + ${dx} * b.height, sy + ${dy} * b.height);
  })()`);
  const before = await page.evaluate("window.__coach.kitBox()");
  const home = kitRegions(before, {}).find(r => r.id === 'snare');
  await drag('snare', -0.2, -0.3);
  const saved = await page.evaluate('window.__coach.db().prefs.kit');
  assert.ok(saved.placements && saved.placements.snare, 'placement saved');
  assert.ok(Math.abs(saved.placements.snare.x - (0.465 - 0.2)) < 0.03 && Math.abs(saved.placements.snare.y - (0.66 - 0.3)) < 0.03, JSON.stringify(saved.placements));
  const moved = kitRegions(before, saved).find(r => r.id === 'snare');
  assert.ok(moved.cx < home.cx && moved.cy < home.cy);
  assert.equal(pieceAt(moved.cx, moved.cy, before, saved), 'snare', 'the click target followed the drag');
  assert.notEqual(pieceAt(home.cx, home.cy, before, saved), 'snare');
  await page.evaluate("document.getElementById('kitSize').value = '1.5'; document.getElementById('kitSize').dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('kitSize').dispatchEvent(new Event('change', { bubbles: true }))");
  assert.equal(await page.evaluate('window.__coach.db().prefs.kit.placements.snare.scale'), 1.5);
  await page.evaluate("document.getElementById('kitReset').click()");
  assert.equal(await page.evaluate("'placements' in window.__coach.db().prefs.kit"), false);
});

test('a cancelled drag keeps the piece where it was last moved, and the size slider opens on the first piece\'s saved scale', async t => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.db().prefs.kit = { placements: { kick: { x: 0.5, y: 0.5, scale: 1.3 } } }; window.__coach.setMod('drum-kit')");
  await page.waitFor('window.__coach.kitBox()');
  await page.evaluate("document.getElementById('setupBtn').click()");
  assert.equal(await page.evaluate("document.getElementById('kitSize').value"), '1.3');
  await page.evaluate(`(() => {
    const svg = document.getElementById('kitPreview'), el = svg.querySelector('[data-piece="snare"]'), b = svg.getBoundingClientRect(), e = el.getBoundingClientRect();
    const sx = e.left + e.width / 2, sy = e.top + e.height / 2, fire = (type, x, y) => (type === 'pointerdown' ? el : svg).dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
    fire('pointerdown', sx, sy); fire('pointermove', sx - 0.2 * b.height, sy - 0.2 * b.height); fire('pointercancel', 0, 0);
  })()`);
  const p = await page.evaluate('window.__coach.db().prefs.kit.placements.snare');
  assert.ok(p.x > 0.1 && p.y > 0.1, 'cancel must not land at the corner: ' + JSON.stringify(p));
});
