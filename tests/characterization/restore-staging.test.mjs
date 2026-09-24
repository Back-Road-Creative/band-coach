// A restore that carries songs must not replace the learner's progress
// unless the songs can actually be saved. doImportProgress (src/app.js)
// used to write DB, prefs, theme and mod BEFORE trying the song library,
// so a store failure (e.g. IndexedDB unavailable) left the learner with a
// replaced profile and no songs -- see the comment this fix replaces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

// Matches tests/unit/song-library.test.mjs's `song()` helper shape.
function songLiteral(id) {
  return JSON.stringify({
    schema: 1, id, title: 'Song ' + id, composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 120, ticksPerQuarter: 480,
    parts: [{ id: 'p', name: 'P', notes: [{ start: 0, dur: 480, midi: 60 }] }],
    chords: [],
  });
}

// Object.defineProperty returns `window`; evaluate() serialises the
// expression's value, and window itself is not serialisable ("Object
// reference chain is too long" from the CDP client) -- end with a plain
// statement so the expression's value is undefined instead.
const breakIndexedDb = `
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: { open() { const r = {}; setTimeout(() => r.onerror && r.onerror(new Event('error')), 0); return r; } },
  });
  void 0;
`;

test('a song-store failure during restore leaves the live profile untouched', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate('window.__coach.db().latencyMs = 77');
  await page.evaluate("window.__coach.db().prefs.theme = 'dark'");

  const backup = await page.evaluate(`
    JSON.stringify({
      format: 'band-coach-progress',
      formatVersion: 2,
      appVersion: 'unknown',
      exportedAt: new Date().toISOString(),
      db: Object.assign({}, window.__coach.db(), { latencyMs: 250, prefs: Object.assign({}, window.__coach.db().prefs, { theme: 'light' }) }),
      songs: [${songLiteral('s1')}],
    })
  `);

  await page.evaluate(breakIndexedDb);
  const result = await page.evaluate(`window.__coach.importProgress(${JSON.stringify(backup)})`);
  assert.equal(result.ok, false, 'a song-store failure is reported, not silently accepted');
  assert.equal(typeof result.error, 'string');
  assert.ok(result.error.length > 0);

  const latencyMs = await page.evaluate('window.__coach.db().latencyMs');
  assert.equal(latencyMs, 77, 'the live profile latency was never replaced');
  const themeAfter = await page.evaluate('window.__coach.db().prefs.theme');
  assert.equal(themeAfter, 'dark', 'the live profile theme pref was never replaced');
});

test('a working store still restores songs and progress together', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate('window.__coach.db().latencyMs = 77');

  const backup = await page.evaluate(`
    JSON.stringify({
      format: 'band-coach-progress',
      formatVersion: 2,
      appVersion: 'unknown',
      exportedAt: new Date().toISOString(),
      db: Object.assign({}, window.__coach.db(), { latencyMs: 250 }),
      songs: [${songLiteral('s2')}],
    })
  `);

  const result = await page.evaluate(`window.__coach.importProgress(${JSON.stringify(backup)})`);
  assert.equal(result.ok, true, 'a healthy store restores successfully');

  const coachText = await page.evaluate("document.getElementById('coach').textContent");
  assert.equal(coachText, 'Backup restored.');
});
