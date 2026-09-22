// Three brass instrument records (src/instruments/trumpet-bb.js, horn-f.js,
// trombone.js) shipped with status: 'planned', curriculum: [] and no MODS
// entry -- a learner could never pick or play any of them. This drives each
// one end to end through its own MODS entry: select it, get a task, and
// answer the correct note through the REAL sustained-tone judging path
// (window.__coach.testSource(), the same technique
// tests/characterization/wind-octave-policy.test.mjs uses for MODS.wind --
// wires a real oscillator into the real analyser/pitch-worklet chain,
// exercising onPitch()'s M.input === 'sustain' branch, not just the debug
// hook's note()-credit bypass tests/characterization/fretted-instruments-
// playable.test.mjs uses for pluck instruments).
//
// Each of the three has a FIXED windKind (src/app.js MODS.trumpet-bb/horn-f/
// trombone), unlike the generic MODS.wind trainer whose transposition comes
// from the learner's prefs.wind. The tests below exercise that directly: a
// wrong prefs.wind must not change a brass mod's own clef or transposition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { byId } from '../../src/instruments/index.js';

const htmlPath = HTML_PATH;
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS_PATH = path.join(__dirname, '..', '..', 'src', 'app.js');

const BRASS_IDS = ['trumpet-bb', 'horn-f', 'trombone'];

for (const id of BRASS_IDS) {
  test(`${id}: selectable, and a real sustained tone at the task pitch is credited`, async (t) => {
    const page = await launchPage(htmlPath);
    t.after(() => page.close());

    await page.evaluate(`window.__coach.setMod(${JSON.stringify(id)})`);
    assert.equal(await page.evaluate('window.__coach.db().prefs.mod'), id, `${id} should be selectable via setMod`);

    await page.evaluate("document.getElementById('playBtn').click()");
    await page.waitFor('window.__coach.task()');

    const info = await page.evaluate('window.__coach.cur().info');
    assert.equal(info.kind, 'note', `${id} level 1 should hand out a note task`);
    assert.ok(Number.isFinite(info.midi), `${id} task note should have a real midi pitch`);

    const freq = midiToFreq(info.midi);
    await page.evaluate(`window.__coach.testSource([${freq}])`);
    await page.waitFor('window.__coach.task() && window.__coach.task().done', 8000);

    assert.equal(
      await page.evaluate('window.__coach.task().idx'),
      1,
      `${id}: the real sustained tone at the task pitch should have been credited`
    );
  });
}

test('trumpet-bb/horn-f/trombone task info encodes each instrument\'s own fixed transposition, consistent with its record', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  for (const id of BRASS_IDS) {
    await page.evaluate(`window.__coach.setMod(${JSON.stringify(id)})`);
    await page.evaluate("document.getElementById('playBtn').click()");
    await page.waitFor('window.__coach.task()');
    const info = await page.evaluate('window.__coach.cur().info');
    const rec = byId[id];
    assert.equal(info.midi, info.written + rec.transposition, `${id}: sounding midi should equal written + the record's own transposition`);
    assert.equal(info.clef, rec.clefs[0], `${id}: task clef should match the record's own clef`);
  }
});

test('trumpet-bb ignores the learner\'s generic wind preference: windKind is fixed, not read from prefs.wind', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('trumpet-bb')");
  // Set the *global* wind preference to the bass-clef family. If
  // trumpet-bb's info() ever fell back to reading prefs.wind instead of its
  // own fixed windKind, this would flip its clef to bass -- it must not.
  await page.evaluate("window.__coach.db().prefs.wind = 'bc'");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  assert.equal(info.clef, 'treble', 'trumpet-bb must stay treble clef regardless of the learner\'s generic wind preference');
});

test('no console errors while drawing the brass staff for each instrument', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  for (const id of BRASS_IDS) {
    await page.evaluate(`window.__coach.setMod(${JSON.stringify(id)})`);
    await page.evaluate("document.getElementById('playBtn').click()");
    await page.waitFor('window.__coach.task()');
  }

  assert.deepEqual(page.consoleErrors, [], 'drawing the brass staff should not log any console errors');
  assert.deepEqual(page.exceptions, [], 'drawing the brass staff should not throw');
});

// drawStaff() is the shared hand-built staff renderer MODS.wind and all
// three brass mods above now use via the generic `M.staff` flag (rather than
// `mod === 'wind'`) -- see draw()'s dispatch in src/app.js. It also carries
// a forward contract for a sibling unit (recorder/tin whistle, R3): a staff
// mod whose items are plain 'n' ids (info() has `midi` but no `written`/
// `clef` of its own, unlike this trio's 'w' ids) must still render, at
// info.midi + (M.writtenOffset || 0) on the treble staff, rather than
// throwing on `undefined` arithmetic. None of today's ready mods actually
// use that 'n'-id + writtenOffset shape (this trio's own items always carry
// `written`/`clef`), so this is pinned at the source level: the exact
// fallback expression drawStaff must keep, so a future writtenOffset mod
// (or an accidental edit to this function) cannot silently drop it.
test('drawStaff falls back to info.midi + M.writtenOffset for items with no written/clef of their own (the R3 staff-mod contract)', () => {
  const src = readFileSync(APP_JS_PATH, 'utf8');
  assert.match(
    src,
    /const m = el\.info\.written !== undefined \? el\.info\.written : el\.info\.midi \+ \(M\.writtenOffset \|\| 0\)/,
    'drawStaff must fall back to info.midi + (M.writtenOffset || 0) for a staff-mod item with no written/clef (plain \'n\' ids)'
  );
  assert.match(src, /function drawStaff\(M, e, W, H\) \{/, 'drawStaff must take the mod record M so it can read M.writtenOffset');
});
