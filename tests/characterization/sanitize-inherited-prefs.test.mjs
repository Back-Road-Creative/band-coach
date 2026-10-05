// A saved (or restored) profile whose prefs name an inherited Object key
// ('constructor', '__proto__', 'toString') must boot like a profile with no
// such pref. Before src/core/sanitize-db.js checked own keys, MODS['constructor']
// was truthy, so the app booted with mod = 'constructor' and the state set to
// Object's own constructor function. Drives the real boot through localStorage
// and a reload, like theme-pref-sanitize.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

for (const key of ['constructor', '__proto__', 'toString']) {
  test(`a saved instrument, wind kind and voice of "${key}" boot as the defaults`, async (t) => {
    const page = await launchPage(htmlPath);
    t.after(() => page.close());

    const saved = `{"v":1,"mods":{},"sessions":[{"d":"2026-01-01","mod":"${key}"}],"prefs":{"mod":"${key}","wind":"${key}","voice":"${key}"}}`;
    await page.evaluate(`localStorage.setItem('bandcoach.v1', ${JSON.stringify(saved)})`);
    await page.reload();
    await page.waitFor('typeof window.__coach !== "undefined"', 8000);

    const got = await page.evaluate(`(() => { const p = window.__coach.db().prefs, s = window.__coach.state(); return { mod: p.mod, wind: p.wind, voice: p.voice, sessions: window.__coach.db().sessions.length, stateLevel: typeof s === 'object' && s ? typeof s.level : typeof s }; })()`);
    assert.equal(got.mod, 'kbd');
    assert.equal(got.wind, 'bb');
    assert.equal(got.voice, 'low');
    assert.equal(got.sessions, 0, 'the session row naming an inherited instrument is dropped');
    assert.equal(got.stateLevel, 'number', 'the trainer state is a real instrument model');
  });
}
