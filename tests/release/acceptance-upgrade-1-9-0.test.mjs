// Acceptance scenario: a learner on Band Coach 1.9.0 gets the next release. Two routes, both on the real files:
//  A. a real 1.9.0 backup (tests/fixtures/backups/v1.9.0-export.json) restored through the real Restore control
//     and file chooser, over a profile that holds different values, so every value that comes back is the backup's;
//  B. the real 1.9.0 release file (tests/fixtures/releases/band-coach-1.9.0.html) opened at a path, played and
//     saved, then overwritten at that same path by the candidate release file and reopened in the same browser profile.
// Real clicks and key presses only; page.evaluate reads text, attributes and storage and never acts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptanceHtmlPath, withAcceptancePage } from '../helpers/browser.mjs';
import { chooseFile } from '../helpers/file-chooser.mjs';
import { setLocalStorageItem } from '../helpers/cdp-extras.mjs';
import { tabTo } from '../helpers/journey.mjs';

const BACKUP = fileURLToPath(new URL('../fixtures/backups/v1.9.0-export.json', import.meta.url));
// The published 1.9.0 asset, kept in the repo (tests/fixtures/releases/README.md); the digest is GitHub's for that asset and guards the fixture.
const OLD_RELEASE = fileURLToPath(new URL('../fixtures/releases/v1.9.0/band-coach.html', import.meta.url));
const OLD_RELEASE_SHA256 = '05d267982c3ed7140fb862280cfa21c44c6ac0ae630ea9615d1a54f4171a085b';
const KEY = 'bandcoach.v1';
const exported = JSON.parse(readFileSync(BACKUP, 'utf8'));
const KEY_FOR = { C: 'a', D: 's', E: 'd', F: 'f', G: 'g', A: 'h', B: 'j', 'C (high)': 'k' };

const textOf = (page, id) => page.evaluate(`document.getElementById(${JSON.stringify(id)}).textContent.trim()`);
const valueOf = (page, id) => page.evaluate(`document.getElementById(${JSON.stringify(id)}).value`);
const go = (page, route) => page.clickSelector(`#mainNav button[data-route="${route}"]`);
const stored = (page) => page.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}))`);
const dataTheme = (page) => page.evaluate("document.documentElement.getAttribute('data-theme')");
async function levelOf(page, mod) {
  await page.clickSelector('#navInstrument');
  await page.clickSelector(`#picker button[data-mod="${mod}"]`);
  await go(page, 'practice');
  return textOf(page, 'levelNum');
}

// What a learner who had used this device before looks like: another instrument, level 4, dark theme, Spanish.
const PRIOR = JSON.stringify({ v: 1, mods: { gtr: { level: 4 }, kbd: { level: 5 } }, prefs: { mod: 'gtr', theme: 'dark', locale: 'es' } });

test('Upgrade A: a real 1.9.0 backup restores through the Restore control, and stays after a reload', async (t) => {
  await withAcceptancePage(t, {}, async (page) => {
    await setLocalStorageItem(page, KEY, PRIOR);
    await page.reload();
    assert.equal(await dataTheme(page), 'dark', 'control: the profile it starts from is dark');
    assert.equal(await levelOf(page, 'gtr'), 'Level 4', 'control: the profile it starts from is at Level 4 on guitar');

    await go(page, 'settings');
    const dialogs = [];
    const off = page.cdp.on((msg) => {
      if (msg.method !== 'Page.javascriptDialogOpening') return;
      dialogs.push({ type: msg.params.type, message: msg.params.message });
      page.cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    });
    await chooseFile(page, 'label[for="backupRestoreInput"]', BACKUP);
    // The page is in Spanish when the confirm opens and in English once restored, so wait on the stored profile, not on wording.
    await page.waitFor(`(() => { try { const d = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); return d.prefs.locale === 'en' && d.prefs.mod === 'kbd'; } catch (e) { return false; } })()`);
    off();
    assert.deepEqual(dialogs.map((d) => d.type), ['confirm'], 'one restore confirm was raised');

    const check = async (when) => {
      const db = await stored(page);
      assert.equal(db.prefs.mod, exported.db.prefs.mod, `${when}: stored instrument`);
      assert.equal(db.prefs.theme, exported.db.prefs.theme, `${when}: stored theme`);
      assert.equal(db.prefs.locale, exported.db.prefs.locale, `${when}: stored locale`);
      assert.deepEqual(db.prefs.noteNaming, exported.db.prefs.noteNaming, `${when}: stored note naming`);
      assert.equal(db.latencyMs, exported.db.latencyMs, `${when}: stored latency`);
      for (const mod of ['kbd', 'gtr', 'bass', 'ear']) assert.equal(db.mods[mod].level, exported.db.mods[mod].level, `${when}: stored level of ${mod}`);
      assert.equal(await textOf(page, 'navInstrument'), 'Instrument: Keyboard', `${when}: chosen instrument shown`);
      assert.equal(await dataTheme(page), null, `${when}: theme is Match system, not the dark it had`);
      assert.equal(await valueOf(page, 'optTheme'), exported.db.prefs.theme, `${when}: theme control`);
      assert.equal(await valueOf(page, 'optLocale'), exported.db.prefs.locale, `${when}: language control`);
      assert.equal(await valueOf(page, 'optNoteSystem'), exported.db.prefs.noteNaming.system, `${when}: note names control`);
      assert.equal(await valueOf(page, 'optAccidentals'), exported.db.prefs.noteNaming.accidentals, `${when}: accidentals control`);
      assert.equal(await levelOf(page, 'gtr'), 'Level 1', `${when}: guitar back at the backup's level, not Level 4`);
      assert.equal(await levelOf(page, 'kbd'), 'Level 1', `${when}: keyboard back at the backup's level, not Level 5`);
    };
    await check('after restore');
    await page.reload();
    await check('after reload');
    assert.deepEqual(page.consoleErrors, [], 'no console errors');
    assert.deepEqual(page.exceptions, [], 'no uncaught exceptions');
  });
});

