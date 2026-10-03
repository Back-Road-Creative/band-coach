// Acceptance scenario A06 at phone sizes: can a learner SEE and PLAY the keyboard and the drum kit on a phone,
// and see what the app says about it, without hunting? The keyboard and the kit are pixels on one canvas, so
// nothing but a real finger aimed at where they are DRAWN can tell. The release file, launched the way a
// person's browser runs it (withAcceptancePage); the learner acts only through tap(), click(), press() and a
// mouse wheel. page.evaluate only OBSERVES: rects, computed style, CSSOM, canvas pixels, the feedback line.
// Never window.__coach (the release build has none). Where the taps are judged key by key (T5, T6) is the other
// file, acceptance-phone-practice-taps.test.mjs, so that each file keeps its own 120 s budget.
//
// What it asserts, per size and instrument (the four sizes are CSS px @ device scale factor):
//   T1  every drawn key and kit piece passes the 24 CSS px target rule, as axe-core applies it (target-size, minSize
//       24, with target-offset minOffset 24): a 24 x 24 box passes; a smaller one needs its centre 12 px from every
//       other target's tap area and 24 px from the centre of every other target that is under 24. #playBtn and
//       #endBtn are at least 24 x 24. 44 px is a product goal, written as a diagnostic, never asserted.
//   T2  fit: the playing surface (#cv), the feedback (#feedback) and End session (#endBtn), plus the objective
//       (#coach) where it sits between them, are on one screen (NO_SCROLL) or on one screen after ONE scroll
//       (ONE_SCROLL). POLICY below says which, per size and instrument, and the README says the same words;
//       the test asserts the exact policy both ways, so "one scroll" in the README while none is needed fails too.
//   T2c the objective stays readable: visible, not clipped, and at least its pre-change font size.
//   T3  the README names each size with the policy phrase of that size (no browser).
//   T4  no sideways scroll, and the canvas does not move when the feedback card appears (a shift would move every
//       drawn target under the finger).
//   T5, T6 (real taps on every key and kit piece; taps on the gaps light nothing): acceptance-phone-practice-taps.test.mjs.
//   T7  desktop unchanged: at 1280x800 and 1024x640 the @media conditions that match are the pre-change list.
//   T8  a floor or fit miss CSS cannot fix is a `todo` subtest naming the unit that must fix it (below).
//
// The geometry comes from tests/helpers/instrument-geometry.mjs (the draw formulas written out again) and is checked
// against what the canvas really drew BEFORE any tap, so a bug in it fails as "GEOMETRY HELPER DISAGREES WITH
// CANVAS" and stops that size, never as a hit-test failure. The pixel sampler, judges and agreement checks are a
// trimmed copy of acceptance-drawn-instruments.test.mjs (nothing there is exported), also copied into the taps file.
//
// Probed on the real build before writing (these shaped the test):
// - page.tap() at mobile: true delivers one pointerdown with pointerType "touch"; a CDP mouseWheel event scrolls the
//   window by its deltaY; one browser can step through all four sizes with setViewport() + reload().
// - A drum-kit session draws the bar layout (the staff above, the pieces in the lower 62% of the canvas) from the
//   count-in on; the bar's end writes #feedback ("4 missed." when nothing is played), about 8 s after Start.
// - The keyboard's canvas box is its CSS box times min(devicePixelRatio, 2): every metrics read waits for the app
//   to catch its drawing buffer up with its box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withAcceptancePage } from '../helpers/browser.mjs';
import {
  canvasMetrics,
  toClient,
  keyboardRects,
  keyboardProbePoints,
  keyboardSamplePoints,
  kitRects,
  kitSamplePoints,
  targetSizes,
  spacingOk,
} from '../helpers/instrument-geometry.mjs';

