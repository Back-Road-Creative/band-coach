// A newcomer's first walk, run at seven screen shapes against the RELEASE file (BAND_COACH_HTML, else
// dist/release/band-coach.html): first open, instrument sheet, keyboard chosen, Start, a wrong note, Songs,
// Progress, Settings, then Tuner / Guitar / Drums from the sheet. Every action is a real click or key press;
// nothing reaches through window.__coach. Live today: no sideways scroll and no console event, at every
// config x state. Written in full but still todo where the defect is measured (each flips by deleting
// its `todo` option): the four checks the U units fix. A check is todo only at the configs where it
// fails today (CI's summary refuses a todo that passes), U2, U5 and U6 have landed. U6 wraps a long variant list (the phone shows a short "More" chip). Their measured values are printed so the flip is one word.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';

const CONFIGS = [
  { name: 'phone-light', w: 390, h: 844, mobile: true, theme: 'light' },
  { name: 'phone-dark', w: 390, h: 844, mobile: true, theme: 'dark' },
  { name: 'land-light', w: 844, h: 390, mobile: true, theme: 'light' },
  { name: 'land-dark', w: 844, h: 390, mobile: true, theme: 'dark' },
  { name: 'laptop-light', w: 1366, h: 768, mobile: false, theme: 'light' },
  { name: 'laptop-dark', w: 1366, h: 768, mobile: false, theme: 'dark' },
  { name: 'laptop-zoom20', w: 1366, h: 768, mobile: false, theme: 'light', zoom: true },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MEASURE = `(() => {
  const vw = innerWidth, vh = innerHeight, de = document.documentElement;
  const vis = (el) => { if (el.closest('[hidden]')) return false; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const ctrls = [...document.querySelectorAll('button, a[href], select, input, summary, [role=button], [tabindex]:not([tabindex="-1"])')].filter(vis);
  const inView = ctrls.filter(el => { const b = el.getBoundingClientRect(); return b.bottom > 0 && b.top < vh && b.right > 0 && b.left < vw; });
  const lab = (el) => (el.id ? '#' + el.id + ' ' : '') + (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
  const small = inView.filter(el => { const b = el.getBoundingClientRect(); return b.height < 44 || b.width < 44; }).map(el => { const b = el.getBoundingClientRect(); return lab(el) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height); });
  const offRight = [...document.querySelectorAll('body *')].filter(vis).filter(el => el.getBoundingClientRect().right > vw + 1).map(el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') + ' r=' + Math.round(el.getBoundingClientRect().right)).slice(0, 12);
  const parse = (c) => { const m = c.match(/[\\d.]+/g); return m ? m.map(Number) : [0,0,0,0]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.length < 4 || c[3] > 0) return getComputedStyle(e).backgroundColor; } return 'rgb(255,255,255)'; };
  const contrast = (el) => { if (!el) return null; const fg = getComputedStyle(el).color, bg = bgOf(el); const a = lum(parse(fg)), b = lum(parse(bg)); return { fg, bg, fontSize: getComputedStyle(el).fontSize, ratio: +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2) }; };
  const box = (id) => { const el = document.getElementById(id); if (!el || !vis(el)) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  // A label "ends in an ellipsis" if its text does, or if the browser clips it with one (text-overflow: ellipsis).
  const clipped = (el) => [el, ...el.querySelectorAll('*')].some(n => getComputedStyle(n).textOverflow === 'ellipsis' && n.scrollWidth > n.clientWidth);
  const ellipsis = ctrls.filter(el => /(…|\\.\\.\\.)$/.test((el.getAttribute('aria-label') || el.textContent || '').trim()) || clipped(el)).map(lab);
  const prompt = document.getElementById('prompt');
  return {
    ellipsis,
    vw, vh, scrollW: de.scrollWidth, clientW: de.clientWidth, sideways: de.scrollWidth > de.clientWidth, scrollH: de.scrollHeight,
    rootFont: getComputedStyle(de).fontSize, colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', dataTheme: de.dataset.theme || null,
    controlsVisible: ctrls.length, controlsInView: inView.length, smallControls: small, offRight,
    prompt: prompt && prompt.textContent.trim() ? { text: prompt.textContent.trim(), ...contrast(prompt) } : null,
    coach: contrast(document.getElementById('coach')), coachText: (document.getElementById('coach')||{}).textContent,
    hint: contrast(document.getElementById('hint')), hintText: (document.getElementById('hint')||{}).textContent,
    feedback: (document.getElementById('feedback')||{}).textContent, feedbackC: contrast(document.getElementById('feedback')),
    playBtn: box('playBtn'), playText: (document.getElementById('playBtn')||{}).textContent, endBtn: box('endBtn'), cv: box('cv'), nav: box('mainNav'), picker: box('picker'), panelHost: box('panelHost'), settingsView: box('settingsView'),
    navInstrument: (document.getElementById('navInstrument')||{}).textContent,
    bodyFont: getComputedStyle(document.body).fontSize, navFont: getComputedStyle(document.querySelector('#mainNav button')).fontSize,
    promptFont: prompt ? getComputedStyle(prompt).fontSize : null,
  };
})()`;


// launchPage gives every walk a brand-new browser profile (its own user-data-dir), so the FIRST document is
// already a first visit. This records what storage held at the very start of that document, before any app
// script ran, so the walk can prove it began fresh instead of reloading until it looked fresh.
const RECORD_STORAGE_AT_START = "window.__walkStartStorage = (function () { try { return localStorage.length; } catch (e) { return -1; } })();\n";

// Walks one config; returns [{ state, m, events }] (m = the page measured after the state settled).
async function walk(t, cfg) {
  const states = [];
  await withAcceptancePage(t, { initScript: RECORD_STORAGE_AT_START }, async (page) => {
    const events = [];
    page.cdp.on((m) => {
      if (m.method === 'Runtime.consoleAPICalled') events.push({ kind: 'console.' + m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300) });
      if (m.method === 'Runtime.exceptionThrown') events.push({ kind: 'exception', text: (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 300) });
      if (m.method === 'Log.entryAdded') events.push({ kind: 'log.' + m.params.entry.level, text: m.params.entry.text.slice(0, 300) });
    });
    await page.cdp.send('Log.enable').catch(() => {});
    let seen = 0;
    const snap = async (state) => {
      await sleep(300);
      const m = await page.evaluate(MEASURE);
      const ev = events.slice(seen); seen = events.length;
      states.push({ state, m, events: ev });
    };
    await page.setViewport({ width: cfg.w, height: cfg.h, mobile: cfg.mobile });
    await page.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: cfg.theme }] });
    // A newcomer's first open: the profile is brand new, so no reload or clearing is needed (and none is done).
    assert.equal(await page.evaluate('window.__walkStartStorage'), 0, 'the walk starts on a truly fresh profile: no saved data before the app ran');
    const fresh = "!document.getElementById('picker').hidden && !/:/.test(document.getElementById('navInstrument').textContent)";
    assert.ok(await page.evaluate(fresh), 'the walk starts on a first visit: instrument sheet open, no instrument named');
    if (cfg.zoom) await page.evaluate("document.documentElement.style.fontSize='20px'; dispatchEvent(new Event('resize'))");
    await snap('01-first-open');
    if (await page.evaluate("document.getElementById('picker').hidden")) await page.clickSelector('#navInstrument');
    await page.evaluate("document.querySelector('#picker button[data-mod=\"drum-kit\"]').scrollIntoView({block:'center'})");
    await snap('02-picker-open');
    await page.evaluate("window.scrollTo(0,0); document.querySelector('#picker button[data-mod=\"kbd\"]').scrollIntoView({block:'center'})");
    await page.clickSelector('#picker button[data-mod="kbd"]');
    await snap('03a-keyboard-chosen');
    await page.evaluate('document.activeElement && document.activeElement.blur()');
    await page.clickSelector('#playBtn');
    await page.waitFor("document.getElementById('playBtn').textContent.trim() === 'Pause'");
    await page.waitFor("document.querySelector('#prompt b')");
    await snap('03b-practice');
    const KEY_FOR = { C: 'a', D: 's', E: 'd', F: 'f', G: 'g', A: 'h', B: 'j' };
    const asked = await page.evaluate("document.querySelector('#prompt b').textContent");
    const wrong = Object.entries(KEY_FOR).find(([n]) => n !== asked.split(' ')[0]);
    await page.press(wrong[1], { text: wrong[1] });
    await sleep(150);
    await snap('04-wrong-note');
    await page.clickSelector('#playBtn');
    for (const [state, route] of [['05-songs', 'songs'], ['06-progress', 'progress'], ['07-settings', 'settings']]) {
      await page.evaluate('window.scrollTo(0,0)');
      await page.clickSelector(`#mainNav button[data-route="${route}"]`);
      await snap(state);
    }
    for (const [state, mod] of [['08-tuner', 'tuner'], ['09-guitar', 'gtr'], ['10-drums', 'drum-kit']]) {
      await page.evaluate('window.scrollTo(0,0)');
      await page.clickSelector('#mainNav button[data-route="practice"]');
      await page.clickSelector('#navInstrument');
      await page.waitFor("!document.getElementById('picker').hidden");
      await page.clickSelector(`#picker button[data-mod="${mod}"]`);
      await page.evaluate('window.scrollTo(0,0)');
      await snap(state);
    }
  });
  return states;
}

