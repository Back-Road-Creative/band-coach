// U2: 13 top-level instrument buttons in #picker used to include five-string
// bass and the two extra ukuleles as flat peers of Bass/Ukulele, with nothing
// telling a learner they were closely-related variants rather than separate
// instruments. This groups the two genuine variant families -- Bass (plus
// 5-string bass) and Ukulele (plus low-G and baritone) -- under their parent,
// dropping the visible instrument count from 13 to 10, while every one of the
// 13 mod ids stays reachable and keeps calling setMod with its own id: no id
// is merged, renamed or aliased (progress is keyed per mod id, see
// DB.mods[mod] in loadDB()/save() in src/app.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

// A minimal, valid band-coach-progress backup naming a variant mod as the
// saved selection -- written to a temp file rather than a tracked fixture,
// since this test file is the only new file this unit is scoped to add.
function writeLowGBackupFile() {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-variant-backup-'));
  const path = join(dir, 'ukulele-low-g-backup.json');
  writeFileSync(path, JSON.stringify({
    format: 'band-coach-progress', formatVersion: 1, appVersion: 'test',
    exportedAt: '2026-09-21T00:00:00.000Z', db: { v: 1, prefs: { mod: 'ukulele-low-g' } },
  }));
  return path;
}

const htmlPath = HTML_PATH;

// Element.checkVisibility() is what actually tracks a closed <details>'
// hidden content in this Chromium build -- offsetParent stays non-null
// because the browser clips via its internal ::details-content wrapper
// (animatable height) rather than display:none on the child itself.
const isVisible = (sel) => `(function(){ var el = document.querySelector(${JSON.stringify(sel)}); return !!el && el.checkVisibility(); })()`;

const ALL_INSTRUMENT_IDS = [
  'kbd', 'gtr', 'bass', 'uke', 'voice', 'wind', 'mandolin', 'banjo-5-string',
  'bass-5-string', 'ukulele-low-g', 'ukulele-baritone', 'mallet-percussion', 'harp',
];
const NON_VARIANT_TOP_LEVEL_IDS = ['mandolin', 'banjo-5-string', 'mallet-percussion', 'harp'];
const VARIANT_IDS = ['bass-5-string', 'ukulele-low-g', 'ukulele-baritone'];

test('variant groups: exactly ten instrument controls are directly visible on first paint', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const count = await page.evaluate(
    "Array.from(document.querySelectorAll('#picker button[data-mod]')).filter(b => !b.closest('.picker-tools') && b.checkVisibility()).length"
  );
  assert.equal(count, 10, 'ten visible instrument controls (13 mod ids minus the 3 grouped variants) on first paint');
});

test('variant groups: every one of the 13 instrument mod ids is reachable and still calls setMod with its own id', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  for (const id of ALL_INSTRUMENT_IDS) {
    const exists = await page.evaluate(`Boolean(document.querySelector('#picker button[data-mod="${id}"]'))`);
    assert.equal(exists, true, `a button for mod "${id}" exists somewhere in #picker`);
  }

  for (const id of VARIANT_IDS) {
    // Variant buttons live inside a closed group; open it via the real
    // <details> toggle (native affordance) rather than a debug hook, then
    // click the real button exactly as a sighted user would.
    await page.evaluate(`(function(){ var b = document.querySelector('#picker button[data-mod="${id}"]'); var d = b.closest('details'); if (d) d.open = true; })()`);
    await page.evaluate(`document.querySelector('#picker button[data-mod="${id}"]').click()`);
    await page.waitFor(`document.querySelector('#picker button[data-mod="${id}"]').getAttribute('aria-pressed') === 'true'`);
    const pressed = await page.evaluate(`document.querySelector('#picker button[data-mod="${id}"]').getAttribute('aria-pressed')`);
    assert.equal(pressed, 'true', `clicking the variant button for "${id}" selects that exact mod id`);
  }

  // The two family parents also stay independently selectable.
  for (const id of ['bass', 'uke']) {
    await page.evaluate(`document.querySelector('#picker button[data-mod="${id}"]').click()`);
    await page.waitFor(`document.querySelector('#picker button[data-mod="${id}"]').getAttribute('aria-pressed') === 'true'`);
    const pressed = await page.evaluate(`document.querySelector('#picker button[data-mod="${id}"]').getAttribute('aria-pressed')`);
    assert.equal(pressed, 'true', `clicking the parent button for "${id}" selects the parent's own mod id`);
  }
});