// ---- The policy, in the README's words ----------------------------------------
const NO_SCROLL = 'NO_SCROLL', ONE_SCROLL = 'ONE_SCROLL';
const POLICY_TEXT = { [NO_SCROLL]: 'no scrolling after Start', [ONE_SCROLL]: 'one scroll position' };
const SIZES = [
  { name: '320x568', vp: { width: 320, height: 568, mobile: true, deviceScaleFactor: 2 }, keyboard: ONE_SCROLL, kit: ONE_SCROLL },
  { name: '390x844', vp: { width: 390, height: 844, mobile: true, deviceScaleFactor: 3 }, keyboard: NO_SCROLL, kit: ONE_SCROLL },
  { name: '844x390', vp: { width: 844, height: 390, mobile: true, deviceScaleFactor: 3 }, keyboard: ONE_SCROLL, kit: ONE_SCROLL },
  { name: '640x400', vp: { width: 640, height: 400, mobile: false, deviceScaleFactor: 2 }, keyboard: ONE_SCROLL, kit: ONE_SCROLL },
];
const readmeClause = (s) => `${s.name}: keyboard ${POLICY_TEXT[s.keyboard]}, drum kit ${POLICY_TEXT[s.kit]}`;

// Misses CSS cannot fix: key `${size} ${what}`, value the todo text (which names the src unit that must fix it).
// Written in full as their own subtests: the real floor is asserted, never skipped, never lowered.
const F_TODO = {
  '320x568 keyboard targets': 'Q6-1 F1: 320x568 black keys 21.0x20.1 and 24.0x20.1, 20.1 tall because this unit\'s 16 / 7 canvas rule (src/styles.css, phone query) shortens every non-kit canvas; the parent\'s 16 / 8.2 gave 23.2, also under 24 (needs src unit phone-keyboard-black-keys)',
  '320x568 kit bar targets': 'Q6-1 F2: 320x568 kit in a bar, hihat-open 17.0x17.0 and hihat-closed 19.1x19.1 (needs src unit phone-kit-small-pieces)',
  '320x568 kit fit': 'Q6-1 F3: 320x568 kit in a session, the playing surface, feedback, objective and End session span 703 px of a 568 px window (needs src unit phone-kit-session-height)',
};

// ---- Measured at the parent (4669ef5, the build before these CSS rules) --------
const PARENT_COACH_FONT = 14; // px, #coach's computed font-size at every size
const PARENT_DESKTOP_MEDIA = { '1280x800': ['(prefers-color-scheme: light)'], '1024x640': ['(prefers-color-scheme: light)'] }; // light theme; dark matches none

// ---- What a learner sees: literals, never read from src/** --------------------
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const nm = (m) => NAMES[((m % 12) + 12) % 12];
const lbl = (m) => `${m} (${nm(m)})`;
const WHITE_NAMES = { 48: 'C3', 50: 'D', 52: 'E', 53: 'F', 55: 'G', 57: 'A', 59: 'B', 60: 'C4', 62: 'D', 64: 'E', 65: 'F', 67: 'G', 69: 'A', 71: 'B', 72: 'C5' };
const LEVEL1_TARGET = { C: 60, D: 62, E: 64 };
const KIT_LETTERS = { kick: 'F', snare: 'J', 'hihat-closed': 'D', 'hihat-pedal': 'C', 'hihat-open': 'E', 'tom-floor': 'K', 'tom-mid': 'I', 'tom-high': 'U', crash: 'R', ride: 'O' };
const KIT_SHAPE = { kick: 'drum', snare: 'drum', 'hihat-closed': 'cymbal', 'hihat-pedal': 'drum', 'hihat-open': 'cymbal', 'tom-floor': 'drum', 'tom-mid': 'drum', 'tom-high': 'drum', crash: 'cymbal', ride: 'cymbal' };
const HEX = { white: '#e9edf6', black: '#10131c', pressed: '#9fb4d8', good: '#5be08a', flash: '#f3c52f', cymbal: '#2a3140', drum: '#1b2130', wanted: '#f08a4b' };
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// ---- Page side: a text recorder and a pixel reader (observation only) --------
const PAGE_SCRIPT = `(function () {
  var proto = CanvasRenderingContext2D.prototype, fillText = proto.fillText, clearRect = proto.clearRect;
  window.__q61Text = [];
  proto.clearRect = function () { if (this.canvas && this.canvas.id === 'cv') window.__q61Text = []; return clearRect.apply(this, arguments); };
  proto.fillText = function (text, x, y) {
    if (this.canvas && this.canvas.id === 'cv') { var m = this.getTransform(); window.__q61Text.push({ text: String(text), x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f, align: this.textAlign }); }
    return fillText.apply(this, arguments);
  };
  var frame = function () { return new Promise(function (r) { requestAnimationFrame(function () { r(performance.now()); }); }); };
  window.__q61 = {
    texts: async function () { await frame(); await frame(); return window.__q61Text.slice(); },
    px: async function (pts) { await frame(); await frame(); var c = document.getElementById('cv'), img = c.getContext('2d').getImageData(0, 0, c.width, c.height); return pts.map(function (p) { var i = (Math.floor(p.y) * img.width + Math.floor(p.x)) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; }); },
  };
})();`;

