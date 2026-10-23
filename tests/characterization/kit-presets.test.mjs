import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchPage } from '../helpers/browser.mjs';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { kitRegions } from '../../src/instruments/how/drum-kit.js';

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
