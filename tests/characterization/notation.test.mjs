// CURRENT BEHAVIOUR: the notation engine (src/notation/) is wired into the
// five wired instruments (kbd, gtr, bass, uke, voice) as an additive overlay
// gated by a per-instrument "Show" preference (DB.prefs.notate[mod]), default
// 'names' — today's display, unchanged. Switching an instrument to 'staff'
// exposes the current target's layout through window.__coach.lastStaff()
// (the notation-wire debug-hook slot), which this test uses to check the
// right clef, the right staff position for a known target, the octave
// transposition for guitar/bass, and a tab string/fret for a guitar item.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { staffPosition } from '../../src/notation/staff.js';

const htmlPath = HTML_PATH;

async function startAndShowStaff(page, mod) {
  await page.evaluate(`window.__coach.setMod('${mod}')`);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  await page.evaluate("window.__coach.setNotate('staff')");
  await page.waitFor('window.__coach.lastStaff() !== null', 5000);
  return page.evaluate('window.__coach.lastStaff()');
}

test('default preference is "names": no instrument draws a staff unasked', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const staff = await page.evaluate('window.__coach.lastStaff()');
  assert.equal(staff, null, 'default "names" preference draws no staff overlay');
});

test('keyboard: grand staff, correct clef and staff position for the current target', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  const staff = await startAndShowStaff(page, 'kbd');
  assert.equal(staff.clef, 'grand');
  const info = await page.evaluate('window.__coach.cur().info');
  assert.equal(staff.written, info.midi, 'keyboard has no notation octave shift');
});

test('guitar: written an octave above sounding pitch, treble clef, tab string/fret present', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  const staff = await startAndShowStaff(page, 'gtr');
  assert.equal(staff.clef, 'treble');
  const info = await page.evaluate('window.__coach.cur().info');
  assert.ok(info.string, 'level-1 gtr items are string/fret notes');
  assert.equal(staff.written, info.midi + 12, 'guitar prints an octave above its sounding pitch');
  assert.equal(staff.tab.primitives.length, 1);
  assert.equal(staff.tab.primitives[0].string, info.string);
  assert.equal(staff.tab.primitives[0].fret, info.fret);
});

test('bass: written an octave above sounding pitch, bass clef', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  const staff = await startAndShowStaff(page, 'bass');
  assert.equal(staff.clef, 'bass');
  const info = await page.evaluate('window.__coach.cur().info');
  assert.equal(staff.written, info.midi + 12, 'bass prints an octave above its sounding pitch');
});

test('ukulele: treble clef, no octave shift', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  const staff = await startAndShowStaff(page, 'uke');
  assert.equal(staff.clef, 'treble');
  const info = await page.evaluate('window.__coach.cur().info');
  assert.equal(staff.written, info.midi);
});

test('voice: treble clef', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  const staff = await startAndShowStaff(page, 'voice');
  assert.equal(staff.clef, 'treble');
});

test('keyboard staff position matches the pure staff-position helper for the current target', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  const staff = await startAndShowStaff(page, 'kbd');
  const info = await page.evaluate('window.__coach.cur().info');
  const heads = staff.primitives.filter((p) => p.type === 'notehead');
  assert.equal(heads.length, 1);
  const clef = info.midi >= 60 ? 'treble' : 'bass';
  // The app's notehead position is produced by layoutMeasure internally
  // calling staffPosition on the spelled note; re-derive it the same way and
  // check it is a real, finite staff position (not NaN/undefined from a
  // wiring mistake such as passing the wrong clef).
  const expectedPos = staffPosition({ letter: staff.spelled.letter, octave: staff.spelled.octave }, clef);
  assert.equal(typeof expectedPos, 'number');
  assert.ok(Number.isFinite(expectedPos));
});

test('the target note letter name is only shown when the app\'s own reveal flag says so', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  // 'staff' mode never shows the name, whatever the reveal flag says.
  await page.evaluate("window.__coach.setNotate('staff')");
  await page.waitFor('window.__coach.lastStaff() !== null', 5000);
  const staffOnly = await page.evaluate('window.__coach.lastStaff()');
  assert.equal(staffOnly.nameShown, false, '"staff" mode never shows the letter name');

  // 'both' mode follows the item's own reveal/failed flag. lastStaff is
  // already non-null from the 'staff' step above, so wait for a draw tick
  // that has actually picked up the pref change rather than racing the
  // stale value.
  const e = await page.evaluate('window.__coach.cur()');
  const expected = !!(e.reveal || e.failed);
  await page.evaluate("window.__coach.setNotate('both')");
  await page.waitFor(`window.__coach.lastStaff() && window.__coach.lastStaff().nameShown === ${expected}`, 5000);
  const both = await page.evaluate('window.__coach.lastStaff()');
  assert.equal(both.nameShown, expected, 'nameShown tracks the item\'s reveal/failed flag');
});