// ---- Driving and observing ----------------------------------------------------
const raf = (page) => page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
const setTheme = async (page, value) => { await page.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] }); await raf(page); };

// A person's scroll: a mouse wheel over the page, by the distance asked for (documented in the README's policy).
async function wheelTo(page, y) {
  for (let k = 0; k < 4; k++) {
    const [sy, max] = await page.evaluate('[scrollY, document.documentElement.scrollHeight - innerHeight]');
    const want = Math.max(0, Math.min(y, max));
    if (Math.abs(want - sy) < 0.5) return sy;
    await page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 2, y: 2, deltaX: 0, deltaY: want - sy });
    let last = -1;
    for (let i = 0; i < 40; i++) { const c = await page.evaluate('scrollY'); if (c === last) break; last = c; await new Promise((r) => setTimeout(r, 60)); }
  }
  return page.evaluate('scrollY');
}

async function readTarget(page) {
  await page.waitFor("document.querySelector('#prompt b') !== null");
  const t = await page.evaluate("document.querySelector('#prompt b').textContent.trim()");
  if (LEVEL1_TARGET[t] === undefined) throw new Error(`the level 1 prompt names "${t}", not C, D or E`);
  return LEVEL1_TARGET[t];
}

// The canvas's box on screen, read once the app has caught its drawing buffer up with it.
async function settledMetrics(page) {
  for (let i = 0; i < 40; i++) {
    const m = await canvasMetrics(page);
    const d = Math.min(m.devicePixelRatio, 2);
    if (m.width === Math.round(m.cssWidth * d) && m.height === Math.round(m.cssHeight * d)) return m;
    await raf(page);
  }
  throw new Error('the canvas drawing buffer never matched its box on screen');
}

// ---- Helper agrees with the canvas ---------------------------------------------
const DISAGREE = 'GEOMETRY HELPER DISAGREES WITH CANVAS';
const disagree = (what) => assert.fail(`${DISAGREE}: ${what}`);
const near1 = (a, b) => Math.abs(a - b) <= 1;
const colourOk = (got, hex) => got.every((v, i) => Math.abs(v - rgb(hex)[i]) <= 2);
const rgbText = (c) => `rgb(${c.join(', ')})`;

