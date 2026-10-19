// Computed contrast on the RELEASE file, in the three ways a person meets a theme: the system asks for
// light, the system asks for dark, and "Light" chosen in Settings while the system is dark. Each theme gets
// a fresh page (the accent colours are worked out when a screen is drawn, so a theme flipped under a
// finished page would measure stale colours). The method is the newcomer walk's: the element's computed
// colour against the first ancestor that paints a background colour (tests/release/
// acceptance-newcomer-walk.test.mjs, MEASURE). The learner acts only through clicks and keys; page.evaluate
// reads colours. Floors: 4.5 for text, the title accent and the keyboard focus ring; 3 for the big
// display type (#prompt, the break card's heading, the tap pad), which is WCAG large text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';
import { tabTo } from '../helpers/journey.mjs';

const THEMES = [
  { name: 'light', os: 'light', chosen: null },
  { name: 'dark', os: 'dark', chosen: null },
  { name: 'system-dark with Light chosen', os: 'dark', chosen: 'light' },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FRESH = "if (sessionStorage.getItem('__fresh')) { sessionStorage.removeItem('__fresh'); localStorage.clear(); }\n";

// Reads { ratio, fg, bg, size } for the first element matching `sel` (colour: its text colour, or with
// ring:true the outline colour of the focused element against its parent's surface).
const SAMPLE = (sel, ring) => `(() => {
  const parse = (c) => { const m = c.match(/[\\d.]+/g); return m ? m.map(Number) : [0,0,0,0]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.length < 4 || c[3] > 0) return getComputedStyle(e).backgroundColor; } return 'rgb(255,255,255)'; };
  const el = ${ring ? 'document.activeElement' : `document.querySelector(${JSON.stringify(sel)})`};
  if (!el || el.closest('[hidden]') || !el.getBoundingClientRect().width) return null;
  const cs = getComputedStyle(el), fg = ${ring ? 'cs.outlineColor' : 'cs.color'}, bg = bgOf(${ring ? 'el.parentElement' : 'el'});
  if (${ring ? 'true' : 'false'} && (cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth) === 0)) return { noRing: (el.id || el.tagName) };
  const a = lum(parse(fg)), b = lum(parse(bg));
  return { fg, bg, size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight), who: el.id || el.tagName, ratio: +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2) };
})()`;

async function measureTheme(t, th) {
  const got = {};
  await withAcceptancePage(t, { initScript: FRESH }, async (page) => {
    await page.setViewport({ width: 390, height: 844, mobile: true });
    await page.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: th.os }] });
    for (let i = 0; i < 2; i++) { await page.evaluate("sessionStorage.setItem('__fresh', '1')"); await page.reload(); }
    if (th.chosen) {
      await page.evaluate(`(() => { const s = document.getElementById('optTheme'); s.value = ${JSON.stringify(th.chosen)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    }
    await sleep(300);
    const take = async (key, sel, min) => { got[key] = { min, m: await page.evaluate(SAMPLE(sel, false)) }; };
    await take('title accent (h1 span)', 'h1 span', 4.5);
    // Keyboard focus ring: Tab onto the first control that shows one, on the first screen.
    for (let i = 0; i < 12 && !got['focus ring']; i++) {
      await page.press('Tab');
      const m = await page.evaluate(SAMPLE('', true));
      if (m && !m.noRing) got['focus ring'] = { min: 4.5, m };
    }
    await page.evaluate('document.activeElement && document.activeElement.blur()');
    if (await page.evaluate("document.getElementById('picker').hidden")) await page.clickSelector('#navInstrument');
    await page.clickSelector('#picker button[data-mod="kbd"]');
    await page.evaluate('document.activeElement && document.activeElement.blur()');
    await page.clickSelector('#playBtn');
    await page.waitFor("document.getElementById('playBtn').textContent.trim() === 'Pause'");
    await page.waitFor("document.querySelector('#prompt b')");
    await sleep(200);
    await take('#prompt', '#prompt', 3);
    await take('#prompt b', '#prompt b', 4.5);
    await take('#hint', '#hint', 4.5);
    await page.clickSelector('#playBtn');
    await page.waitFor("!document.getElementById('breakCard').hidden");
    await take('break h2', '.break h2', 3);
    await page.clickSelector('#backBtn');
    await page.waitFor("document.getElementById('breakCard').hidden");
    await page.clickSelector('#endBtn');
    await page.clickSelector('#navInstrument');
    await page.waitFor("!document.getElementById('picker').hidden");
    await page.clickSelector('#picker button[data-mod="rhy"]');
    await page.waitFor("!document.getElementById('tapPad').hidden");
    await take('#tapPad', '#tapPad', 3);
  });
  return got;
}

for (const th of THEMES) {
  test(`computed contrast at 390x844, ${th.name}`, async (t) => {
    const got = await measureTheme(t, th);
    const lines = Object.entries(got).map(([k, v]) => `${k}: ${v.m ? v.m.ratio : 'not on screen'} (need ${v.min}) ${v.m ? `${v.m.fg} on ${v.m.bg}` : ''}`);
    t.diagnostic(`${th.name}: ${lines.join(' | ')}`);
    const expected = ['title accent (h1 span)', 'focus ring', '#prompt', '#prompt b', '#hint', 'break h2', '#tapPad'];
    const missing = expected.filter((k) => !got[k] || !got[k].m);
    assert.deepEqual(missing, [], 'every element was on screen to measure');
    const bad = expected.filter((k) => got[k].m.ratio < got[k].min).map((k) => `${k} ${got[k].m.ratio} < ${got[k].min} (${got[k].m.fg} on ${got[k].m.bg})`);
    assert.deepEqual(bad, []);
  });
}
