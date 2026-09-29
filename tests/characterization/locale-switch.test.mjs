// Language picker (Settings > Language): choosing Español switches the
// visible labels and <html lang> at once without a reload, the choice
// survives a reload (applied before first render), and the longer Spanish
// labels do not overflow the page at real phone widths. Driven through the
// real #optLocale control and the real nav buttons, not the debug hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;
const navText = route => `document.querySelector('#mainNav button[data-route="${route}"]').textContent.trim()`;
const openSettings = page => page.evaluate("document.querySelector('#mainNav button[data-route=\"settings\"]').click()");
const pick = (page, code) => page.evaluate(`(() => { const s = document.getElementById('optLocale'); s.value = '${code}'; s.dispatchEvent(new Event('change')); })()`);
const stored = "(() => { try { return JSON.parse(localStorage.getItem('bandcoach.v1')).prefs.locale; } catch (e) { return null; } })()";

test('fresh page is English with an English/Español picker', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  assert.equal(await page.evaluate('document.documentElement.lang'), 'en');
  assert.equal(await page.evaluate("document.getElementById('optLocale').value"), 'en');
  assert.deepEqual(JSON.parse(await page.evaluate("JSON.stringify(Array.from(document.querySelectorAll('#optLocale option')).map(o => [o.value, o.textContent]))")), [['en', 'English'], ['es', 'Español']]);
});

test('choosing Español switches labels, html lang and the instrument button live; English switches back', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await openSettings(page);
  await pick(page, 'es');
  assert.equal(await page.evaluate('document.documentElement.lang'), 'es');
  assert.equal(await page.evaluate(navText('practice')), 'Práctica');
  assert.equal(await page.evaluate(navText('settings')), 'Ajustes');
  assert.equal(await page.evaluate("document.getElementById('settingsTitle').textContent"), 'Ajustes');
  assert.match(await page.evaluate("document.getElementById('helpText').textContent"), /Teclado|teclado/, 'the how-this-works help text is re-rendered in Spanish too');
  assert.equal(await page.evaluate("document.getElementById('navInstrument').textContent"), 'Elige un instrumento');
  await pick(page, 'en');
  assert.equal(await page.evaluate('document.documentElement.lang'), 'en');
  assert.equal(await page.evaluate(navText('practice')), 'Practice');
});

test('the Spanish choice is saved and applied on reload before anything else', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await openSettings(page);
  await pick(page, 'es');
  await page.waitFor(`${stored} === 'es'`, 10000);
  await page.reload();
  await page.waitFor('typeof window.__coach !== "undefined"', 8000);
  assert.equal(await page.evaluate('document.documentElement.lang'), 'es');
  assert.equal(await page.evaluate(navText('songs')), 'Canciones');
  assert.equal(await page.evaluate("document.getElementById('optLocale').value"), 'es');
});

test('an unknown saved locale falls back to English', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { locale: 'xx' } }));";
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());
  assert.equal(await page.evaluate('document.documentElement.lang'), 'en');
  assert.equal(await page.evaluate(navText('practice')), 'Practice');
});

for (const width of [320, 390]) {
  test(`in Spanish at ${width}px nothing overflows horizontally (nav, practice, Settings)`, async (t) => {
    const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { locale: 'es', mod: 'gtr' } }));";
    const page = await launchPage(htmlPath, { initScript });
    t.after(() => page.close());
    await page.setViewport({ width, height: 844, mobile: true });
    const pageOverflow = "document.documentElement.scrollWidth - document.documentElement.clientWidth";
    const navClipped = "JSON.stringify(Array.from(document.querySelectorAll('.main-nav button')).filter(b => b.scrollWidth > b.clientWidth).map(b => b.textContent))";
    assert.ok(await page.evaluate(pageOverflow) <= 0, `${width}px practice: page scrolls sideways by ${await page.evaluate(pageOverflow)}px`);
    assert.equal(await page.evaluate(navClipped), '[]', `${width}px nav labels clipped`);
    await openSettings(page);
    assert.ok(await page.evaluate(pageOverflow) <= 0, `${width}px settings: page scrolls sideways by ${await page.evaluate(pageOverflow)}px`);
    const wide = await page.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#settingsView *')).filter(e => e.getBoundingClientRect().right > innerWidth + 1).map(e => e.tagName + '#' + e.id + '.' + e.className))`);
    assert.equal(wide, '[]', `${width}px settings: elements past the right edge`);
  });
}

test('in Spanish the practice step buttons carry the names the Spanish prompts tell you to press', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { locale: 'es' } }));";
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());
  const buttons = "JSON.stringify(Array.from(document.querySelectorAll('.panel-songs-practice button')).map(b => b.textContent))";
  const click = label => page.evaluate(`Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === ${JSON.stringify(label)}).click()`);
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent.startsWith('Ode to Joy')).click()");
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  let labels = JSON.parse(await page.evaluate(buttons));
  assert.ok(labels.includes('Tócalo'), `Listen step shows Tócalo, got ${labels}`);
  assert.ok(labels.includes('Siguiente'), `Listen step shows Siguiente, got ${labels}`);
  assert.ok(!labels.includes('Next') && !labels.includes('Play it'), `no English step buttons, got ${labels}`);
  await click('Siguiente');
  await page.waitFor("document.querySelector('.panel-songs-practice h4').textContent.startsWith('Mira y escucha')");
  const heading = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.match(heading, /\(compases \d+-\d+\)$/, `demo heading names the bars in Spanish, got ${heading}`);
  assert.match(await page.evaluate("document.querySelector('.panel-songs-practice p').textContent"), /pulsa Siguiente/);
  await click('Siguiente');
  await page.waitFor(`${buttons}.includes('Te toca')`);
  await click('Te toca');
  await page.waitFor(`${buttons}.includes('Parar y comprobar')`);
});