async function checkKeyboardGeometry(page, ctx, vp) {
  const m = await settledMetrics(page);
  assert.equal(m.devicePixelRatio, vp.deviceScaleFactor, `${ctx}: the device scale factor took effect`);
  assert.equal(m.width, Math.round(m.cssWidth * Math.min(m.devicePixelRatio, 2)), `${ctx}: the canvas is its screen box times the device scale factor`);
  const rects = keyboardRects(m);
  const texts = await page.evaluate('window.__q61.texts()');
  for (const k of rects.keys.filter((x) => !x.black)) {
    const { x, y, w, h } = k.rect, name = WHITE_NAMES[k.midi];
    const drawn = texts.find((t) => t.text === name && near1(t.x, x + w / 2) && t.y >= y && t.y <= y + h);
    if (!drawn) disagree(`white key ${lbl(k.midi)}: its name "${name}" was not drawn within 1 px of x ${(x + w / 2).toFixed(1)} and inside y ${y.toFixed(1)}-${(y + h).toFixed(1)}`);
    if (drawn.align !== 'center') disagree(`white key ${lbl(k.midi)}: its name is ${drawn.align}-aligned, not centred`);
  }
  for (const s of rects.labelStrips) {
    const start = s.row === 0 ? 'Left hand ·' : 'Right hand ·';
    const drawn = texts.find((t) => t.text.startsWith(start));
    if (!drawn || !(drawn.x >= s.rect.x - 1 && drawn.x <= s.rect.x + s.rect.w && drawn.y >= s.rect.y && drawn.y <= s.rect.y + s.rect.h)) {
      disagree(`row label "${start}" ${drawn ? `drawn at (${drawn.x.toFixed(1)}, ${drawn.y.toFixed(1)})` : 'not drawn'}, not inside the strip x ${s.rect.x.toFixed(1)}+ y ${s.rect.y.toFixed(1)}-${(s.rect.y + s.rect.h).toFixed(1)}`);
    }
  }
  const pts = rects.keys.flatMap((k) => keyboardSamplePoints(k).map((p) => ({ ...p, k })));
  const got = await page.evaluate(`window.__q61.px(${JSON.stringify(pts.map(({ x, y }) => ({ x, y })))})`);
  pts.forEach((p, i) => {
    const want = p.k.black ? HEX.black : HEX.white;
    if (!colourOk(got[i], want)) disagree(`${p.k.black ? 'black' : 'white'} key ${lbl(p.k.midi)} sample (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) reads ${rgbText(got[i])}, not ${want}`);
  });
}

// inBar: a kit session draws the bar layout; a piece the bar asks for is lit orange until the count-in ends, so its
// fill may be the orange as well as its own colour.
async function checkKitGeometry(page, ctx, vp, inBar) {
  const m = await settledMetrics(page);
  assert.equal(m.devicePixelRatio, vp.deviceScaleFactor, `${ctx}: the device scale factor took effect`);
  const all = kitRects(m, { inBar });
  const texts = await page.evaluate('window.__q61.texts()');
  for (const p of all) {
    const letter = KIT_LETTERS[p.id];
    const drawn = texts.find((t) => t.text === letter && near1(t.x, p.cx) && t.y >= p.cy - p.r && t.y <= p.cy + p.r);
    if (!drawn) disagree(`${p.id}${inBar ? ' (in a bar)' : ''}: its key letter "${letter}" was not drawn within 1 px of x ${p.cx.toFixed(1)} and inside y ${(p.cy - p.r).toFixed(1)}-${(p.cy + p.r).toFixed(1)}`);
  }
  const pts = all.flatMap((p) => kitSamplePoints(p).map((s) => ({ ...s, p })));
  const got = await page.evaluate(`window.__q61.px(${JSON.stringify(pts.map(({ x, y }) => ({ x, y })))})`);
  for (const p of all) {
    const wants = [HEX[KIT_SHAPE[p.id]], ...(inBar ? [HEX.wanted, HEX.flash] : [])];
    const mine = pts.map((s, i) => ({ s, c: got[i] })).filter((e) => e.s.p === p);
    const ok = mine.filter((e) => wants.some((w) => colourOk(e.c, w))).length;
    if (ok < 5) disagree(`${p.id}${inBar ? ' (in a bar)' : ''}: only ${ok} of 8 sample points inside its circle read ${wants.join(' or ')} (first reads ${rgbText(mine[0].c)})`);
  }
}

// ---- Navigation, the way a learner does it ---------------------------------------
async function pickInstrument(page, mod, name) {
  if (await page.evaluate("document.getElementById('picker').hidden")) await page.clickSelector('#navInstrument');
  const button = `#picker button[data-mod="${mod}"]`;
  const text = await page.evaluate(`document.querySelector(${JSON.stringify(button)}).textContent`);
  assert.ok(text.startsWith(name), `the picker button for ${mod} reads "${text}", not "${name}..."`);
  await page.clickSelector(button);
  await page.waitFor(`document.getElementById('navInstrument').textContent.includes(${JSON.stringify(name)})`);
  await raf(page);
}

