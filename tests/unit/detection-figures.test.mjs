import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeFigures } from '../../build/detection-figures.mjs';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const json = JSON.parse(readFileSync(new URL('../../src/core/detection-figures.json', import.meta.url), 'utf8'));
const doc = readFileSync(new URL('../../docs/capabilities.md', import.meta.url), 'utf8');
const flat = doc.replace(/\s+/g, ' ');

test('the committed figures file equals a fresh recompute (regenerate: node build/detection-figures.mjs)', () => {
  assert.deepEqual(computeFigures(), json);
});

test('docs/capabilities.md tables and per-song line equal the figures file', () => {
  const m = json.multipitch;
  const rows = [
    `| Precision | ${m.precision.toFixed(4)} |`, `| Recall | ${m.recall.toFixed(4)} |`, `| F1 | ${m.f1.toFixed(4)} |`,
    `| Reference notes matched | ${m.matched} of ${m.ref} |`, `| Notes estimated | ${m.est} |`,
    ...json.families.map((f) => `| ${f.family} family | ${f.meanF1.toFixed(3)} |`),
  ];
  for (const r of rows) assert.ok(doc.includes(r), `missing table row: ${r}`);
  const songs = json.songs.map((s) => `${s.title} ${s.f1.toFixed(3)} (${s.matched} of ${s.ref}, ${s.est} estimated)`).join('; ');
  assert.ok(flat.includes(songs), 'per-song line does not equal the figures file');
});

test('Settings > How this works shows every family row and the caveat, in English and Spanish', async (t) => {
  for (const [locale, caveat, intro] of [['en', /not a real microphone/, /0 to 1/], ['es', /micrófono real/, /0 a 1/]]) {
    const initScript = `localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { locale: '${locale}' } }));`;
    const page = await launchPage(HTML_PATH, { initScript });
    t.after(() => page.close());
    await page.evaluate("document.querySelector('#mainNav button[data-route=\"settings\"]').click()");
    const rows = await page.evaluate("[...document.querySelectorAll('#detectionFigures li')].map(l => l.textContent)");
    assert.equal(rows.length, json.families.length, locale);
    json.families.forEach((f, i) => assert.ok(rows[i].includes(f.meanF1.toFixed(3)), `${locale}: ${rows[i]}`));
    const body = await page.evaluate("document.getElementById('detectionFigures').textContent");
    assert.match(body, caveat); assert.match(body, intro);
    assert.doesNotMatch(body, /tier|accessible-unvalidated|typed-unreviewed/i);
    assert.equal(await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), true);
  }
});