test('Upgrade B: the real 1.9.0 file saves progress; the candidate file at the same path in the same profile keeps it', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-upgrade-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const P = join(dir, 'band-coach.html');
  const bytes = readFileSync(OLD_RELEASE);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), OLD_RELEASE_SHA256, 'the vendored file is the published 1.9.0 asset');
  writeFileSync(P, bytes);
  const WATCH = `(() => { window.__t = []; const seen = new WeakSet(); new MutationObserver(() => { const b = document.querySelector('#prompt b'); if (b && !seen.has(b)) { seen.add(b); window.__t.push(b.textContent); } }).observe(document, { childList: true, subtree: true }); })()`;
  await withAcceptancePage(t, { htmlPath: P, initScript: WATCH }, async (page) => {
    // The candidate's version number may still read 1.9.0 (it is built from main between releases), so the control is the published build's shape: it has no main navigation.
    assert.equal(await page.evaluate("Boolean(document.getElementById('mainNav'))"), false, 'control: the file at P is the published 1.9.0 build');
    await page.clickSelector('#picker button[data-mod="kbd"]');
    // 1.9.0 has no main navigation: its options are on the one screen.
    await tabTo(page, '#optTheme');
    await page.press('ArrowDown'); await page.press('ArrowDown');
    assert.equal(await valueOf(page, 'optTheme'), 'dark', 'control: theme chosen by keyboard');
    await page.clickSelector('#playBtn');
    await page.waitFor("document.getElementById('playBtn').textContent.trim() === 'Pause'");
    for (let i = 0; i < 4; i++) {
      await page.waitFor(`window.__t.length > ${i}`);
      const label = await page.evaluate("document.querySelector('#prompt b').textContent");
      assert.ok(KEY_FOR[label], `a computer key for the prompt "${label}"`);
      const n = await page.evaluate("document.getElementById('feedback').textContent");
      await page.press(KEY_FOR[label], { text: KEY_FOR[label] });
      await page.waitFor(`document.getElementById('feedback').textContent !== ${JSON.stringify(n)} || window.__t.length > ${i + 1}`);
    }
    await page.waitFor(`(() => { try { const d = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); return d.prefs.theme === 'dark' && d.prefs.mod === 'kbd' && d.mods.kbd.judged >= 4; } catch (e) { return false; } })()`);
    // Saves are debounced (1.2 s): take the snapshot once storage has stopped changing, so a late 1.9.0 save is not mistaken for the upgrade's doing.
    let raw = await page.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`);
    for (let quiet = 0; quiet < 2;) {
      await new Promise((r) => setTimeout(r, 1500));
      const now = await page.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`);
      quiet = now === raw ? quiet + 1 : 0;
      raw = now;
    }
    const before = JSON.parse(raw);
    assert.ok(before.mods.kbd.judged > 0 || Object.keys(before.mods.kbd.item).length > 0, `1.9.0 recorded the answers: ${JSON.stringify(before.mods.kbd).slice(0, 200)}`);

    // The upgrade: the same path now holds the candidate file; the same browser profile opens it.
    copyFileSync(acceptanceHtmlPath(), P);
    await page.reload();
    assert.equal(await page.evaluate("Boolean(document.getElementById('mainNav'))"), true, 'control: the file now at P is the candidate build');
    const after = await stored(page);
    assert.equal(after.prefs.mod, 'kbd');
    assert.equal(after.prefs.theme, 'dark');
    assert.equal(after.prefs.locale, before.prefs.locale);
    assert.deepEqual(after.prefs.noteNaming, before.prefs.noteNaming);
    assert.equal(after.mods.kbd.level, before.mods.kbd.level);
    assert.equal(after.mods.kbd.judged, before.mods.kbd.judged, 'answered-note count kept');
    // `seen` (times a note was put up) may rise once the candidate shows its first prompt; every learned figure must be untouched.
    assert.deepEqual(Object.keys(after.mods.kbd.item), Object.keys(before.mods.kbd.item), 'the same notes have progress');
    for (const [id, was] of Object.entries(before.mods.kbd.item)) {
      const { seen: seenAfter, ...now } = after.mods.kbd.item[id], { seen: seenBefore, ...kept } = was;
      assert.deepEqual(now, kept, `per-note progress kept for ${id}`);
      assert.ok(seenAfter >= seenBefore, `${id} shown-count did not go down`);
    }
    assert.equal(await textOf(page, 'navInstrument'), 'Instrument: Keyboard');
    assert.equal(await dataTheme(page), 'dark');
    assert.equal(await valueOf(page, 'optTheme'), 'dark');
    assert.equal(await levelOf(page, 'kbd'), `Level ${before.mods.kbd.level}`);
    assert.deepEqual(page.consoleErrors, [], 'no console errors');
    assert.deepEqual(page.exceptions, [], 'no uncaught exceptions');
  });
});