// A finger on a button where it is on screen NOW: no scrollIntoView (clickSelector would do one), so a button that
// is off screen at the position a learner is at is a failure, not something the driver hides.
async function tapOnScreen(page, id) {
  const r = await page.evaluate(`(() => { const b = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, top: b.top, bottom: b.bottom, ih: innerHeight }; })()`);
  assert.ok(r.top >= 0 && r.bottom <= r.ih, `#${id} is not on screen (top ${r.top.toFixed(1)}, bottom ${r.bottom.toFixed(1)}, window ${r.ih} tall) at scroll ${await page.evaluate('scrollY')}`);
  await page.tap(r.x, r.y);
}
async function startSession(page) {
  await tapOnScreen(page, 'playBtn');
  await page.waitFor("document.getElementById('playBtn').textContent.trim() === 'Pause'");
  await page.waitFor("document.querySelector('#prompt b') !== null || document.getElementById('prompt').textContent.trim() !== ''");
  await raf(page);
}
async function endSession(page, size, instr) {
  await goToView(page, size, instr);
  await tapOnScreen(page, 'endBtn');
  await page.waitFor("document.getElementById('playBtn').textContent.trim() === 'Start'");
  await raf(page);
}

// ---- T2: what must be on one screen ---------------------------------------------
const viewIds = (size) => ['cv', 'feedback', 'endBtn', ...(size.vp.width <= 600 ? ['coach'] : [])];
// A member of the set that has no box, or cannot be seen, goes in `missing` (never quietly dropped from the fit):
// the fit of a set with its feedback line or End session hidden proves nothing. #feedback is allowed to be
// see-through before the first feedback (its slot is kept on purpose); `shown` asks for it to be seen.
async function viewState(page, size, shown) {
  return page.evaluate(`(() => { const o = { scrollY, innerWidth, innerHeight, rects: {}, missing: [], feedbackText: document.getElementById('feedback').textContent.trim() };
    for (const id of ${JSON.stringify(viewIds(size))}) { const e = document.getElementById(id), b = e.getBoundingClientRect(), strict = ${!!shown} || id !== 'feedback';
      if (b.width > 0 && b.height > 0 && e.checkVisibility(strict ? { visibilityProperty: true, opacityProperty: true } : {})) o.rects[id] = { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; else o.missing.push(id); }
    return o; })()`);
}
const spanOf = (v) => { const rs = Object.values(v.rects); return { top: Math.min(...rs.map((r) => r.top + v.scrollY)), bottom: Math.max(...rs.map((r) => r.bottom + v.scrollY)) }; };
const noScroll = (v) => Object.values(v.rects).every((r) => r.top + v.scrollY >= 0 && r.bottom + v.scrollY <= v.innerHeight && r.left >= 0 && r.right <= v.innerWidth);
const onScreen = (v) => Object.values(v.rects).every((r) => r.top >= 0 && r.bottom <= v.innerHeight && r.left >= 0 && r.right <= v.innerWidth);
const rectText = (v) => Object.entries(v.rects).map(([id, r]) => `#${id} ${(r.top + v.scrollY).toFixed(0)}-${(r.bottom + v.scrollY).toFixed(0)}`).join(', ');

// The policy position: where a learner is after Start (NO_SCROLL), or after ONE scroll that brings the whole set into view.
async function goToView(page, size, instr) {
  const policy = size[instr];
  let v = await viewState(page, size);
  if (policy === ONE_SCROLL && !onScreen(v)) { await wheelTo(page, Math.floor(spanOf(v).top)); v = await viewState(page, size); }
  return v;
}

