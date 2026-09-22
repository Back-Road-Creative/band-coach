// U2: some top-level instrument buttons in #picker are variants of another
// instrument (five-string bass under Bass, low-G/baritone ukulele under
// Ukulele) rather than separate instruments in their own right. This groups
// every genuine variant family under its parent, so a learner sees fewer,
// clearer top-level choices while every mod id -- variant or parent -- stays
// reachable and keeps calling setMod with its own id: no id is merged,
// renamed or aliased (progress is keyed per mod id, see DB.mods[mod] in
// loadDB()/save() in src/app.js).
//
// U-parent: how many instruments are grouped, and under which parent, is no
// longer hand-counted here. A MODS entry can now name its own group parent
// via `parent: '<mod id>'` (src/app.js's variantParentsFrom()), so nothing
// in this file may hardcode a total instrument count or a fixed id list that
// a future instrument joining an existing family would silently break --
// every count and every "which ids are grouped" question below is derived
// from the real rendered picker DOM, not restated by hand. The one
// exception the spec for this unit calls for keeping explicit: the four
// instruments known on main to stay top-level (mandolin, banjo-5-string,
// mallet-percussion, harp) and the three known variants (bass-5-string,
// ukulele-low-g, ukulele-baritone) and their parents (bass, uke) -- adding a
// ninth top-level instrument or a fourth variant does not change what those
// specific ids do, so asserting on them by name is not the kind of count
// this unit exists to stop hardcoding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JS_PATH = join(__dirname, '..', '..', 'src', 'app.js');

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

// Every real instrument mod id currently rendered into #picker (top-level or
// nested inside a variant-family disclosure), and the subset of those ids
// that are grouped variants -- both read straight off the DOM so a future
// instrument joining or leaving a family changes these lists without
// touching this file.
const allInstrumentIds = () =>
  "Array.from(document.querySelectorAll('#picker button[data-mod]')).filter(b => !b.closest('.picker-tools')).map(b => b.dataset.mod)";
const groupedVariantIds = () =>
  "Array.from(document.querySelectorAll('#picker .variant-toggle button[data-mod]')).map(b => b.dataset.mod)";

const KNOWN_NON_VARIANT_TOP_LEVEL_IDS = ['mandolin', 'banjo-5-string', 'mallet-percussion', 'harp'];
const KNOWN_VARIANT_PARENTS = { 'bass-5-string': 'bass', 'ukulele-low-g': 'uke', 'ukulele-baritone': 'uke', 'trumpet-bb': 'wind', 'horn-f': 'wind', trombone: 'wind', viola: 'violin', cello: 'violin', 'double-bass': 'violin', 'recorder-descant': 'wind', 'tin-whistle': 'wind' };

test('variant groups: visible instrument controls equal every instrument id minus the grouped variants', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const total = await page.evaluate(allInstrumentIds());
  const grouped = await page.evaluate(groupedVariantIds());
  const visibleCount = await page.evaluate(
    "Array.from(document.querySelectorAll('#picker button[data-mod]')).filter(b => !b.closest('.picker-tools') && b.checkVisibility()).length"
  );
  assert.equal(visibleCount, total.length - grouped.length,
    `visible instrument controls (${visibleCount}) should be every instrument id (${total.length}) minus the ` +
    `${grouped.length} grouped variants (${JSON.stringify(grouped)})`);
  // Sanity on the fixture itself: this file's whole point is to stop the
  // count from being hand-typed, so make sure there is still something
  // meaningful being counted.
  assert.ok(total.length >= 10, `expected at least 10 instrument ids, found ${total.length}`);
});

test('variant groups: every rendered instrument mod id is reachable and still calls setMod with its own id', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const total = await page.evaluate(allInstrumentIds());
  const grouped = await page.evaluate(groupedVariantIds());

  for (const id of grouped) {
    // Variant buttons live inside a closed group; open it via the real
    // <details> toggle (native affordance) rather than a debug hook, then
    // click the real button exactly as a sighted user would.
    await page.evaluate(`(function(){ var b = document.querySelector('#picker button[data-mod="${id}"]'); var d = b.closest('details'); if (d) d.open = true; })()`);
    await page.evaluate(`document.querySelector('#picker button[data-mod="${id}"]').click()`);
    await page.waitFor(`document.querySelector('#picker button[data-mod="${id}"]').getAttribute('aria-pressed') === 'true'`);
    const pressed = await page.evaluate(`document.querySelector('#picker button[data-mod="${id}"]').getAttribute('aria-pressed')`);
    assert.equal(pressed, 'true', `clicking the variant button for "${id}" selects that exact mod id`);
  }

  const topLevel = total.filter(id => grouped.indexOf(id) < 0);
  for (const id of topLevel) {
    await page.evaluate(`document.querySelector('#picker button[data-mod="${id}"]').click()`);
    await page.waitFor(`document.querySelector('#picker button[data-mod="${id}"]').getAttribute('aria-pressed') === 'true'`);
    const pressed = await page.evaluate(`document.querySelector('#picker button[data-mod="${id}"]').getAttribute('aria-pressed')`);
    assert.equal(pressed, 'true', `clicking the top-level button for "${id}" selects that exact mod id`);
  }
});

