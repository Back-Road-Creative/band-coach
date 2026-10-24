// A Spanish speaker's Settings, Progress and practice option rows are all in
// Spanish. Each screen is opened for real with a saved profile that has data
// (so the sections that only exist once there is something to show are
// present) and its text is checked for the English phrases it used to hard-code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const n = new Date();
const day = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
const initScript = `localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { locale: 'es', mod: 'kbd' },
  sessions: [{ d: ${JSON.stringify(day)}, mod: 'kbd', min: 6, acc: 0.8, a1: 0.8, a2: 0.8, from: 1, to: 1, breaks: 0 }],
  mods: { kbd: { item: { n60: { m: 0.95, n: 10, last: Date.now() - 86400000, seen: 5 }, n62: { m: 0.2, n: 6, last: Date.now() - 30 * 86400000, seen: 5 } } } } }));`;
const text = (page, sel) => page.evaluate(`document.querySelector(${JSON.stringify(sel)}).textContent`);

test('Settings in Spanish: every label, option and the "How it decides" note', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript });
  t.after(() => page.close());
  await page.evaluate("document.querySelector('#mainNav button[data-route=\"settings\"]').click()");
  const body = await text(page, '#settingsView');
  assert.doesNotMatch(body, /Show note names|Theme|Match system|Light|Dark|Letters \(|German|Fixed do|Sharps\/flats|Mixed \(|Always sharps|Always flats|How it decides|no dice/);
  assert.match(body, /Tema/);
  assert.match(body, /Cómo decide/);
  assert.equal(await text(page, 'label[for="optTheme"] option[value="dark"]'), 'Oscuro');
});

test('switching to English and back restores Settings labels live', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript });
  t.after(() => page.close());
  await page.evaluate("document.querySelector('#mainNav button[data-route=\"settings\"]').click()");
  await page.evaluate("(() => { const s = document.getElementById('optLocale'); s.value = 'en'; s.dispatchEvent(new Event('change')); })()");
  assert.match(await text(page, '#settingsView'), /Show note names[\s\S]*Match system[\s\S]*How it decides/);
});

test('Progress in Spanish: headings, summary, calendar, items and report controls', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript });
  t.after(() => page.close());
  await page.evaluate('window.__coach.openPanel("history")');
  await page.waitFor("document.getElementById('historySummary').textContent.trim() !== ''", 5000);
  const body = await text(page, '#panelHost');
  assert.doesNotMatch(body, /My progress|Practice calendar|By instrument|Items to know|Share a report|Daily minutes goal|Look at items|Copy a summary|Print this week|Strongest|Weakest|Due for review|session logged|Current streak|Goal streak|Newest day|min across|average accuracy|Tries with help|Your name/);
  assert.match(await text(page, '#historyHeading'), /Mi progreso/);
  assert.match(body, /1 sesión/);
  assert.match(body, /Más fuerte/);
  assert.match(body, /Más débil/);
  const cell = await page.evaluate("document.querySelector('.ledger-cell').getAttribute('title')");
  assert.doesNotMatch(cell, /session|goal met|earlier sessions/);
});

test('practice option rows in Spanish: session length, Show, Play in time', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  const opts = (id) => page.evaluate(`Array.from(document.getElementById(${JSON.stringify(id)}).options).map(o => o.textContent)`);
  const label = (id) => page.evaluate(`document.querySelector('label[for=${id}]').firstChild.textContent.trim()`);
  assert.deepEqual(await opts('optSessionMinutes'), ['Sin límite', '5 minutos', '10 minutos', '15 minutos']);
  assert.equal(await label('optSessionMinutes'), 'Duración de la sesión');
  assert.deepEqual(await opts('optNotate'), ['Nombres de las notas (hoy)', 'Pentagrama', 'Pentagrama y nombres']);
  assert.equal(await label('optNotate'), 'Mostrar');
  assert.equal(await text(page, 'label[for="optGroove"]'), ' Tocar a tempo (metrónomo, 80 pulsos por minuto)');
});

test('the practice option labels stay English in English', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: initScript.replace("locale: 'es'", "locale: 'en'") });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  assert.deepEqual(await page.evaluate("Array.from(document.getElementById('optSessionMinutes').options).map(o => o.textContent)"), ['No limit', '5 minutes', '10 minutes', '15 minutes']);
  assert.equal(await text(page, 'label[for="optGroove"]'), ' Play in time (metronome, 80 beats a minute)');
});