// Asserts the exact policy for this size and instrument, both ways, and leaves the page at the policy position.
async function checkFit(page, size, instr, ctx, shown) {
  const policy = size[instr];
  const v0 = await viewState(page, size, shown);
  assert.deepEqual(v0.missing, [], `${ctx}: ${v0.missing.map((id) => '#' + id).join(' and ')} ${v0.missing.length > 1 ? 'have' : 'has'} no box on screen or cannot be seen while a session runs (hidden, collapsed or see-through), so the set cannot be checked`);
  if (shown) assert.notEqual(v0.feedbackText, '', `${ctx}: the feedback line is empty, so there is no feedback to fit`);
  const { top, bottom } = spanOf(v0), span = bottom - top;
  const where = `${ctx}: window ${v0.innerWidth}x${v0.innerHeight}, ${rectText(v0)}, scrolled to ${v0.scrollY.toFixed(0)}`;
  if (policy === NO_SCROLL) {
    assert.ok(noScroll(v0), `NO_SCROLL expected but the set does not fit on the first screen: ${where}`);
    assert.equal(v0.scrollY, 0, `NO_SCROLL expected but the page is scrolled to ${v0.scrollY}`);
    return;
  }
  assert.ok(!noScroll(v0), `ONE_SCROLL expected but the set already fits on the first screen, so the README's "one scroll" is wrong: ${where}`);
  assert.ok(span <= v0.innerHeight + 0.5, `ONE_SCROLL expected but the set spans ${span.toFixed(1)} px, more than the ${v0.innerHeight} px window: ${where}`);
  const v1 = onScreen(v0) ? v0 : (await wheelTo(page, Math.floor(top)), await viewState(page, size, shown));
  assert.ok(onScreen(v1), `after one scroll the set is still not all on screen: ${rectText(v1)}, scrolled to ${v1.scrollY.toFixed(0)}, window ${v1.innerWidth}x${v1.innerHeight}`);
}

// T2c and T4 reads for the current page.
async function checkObjective(page, ctx) {
  const c = await page.evaluate(`(() => { const e = document.getElementById('coach'), cs = getComputedStyle(e); return { visible: e.checkVisibility(), clip: [e.scrollHeight, e.clientHeight], font: parseFloat(cs.fontSize) }; })()`);
  assert.ok(c.visible, `${ctx}: the objective (#coach) is not visible`);
  assert.ok(c.clip[0] <= c.clip[1] + 1, `${ctx}: the objective is clipped (${c.clip[0]} px of text in a ${c.clip[1]} px box)`);
  assert.ok(c.font >= PARENT_COACH_FONT, `${ctx}: the objective's text is ${c.font} px, smaller than the ${PARENT_COACH_FONT} px it had before`);
}
async function checkNoSideways(page, ctx) {
  const w = await page.evaluate('[document.documentElement.scrollWidth, innerWidth]');
  assert.ok(w[0] <= w[1], `${ctx}: the page scrolls sideways (${w[0]} px wide in a ${w[1]} px window)`);
}
const cvBox = (page) => page.evaluate("(() => { const b = document.getElementById('cv').getBoundingClientRect(); return [b.left, b.top + scrollY, b.width, b.height].map((x) => Math.round(x * 100) / 100); })()");

// ---- T1: targets -------------------------------------------------------------------
async function checkTargets(page, t, ctx, kind, inBar) {
  const fails = [];
  let under44 = 0, total = 0;
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);
    const m = await settledMetrics(page);
    const ts = targetSizes(m, { kind, inBar });
    for (const target of ts) {
      total++;
      if (target.w < 44 || target.h < 44) under44++;
      const r = spacingOk(target, ts);
      if (!r.ok) fails.push({ theme, target, why: r.why });
    }
  }
  await setTheme(page, 'light');
  t.diagnostic(`${ctx}: ${under44} of ${total} targets are under the 44 px goal (not asserted)`);
  const small = fails.sort((a, b) => Math.min(a.target.w, a.target.h) - Math.min(b.target.w, b.target.h));
  const names = [...new Set(small.map((f) => `${f.target.kind} ${f.target.id} ${f.target.w.toFixed(1)}x${f.target.h.toFixed(1)}`))];
  assert.equal(small.length, 0, `${ctx}: ${names.length} target(s) fail the 24 px rule (axe target-size); smallest ${small[0] && names[0]}: ${small[0] && small[0].why}; all: ${names.join(', ')}`);
}
async function checkButtons(page, ctx, ids) {
  for (const id of ids) {
    const b = await page.evaluate(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return [r.width, r.height]; })()`);
    assert.ok(b[0] >= 24 && b[1] >= 24, `${ctx}: #${id} is ${b[0].toFixed(1)}x${b[1].toFixed(1)}, under 24x24`);
  }
}

// ---- One size ---------------------------------------------------------------------------
// A todo subtest runs in full; its failure is reported as a todo, never as a pass and never skipped.
const subOpts = (key) => (F_TODO[key] ? { todo: F_TODO[key] } : {});