test('variant groups: the known non-variant instruments stay top-level and directly visible on first paint', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  for (const id of KNOWN_NON_VARIANT_TOP_LEVEL_IDS) {
    const visible = await page.evaluate(isVisible(`#picker button[data-mod="${id}"]`));
    assert.equal(visible, true, `"${id}" is directly visible on first paint, not tucked behind a variant toggle`);
    const insideVariantToggle = await page.evaluate(`Boolean(document.querySelector('#picker button[data-mod="${id}"]').closest('.variant-toggle'))`);
    assert.equal(insideVariantToggle, false, `"${id}" is not nested inside a variant-family disclosure`);
  }
});

test('variant groups: the known variants are grouped under their known parent and hidden until the family group is opened', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  for (const [id, parent] of Object.entries(KNOWN_VARIANT_PARENTS)) {
    const visible = await page.evaluate(isVisible(`#picker button[data-mod="${id}"]`));
    assert.equal(visible, false, `"${id}" starts hidden inside its shut family group`);
    const groupParent = await page.evaluate(`(function(){ var b = document.querySelector('#picker button[data-mod="${id}"]'); var g = b.closest('.picker-variant-group'); return g && g.dataset.modGroup; })()`);
    assert.equal(groupParent, parent, `"${id}" is grouped under "${parent}"`);
  }

  await page.evaluate("document.querySelectorAll('#picker .variant-toggle').forEach(d => d.open = true)");
  for (const id of Object.keys(KNOWN_VARIANT_PARENTS)) {
    const visible = await page.evaluate(isVisible(`#picker button[data-mod="${id}"]`));
    assert.equal(visible, true, `"${id}" becomes visible once its family group is opened`);
  }
});

test('variant groups: a saved variant mod collapses too, names itself (not its parent) in the summary, and reopens with its family group open and that variant pressed', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'ukulele-low-g' } }));";
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());

  // U9: a saved variant is now hasSavedMod too, so it gets the exact same
  // collapsed-picker treatment as any other saved instrument (see
  // collapse-after-choice.test.mjs) -- no more meeting the full uncollapsed
  // row just because the saved choice happens to be a variant.
  const collapseShut = await page.evaluate("document.getElementById('pickerCollapse').open");
  assert.equal(collapseShut, false, 'the picker collapse starts shut for a returning learner whose saved mod is a variant');

  const summaryText = await page.evaluate("document.querySelector('#pickerCollapse > summary').textContent");
  assert.match(summaryText, /low-g ukulele/i, 'the collapsed summary names the variant itself, not its parent "Ukulele": ' + JSON.stringify(summaryText));
  assert.doesNotMatch(summaryText, /^ukulele\s/i, 'the summary is not just the parent family name: ' + JSON.stringify(summaryText));

  await page.evaluate("document.querySelector('#pickerCollapse > summary').click()");
  await page.waitFor("document.getElementById('pickerCollapse').open === true");

  const visible = await page.evaluate(isVisible('#picker button[data-mod="ukulele-low-g"]'));
  assert.equal(visible, true, 'once reopened, the saved variant\'s family group is already open, so the variant itself is visible');

  const pressed = await page.evaluate("document.querySelector('#picker button[data-mod=\"ukulele-low-g\"]').getAttribute('aria-pressed')");
  assert.equal(pressed, 'true', 'the saved variant reports pressed once the collapse is reopened');
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

// U-parent: proves the `parent` field itself -- rather than just the three
// hand-declared pairs -- feeds VARIANT_PARENTS. There is no MODS entry using
// `parent` on main yet, so this cannot be driven through a real click; it
// instead extracts the actual pure build function (variantParentsFrom) out
// of src/app.js's source and executes it directly, following the same
// extract-and-run-with-`new Function`-precedent as
// tests/unit/wsola.test.mjs's "processorSource evaluates to an engine
// identical to the module" test and tests/unit/pages-sw-cache-invalidates.test.mjs.
test('variant groups: a MODS entry\'s own `parent` field joins VARIANT_PARENTS without a second hand-edit', () => {
  const src = readFileSync(APP_JS_PATH, 'utf8');
  const match = /function variantParentsFrom\(mods, staticPairs\) \{.*\}/.exec(src);
  assert.ok(match, 'app.js must define variantParentsFrom(mods, staticPairs)');
  assert.match(src, /const VARIANT_PARENTS = variantParentsFrom\(MODS, \{[^}]*\}\);/,
    'VARIANT_PARENTS must be built by calling variantParentsFrom(MODS, <the hand-declared pairs>), not hand-typed on its own');

  // eslint-disable-next-line no-new-func
  const variantParentsFrom = new Function(`${match[0]}\nreturn variantParentsFrom;`)();

  const staticPairs = { a: 'x' };
  const mods = {
    x: { name: 'X' },
    y: { name: 'Y', parent: 'x' }, // a real, valid parent -- must be picked up
    z: { name: 'Z', parent: 'nope' }, // names a mod that does not exist -- must be ignored
    w: { name: 'W', parent: 'w' }, // names itself -- must be ignored
  };
  const out = variantParentsFrom(mods, staticPairs);
  assert.equal(out.a, 'x', 'the hand-declared static pairs still come through');
  assert.equal(out.y, 'x', 'a MODS entry naming a real, different mod as its parent is picked up automatically');
  assert.equal(out.z, undefined, 'a `parent` naming a mod id that does not exist falls back to top-level');
  assert.equal(out.w, undefined, 'a `parent` naming itself falls back to top-level');
});