for (const cfg of CONFIGS) {
  test(`newcomer walk: ${cfg.name} (${cfg.w}x${cfg.h})`, async (t) => {
    const states = await walk(t, cfg);
    assert.equal(states.length, 11, 'every state of the walk was reached');
    const diag = (s) => t.diagnostic(`${cfg.name}: ${s}`);

    await t.test('no sideways scroll in any state', () => {
      const bad = states.filter((s) => s.m.sideways).map((s) => `${s.state}: scrollWidth ${s.m.scrollW} > clientWidth ${s.m.clientW}; off right: ${s.m.offRight.join(', ')}`);
      assert.deepEqual(bad, []);
    });
    await t.test('no console event, exception or browser log entry in any state', () => {
      const bad = states.flatMap((s) => s.events.map((e) => `${s.state}: ${e.kind} ${e.text}`));
      assert.deepEqual(bad, []);
    });

    // ---- todo until the named U unit lands: delete `todo` to switch on ----
    // Measured on CI run 39273798944: Start sits below the first screen only at 844x390, and the hint
    // fails 4.5:1 only on the light theme (2.45; dark 7.41). Elsewhere these already pass, so they run live.
    await t.test('every control in view is at least 44x44 (U3)', { todo: 'U3' }, () => {
      const per = states.map((s) => `${s.state}=${s.m.smallControls.length}`);
      diag(`small controls per state: ${per.join(' ')}`);
      for (const s of states) if (s.m.smallControls.length) diag(`  ${s.state}: ${s.m.smallControls.join('; ')}`);
      const bad = states.filter((s) => s.m.smallControls.length).map((s) => `${s.state}: ${s.m.smallControls.join('; ')}`);
      assert.deepEqual(bad, []);
    });
    // One question first: Start is hidden until an instrument is chosen, so it is measured right after the choice.
    await t.test('Start is on the first screen once an instrument is chosen (U2)', () => {
      const first = states.find((s) => s.state === '03a-keyboard-chosen').m, b = first.playBtn;
      diag(`Start box after the choice: ${JSON.stringify(b)} (viewport height ${first.vh})`);
      assert.ok(b, 'Start is visible once an instrument is chosen');
      assert.ok(b.y >= 0 && b.y + b.h <= first.vh, `Start spans y ${b.y}..${b.y + b.h}, below the ${first.vh}px first screen`);
    });
    await t.test('no control label ends in an ellipsis (U6)', () => {
      diag(`labels ending in an ellipsis: ${states.map((s) => `${s.state}=${s.m.ellipsis.length}`).join(' ')}`);
      const bad = states.filter((s) => s.m.ellipsis.length).map((s) => `${s.state}: ${s.m.ellipsis.join('; ')}`);
      assert.deepEqual(bad, []);
    });
    await t.test('hint text contrast is at least 4.5:1 (U5)', () => {
      diag(`hint contrast per state: ${states.map((s) => `${s.state}=${s.m.hint ? s.m.hint.ratio : 'none'}`).join(' ')}`);
      const bad = states.filter((s) => s.m.hint && s.m.hint.ratio < 4.5).map((s) => `${s.state}: ${s.m.hint.ratio} (${s.m.hint.fg} on ${s.m.hint.bg})`);
      assert.deepEqual(bad, []);
    });
  });
}