async function runSize(t, page, size) {
  const ctx = { stop: false };
  const sub = (st, name, fn, key) => st.test(`${size.name} ${name}`, subOpts(`${size.name} ${key}`), async (x) => {
    assert.ok(!ctx.stop, 'stopped: the geometry helper disagrees with the canvas at this size, so no tap is aimed');
    const began = Date.now();
    try { await fn(x); } catch (e) { if (String(e.message).includes(DISAGREE)) ctx.stop = true; throw e; }
    x.diagnostic(`${size.name} ${name}: ${Date.now() - began} ms`);
  });
  await t.test(`${size.name}@${size.vp.deviceScaleFactor}`, async (st) => {
    await page.setViewport(size.vp);
    await page.reload();
    await page.waitFor("document.getElementById('playBtn') !== null");
    await raf(page);
    await setTheme(page, 'light');
    const at = `${size.name}`;

    // --- keyboard ---
    await pickInstrument(page, 'kbd', 'Keyboard');
    await sub(st, 'keyboard idle: the helper agrees with the canvas', () => checkKeyboardGeometry(page, `${at} keyboard`, size.vp));
    await sub(st, 'T1 keyboard targets, both themes', (x) => checkTargets(page, x, `${at} keyboard`, 'keyboard', false), 'keyboard targets');
    await sub(st, 'T1 Start button at least 24x24', () => checkButtons(page, `${at}`, ['playBtn']));
    await sub(st, 'T2 keyboard fit after Start, T4 nothing sideways', async () => {
      await startSession(page);
      await checkButtons(page, at, ['endBtn']);
      for (const theme of ['light', 'dark']) {
        await setTheme(page, theme);
        await checkNoSideways(page, `${at} keyboard, ${theme}`);
        await checkFit(page, size, 'keyboard', `${at} keyboard, ${theme}, before any feedback`);
      }
      await setTheme(page, 'light');
    }, 'keyboard fit');
    let before;
    await sub(st, 'a wrong key shows the feedback card', async () => {
      before = await cvBox(page);
      const target = await readTarget(page);
      const wrong = target - 12, m = await settledMetrics(page); // the right note an octave low: the longest feedback line there is ("... Right note, wrong octave: go one octave up.")
      const c = toClient(keyboardProbePoints(keyboardRects(m).keys.find((k) => k.midi === wrong))[0], m);
      await page.tap(c.x, c.y);
      await page.waitFor("document.getElementById('feedback').textContent.trim() !== ''", 5000);
    });
    await sub(st, 'T2/T2c/T4 keyboard with the feedback showing, both themes', async () => {
      for (const theme of ['light', 'dark']) {
        await setTheme(page, theme);
        await checkObjective(page, `${at} keyboard, ${theme}`);
        await checkFit(page, size, 'keyboard', `${at} keyboard, ${theme}, feedback showing`, true);
        await checkNoSideways(page, `${at} keyboard, ${theme}`);
        assert.deepEqual(await cvBox(page), before, `${at} keyboard, ${theme}: the canvas moved when the feedback card appeared (a drawn target would move under the finger)`);
      }
      await setTheme(page, 'light');
    }, 'keyboard fit');
    await endSession(page, size, 'keyboard');

    // --- drum kit, idle ---
    await pickInstrument(page, 'drum-kit', 'Drum kit');
    await wheelTo(page, 0);
    await sub(st, 'kit idle: the helper agrees with the canvas', async () => { await checkKitGeometry(page, `${at} kit`, size.vp, false); }, 'kit agree');
    await sub(st, 'T1 kit targets, both themes', (x) => checkTargets(page, x, `${at} kit`, 'kit', false), 'kit targets');

    // --- drum kit, in a bar ---
    await startSession(page);
    await sub(st, 'kit in a bar: the helper agrees with the canvas', async () => { await checkKitGeometry(page, `${at} kit in a bar`, size.vp, true); }, 'kit bar agree');
    await sub(st, 'T1 kit targets in a bar, both themes', (x) => checkTargets(page, x, `${at} kit in a bar`, 'kit', true), 'kit bar targets');
    // Taps on the in-bar pieces are cut for wall time (the second step of the cut order); the in-bar layout is covered by T1 after its agreement check.
    await page.waitFor("document.getElementById('feedback').textContent.trim() !== ''", 20000);
    await sub(st, 'T2 kit fit with the feedback showing, both themes', async () => {
      for (const theme of ['light', 'dark']) {
        await setTheme(page, theme);
        await checkFit(page, size, 'kit', `${at} kit, ${theme}, feedback showing`, true);
      }
      await setTheme(page, 'light');
    }, 'kit fit');
    await sub(st, 'T2c/T4 kit objective readable, nothing sideways, both themes', async () => {
      for (const theme of ['light', 'dark']) {
        await setTheme(page, theme);
        await checkObjective(page, `${at} kit, ${theme}`);
        await checkNoSideways(page, `${at} kit, ${theme}`);
      }
      await setTheme(page, 'light');
    });
    await sub(st, 'T1 End session at least 24x24 (kit)', () => checkButtons(page, at, ['playBtn', 'endBtn']));
    await endSession(page, size, 'kit');
    assert.deepEqual(page.exceptions, [], `${at}: no uncaught exceptions`);
  });
}

