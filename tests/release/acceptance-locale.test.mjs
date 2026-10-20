// Español sweep on the release file: switch the language through the real
// Settings control, visit every main screen by real clicks, collect all the
// text a person can see (visible text plus aria-label / title / placeholder /
// alt) and flag any string that is still an English table value whose Spanish
// value differs. A screen with no leftovers is asserted clean; a screen with
// leftovers is pinned in KNOWN_LEFTOVERS and gets a test.todo naming each
// English string, so the sweep goes red the day the list changes (a fix must
// delete its entry, a new leak must not slip in).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';
import { en, es } from '../../src/core/i18n.js';

// English table values the screens may show that are not translatable
// sentences, with the reason. (A value identical in en and es never matches
// the detector anyway.)
export const EXCLUDED = {
  'English': 'the language picker names each language in its own tongue',
  'Band Coach': 'the product name',
  'MIDI': 'a technical acronym used as is',
};

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// en table value -> regex (a {param} matches any text); only where es differs.
const ENGLISH = Object.entries(en)
  .filter(([k, v]) => typeof v === 'string' && v.trim() && es[k] !== v && !(v.trim() in EXCLUDED))
  .map(([k, v]) => ({ key: k, text: v.trim(), re: new RegExp('^' + esc(v.trim()).replace(/\\\{\w+\\\}/g, '.+') + '$', 's') }));

const norm = s => s.replace(/\s+/g, ' ').trim();
// Every visible string on the page: text of visible elements (own text nodes
// and full text), plus the attributes a screen reader or hover shows.
const COLLECT = `(() => {
  const out = new Set();
  const vis = e => e.checkVisibility ? e.checkVisibility({ visibilityProperty: true }) : !!e.getClientRects().length;
  const add = s => { s = (s || '').replace(/\\s+/g, ' ').trim(); if (s) out.add(s); };
  for (const e of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'OPTION', 'SVG', 'CANVAS'].includes(e.tagName.toUpperCase())) continue;
    if (!vis(e)) continue;
    for (const n of e.childNodes) if (n.nodeType === 3) add(n.nodeValue);
    if (e.children.length && e.textContent.length < 400) add(e.textContent);
    for (const a of ['aria-label', 'title', 'placeholder', 'alt']) add(e.getAttribute(a));
  }
  for (const o of document.querySelectorAll('select')) if (vis(o)) for (const x of o.options) add(x.textContent);
  return [...out];
})()`;

async function leftovers(page) {
  const seen = await page.evaluate(COLLECT);
  const hits = [];
  for (const s of seen) for (const e of ENGLISH) if (e.re.test(norm(s))) hits.push(`${e.key}: ${JSON.stringify(s)}`);
  return [...new Set(hits)];
}

export const SCREENS = [
  { name: 'Practice', open: p => p.clickSelector('#mainNav button[data-route="practice"]') },
  { name: 'Songs', open: p => p.clickSelector('#mainNav button[data-route="songs"]') },
  { name: 'Progress', open: p => p.clickSelector('#mainNav button[data-route="progress"]') },
  { name: 'Settings', open: p => p.clickSelector('#mainNav button[data-route="settings"]') },
  { name: 'Instrument picker', open: p => p.clickSelector('#navInstrument') },
];
// Screens known to leave English behind: name -> English strings (key: text).
// A screen absent here is asserted clean.
export const KNOWN_LEFTOVERS = {
};

test('the sweep detector sees English: an en table value is flagged, its Spanish value is not', () => {
  assert.ok(ENGLISH.some(e => e.re.test(en['nav.practice'])), 'a plain English nav label matches');
  assert.ok(!ENGLISH.some(e => e.re.test(es['nav.practice'])), 'its Spanish value does not');
});

test('Español: every main screen shows exactly the pinned English leftovers (none where clean)', async (t) => {
  await withAcceptancePage(t, { initScript: "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'kbd' } }));" }, async (page) => {
    await page.clickSelector('#mainNav button[data-route="settings"]');
    await page.evaluate("(() => { const s = document.getElementById('optLocale'); s.value = 'es'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
    assert.equal(await page.evaluate('document.documentElement.lang'), 'es');
    for (const sc of SCREENS) {
      await sc.open(page);
      assert.deepEqual(await leftovers(page), KNOWN_LEFTOVERS[sc.name] || [], `${sc.name}: English on screen differs from the pinned list`);
    }
  });
});

for (const [name, list] of Object.entries(KNOWN_LEFTOVERS)) {
  test.todo(`${name} in Español still shows English: ${list.join(' | ')}`);
}
