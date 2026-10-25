// The trainer's canvas fretboard (drawFret) used to ignore the capo and
// left-handed choices the "How to play it" panel honours. It now reads the
// same saved setup (instrumentSetup) so the two agree. window.__coach.fretView()
// is a dev-hook record of the last drawn board: {leftHanded, capo, nutX, W,
// dots:[{string, fret, x, y, kind}]} -- kind 'hint' (heard pitch) or 'target'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const setup = (page, entry, id = 'gtr') => page.evaluate(`(() => {
  const c = window.__coach; c.setMod(${JSON.stringify(id)});
  c.db().panels = Object.assign(c.db().panels || {}, { fingerings: { byInstrument: { ${JSON.stringify(id)}: ${JSON.stringify(entry)} } } });
  document.getElementById('playBtn').click();
})()`);
// Reveal a target: string 2 (B), fret 3 = D4 (62), string 1 = high E.
const target = (page, info) => page.evaluate(`(() => { const e = window.__coach.cur(); e.info = Object.assign({}, e.info, ${JSON.stringify(info)}); e.reveal = true; })()`);
const view = async (page, pred) => { await page.waitFor(`(() => { const v = window.__coach.fretView(); return v && (${pred}) })()`, 4000); return page.evaluate('JSON.parse(JSON.stringify(window.__coach.fretView()))'); };
const tgt = v => v.dots.filter(d => d.kind === 'target');

test('default setup: right-handed, no capo, target at its own string/fret, nut on the left', async (t) => {
  const page = await launchPage(HTML_PATH); t.after(() => page.close());
  await setup(page, { capo: 0, leftHanded: false });
  await page.waitFor('window.__coach.task()');
  await target(page, { midi: 62, string: 2, fret: 3 });
  const v = await view(page, 'v.dots.some(d => d.kind === "target" && d.string === 2)');
  assert.equal(v.leftHanded, false); assert.equal(v.capo, 0);
  assert.ok(v.nutX < v.W / 2, 'nut on the left');
  assert.deepEqual(tgt(v).map(d => [d.string, d.fret]), [[2, 3]]);
  assert.ok(tgt(v)[0].x > v.nutX, 'fret 3 is to the right of the nut');
  // the pre-existing geometry, unchanged: nut at 15% of the width, open-string dots 3.5% left of it
  assert.ok(Math.abs(v.nutX - v.W * 0.15) < 1e-6);
  await target(page, { midi: 64, string: 1, fret: 0 });
  const o = await view(page, 'v.dots.some(d => d.kind === "target" && d.string === 1)');
  assert.ok(Math.abs(tgt(o)[0].x - v.W * 0.115) < 1e-6);
});

test('left-handed: string rows reversed like the How panel, nut and fret positions unchanged', async (t) => {
  const page = await launchPage(HTML_PATH); t.after(() => page.close());
  await setup(page, { capo: 0, leftHanded: false });
  await page.waitFor('window.__coach.task()');
  await target(page, { midi: 62, string: 2, fret: 3 });
  const r = await view(page, 'v.dots.some(d => d.kind === "target" && d.string === 2)');
  await setup(page, { capo: 0, leftHanded: true });
  await page.waitFor('window.__coach.task()');
  await target(page, { midi: 62, string: 2, fret: 3 });
  const l = await view(page, 'v.leftHanded && v.dots.some(d => d.kind === "target" && d.string === 2)');
  assert.equal(l.nutX, r.nutX, 'nut stays on the left');
  assert.equal(tgt(l)[0].x, tgt(r)[0].x, 'fret position unchanged');
  assert.deepEqual(tgt(l).map(d => [d.string, d.fret]), [[2, 3]], 'same string and fret');
  // 6 strings: string 2 sits in the row string 5 normally has (row s <-> 7 - s)
  await target(page, { midi: 64, string: 5, fret: 0 });
  const l5 = await view(page, 'v.leftHanded && v.dots.some(d => d.kind === "target" && d.string === 5)');
  assert.equal(tgt(l5)[0].y, tgt(r)[0].y, 'string 5 takes the row string 2 has right-handed');
});

test('capo 2: hint dots stay at f >= 2, behind-capo target moves to reachable positions', async (t) => {
  const page = await launchPage(HTML_PATH); t.after(() => page.close());
  await setup(page, { capo: 2, leftHanded: false });
  await page.waitFor('window.__coach.task()');
  // E4 (64): open high E (string 1, fret 0) is behind the capo; reachable: string 2 fret 5, string 3 fret 9...
  await target(page, { midi: 64, string: 1, fret: 0 });
  const v = await view(page, 'v.capo === 2 && v.dots.some(d => d.kind === "target" && d.string === 2)');
  assert.ok(tgt(v).length >= 1);
  assert.ok(tgt(v).every(d => d.fret >= 2), 'no target behind the capo');
  assert.ok(tgt(v).some(d => d.string === 2 && d.fret === 5));
  assert.ok(!tgt(v).some(d => d.string === 1 && d.fret === 0));
  // a target at/after the capo is untouched
  await target(page, { midi: 66, string: 1, fret: 2 });
  const w = await view(page, 'v.dots.some(d => d.kind === "target" && d.string === 1 && d.fret === 2)');
  assert.deepEqual(tgt(w).map(d => [d.string, d.fret]), [[1, 2]]);
});

for (const [capo, label] of [[0, 'control: no capo'], [2, 'capo 2']]) {
  test(`${label}: hint dots for a heard E4 ${capo ? 'skip frets behind the capo' : 'include the open string'}`, async (t) => {
    const page = await launchPage(HTML_PATH); t.after(() => page.close());
    await setup(page, { capo, leftHanded: false });
    await page.waitFor('window.__coach.task()');
    // E4 (64.0): open high E (string 1, fret 0), string 2 fret 5, string 3 fret 9 ...
    await page.evaluate('window.__coach.testPluck(329.63, [0])');
    const v = await view(page, 'v.dots.some(d => d.kind === "hint")');
    const hints = v.dots.filter(d => d.kind === 'hint');
    assert.ok(hints.some(d => d.string === 2 && d.fret === 5));
    assert.equal(hints.some(d => d.fret < capo), false, 'nothing behind the capo');
    assert.equal(hints.some(d => d.string === 1 && d.fret === 0), capo === 0);
  });
}