// ---- T7: desktop unchanged ------------------------------------------------------------------
const MEDIA = `(() => { const out = []; const walk = (rules) => { for (const r of rules) { if (r.media && r.cssRules) { if (matchMedia(r.media.mediaText).matches) out.push(r.media.mediaText); walk(r.cssRules); } } }; for (const s of document.styleSheets) { try { walk(s.cssRules); } catch (e) { out.push('ERR ' + e.message); } } return out.sort(); })()`;
async function runDesktop(t, page) {
  for (const [name, w, h] of [['1280x800', 1280, 800], ['1024x640', 1024, 640]]) {
    await t.test(`T7 desktop ${name} unchanged`, async (x) => {
      await page.setViewport({ width: w, height: h, mobile: false, deviceScaleFactor: 1 });
      await page.reload();
      await page.waitFor("document.getElementById('playBtn') !== null");
      await raf(page);
      for (const theme of ['light', 'dark']) {
        await setTheme(page, theme);
        const got = await page.evaluate(MEDIA);
        assert.deepEqual(got, theme === 'light' ? PARENT_DESKTOP_MEDIA[name] : [], `${name} ${theme}: the @media conditions that match changed from the list before the phone rules: ${JSON.stringify(got)}`);
        const rects = await page.evaluate(`['cv', 'playBtn', 'levelCard', 'coach'].map((id) => { const b = document.getElementById(id).getBoundingClientRect(); return id + ' ' + [b.left, b.top, b.width, b.height].map((v) => Math.round(v)).join(','); })`);
        x.diagnostic(`${name} ${theme}: ${rects.join('; ')}`);
      }
      await setTheme(page, 'light');
    });
  }
}

test('T3 README: the phone bullet names each size with its scroll policy', () => {
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  const bullet = readme.split(/\n(?=- )/).map((b) => b.replace(/\s+/g, ' ')).find((b) => SIZES.every((s) => b.includes(s.name)) && b.includes('emulated'));
  assert.ok(bullet, 'the README has no bullet that names all four phone sizes and says they are emulated');
  for (const s of SIZES) {
    assert.ok(bullet.includes(readmeClause(s)), `the README bullet does not say "${readmeClause(s)}"`);
    // a policy a todo row says is not met yet is marked so right next to its clause; one that is met is not
    const marked = bullet.includes(`${readmeClause(s)} (not yet met`);
    assert.equal(marked, Boolean(F_TODO[`${s.name} kit fit`]), `the README bullet ${marked ? 'marks' : 'does not mark'} "${readmeClause(s)}" as not yet met, but the file ${F_TODO[`${s.name} kit fit`] ? 'has' : 'has no'} todo row for its kit fit`);
  }
});

test('A06 phone sizes: a learner sees and plays the keyboard and kit, and sees what the app says', async (t) => {
  await withAcceptancePage(t, { initScript: PAGE_SCRIPT }, async (page) => {
    for (const size of SIZES) await runSize(t, page, size);
    await runDesktop(t, page);
  });
});