test('variant groups: the four non-variant instruments stay top-level and directly visible on first paint', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  for (const id of NON_VARIANT_TOP_LEVEL_IDS) {
    const visible = await page.evaluate(isVisible(`#picker button[data-mod="${id}"]`));
    assert.equal(visible, true, `"${id}" is directly visible on first paint, not tucked behind a variant toggle`);
    const grouped = await page.evaluate(`Boolean(document.querySelector('#picker button[data-mod="${id}"]').closest('.picker-variant-group details[open], .picker-variant-group details:not([open])'))`);
    // More directly: it must not sit inside ANY variant-toggle details at all.
    const insideVariantToggle = await page.evaluate(`Boolean(document.querySelector('#picker button[data-mod="${id}"]').closest('.variant-toggle'))`);
    assert.equal(insideVariantToggle, false, `"${id}" is not nested inside a variant-family disclosure`);
  }
});

test('variant groups: the variant buttons are hidden until their family group is opened', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  for (const id of VARIANT_IDS) {
    const visible = await page.evaluate(isVisible(`#picker button[data-mod="${id}"]`));
    assert.equal(visible, false, `"${id}" starts hidden inside its shut family group`);
  }

  await page.evaluate("document.querySelectorAll('#picker .variant-toggle').forEach(d => d.open = true)");
  for (const id of VARIANT_IDS) {
    const visible = await page.evaluate(isVisible(`#picker button[data-mod="${id}"]`));
    assert.equal(visible, true, `"${id}" becomes visible once its family group is opened`);
  }
});

test('variant groups: a saved variant mod boots with its family group open and that variant pressed', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'ukulele-low-g' } }));";
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());

  const visible = await page.evaluate(isVisible('#picker button[data-mod="ukulele-low-g"]'));
  assert.equal(visible, true, 'the saved variant\'s family group is already open on boot, so the variant itself is visible');

  const pressed = await page.evaluate("document.querySelector('#picker button[data-mod=\"ukulele-low-g\"]').getAttribute('aria-pressed')");
  assert.equal(pressed, 'true', 'the saved variant reports pressed on boot');
});

test('variant groups: restoring a backup saved on a variant mod (setMod called after boot, not just at boot) opens that family group', async (t) => {
  // Restoring a backup goes through a native confirm() dialog
  // ($('backupRestoreInput')'s change handler in src/app.js) before it does
  // anything -- stubbed here to auto-accept, exactly like the wake-lock
  // test's fake-API pattern, since a JS dialog otherwise blocks the page
  // (and every further CDP call) waiting for a human who is never coming.
  const initScript = 'window.confirm = () => true;';
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());

  // Sanity: the page boots on the default mod, so the ukulele variant group
  // starts shut -- this is NOT the "saved at boot" path covered above; the
  // restore below calls setMod() well after buildPicker() already ran once,
  // which is the one path buildPicker's own one-time toggle.open check
  // cannot cover.
  const shutBefore = await page.evaluate(isVisible('#picker button[data-mod="ukulele-low-g"]'));
  assert.equal(shutBefore, false, 'sanity: the low-G ukulele group starts shut on a fresh profile');

  await page.setFileInput('#backupRestoreInput', writeLowGBackupFile());
  await page.waitFor("document.querySelector('#picker button[data-mod=\"ukulele-low-g\"]').getAttribute('aria-pressed') === 'true'");

  const visible = await page.evaluate(isVisible('#picker button[data-mod="ukulele-low-g"]'));
  assert.equal(visible, true, 'restoring a backup whose saved mod is a variant forces that variant\'s family group open');
});

test('variant groups: mod ids are never merged, renamed or aliased -- each family member keeps independent progress data', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  // Select the low-G ukulele, advance its level with the real "Skip ahead"
  // button, then select the plain ukulele and confirm ITS level is
  // untouched -- proving the grouping is purely visual and progress stays
  // keyed per mod id (DB.mods[mod], read here through the debug hook for
  // verification only -- the level change itself goes through the real
  // button click).
  await page.evaluate("document.querySelectorAll('#picker .variant-toggle').forEach(d => d.open = true)");
  await page.evaluate("document.querySelector('#picker button[data-mod=\"ukulele-low-g\"]').click()");
  await page.waitFor("document.querySelector('#picker button[data-mod=\"ukulele-low-g\"]').getAttribute('aria-pressed') === 'true'");
  await page.evaluate("document.getElementById('harderBtn').click()");
  await page.evaluate("document.getElementById('harderBtn').click()");
  const lowGLevel = await page.evaluate("window.__coach.db().mods['ukulele-low-g'].level");
  assert.equal(lowGLevel, 3, 'sanity: the low-G ukulele model itself advanced two levels');
  await page.evaluate("document.querySelector('#picker button[data-mod=\"uke\"]').click()");
  await page.waitFor("document.querySelector('#picker button[data-mod=\"uke\"]').getAttribute('aria-pressed') === 'true'");
  const ukeLevel = await page.evaluate("window.__coach.db().mods.uke.level");
  assert.equal(ukeLevel, 1, 'the plain ukulele mod keeps its own separate, untouched level after the low-G variant was advanced');
});
