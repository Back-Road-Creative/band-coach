// Acceptance scenario A06 at phone sizes: can a learner SEE and PLAY the keyboard and the drum kit on a phone,
// and see what the app says about it, without hunting? The keyboard and the kit are pixels on one canvas, so
// nothing but a real finger aimed at where they are DRAWN can tell. The release file, launched the way a
// person's browser runs it (withAcceptancePage); the learner acts only through tap(), click(), press() and a
// mouse wheel. page.evaluate only OBSERVES: rects, computed style, CSSOM, canvas pixels, the feedback line.
// Never window.__coach (the release build has none).
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
//   T5  real taps: every white key, every black key (centre and the two points just outside its edges), every kit piece (its centre and its inside east and south edges, idle), aimed at
//       where it is drawn, at the position the policy says; the key or piece that lights is the one aimed at.
//   T6  negative control: taps on the gaps, label strips and empty space light nothing.
//   T7  desktop unchanged: at 1280x800 and 1024x640 the @media conditions that match are the pre-change list.
//   T8  a floor or fit miss CSS cannot fix is a `todo` subtest naming the unit that must fix it (below).
//
// The geometry comes from tests/helpers/instrument-geometry.mjs (the draw formulas written out again) and is checked
// against what the canvas really drew BEFORE any tap, so a bug in it fails as "GEOMETRY HELPER DISAGREES WITH
// CANVAS" and stops that size, never as a hit-test failure. The pixel sampler, judges and agreement checks are a
// trimmed copy of acceptance-drawn-instruments.test.mjs (nothing there is exported).
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
  kitProbePoints,
  kitEmptyPoint,
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
  '320x568 keyboard targets': 'Q6-1 F1: 320x568 black keys 21.0x20.1 and 24.0x20.1 (needs src unit phone-keyboard-black-keys)',
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
const KEY_COLOURS = { pressed: rgb(HEX.pressed), good: rgb(HEX.good) };
const COLOUR_NAME = { pressed: `pressed (${HEX.pressed})`, good: `passed (${HEX.good})` };
const KEY_BUSY = [rgb(HEX.pressed), rgb(HEX.good)];
const KIT_COLOURS = { flash: rgb(HEX.flash) };
const KIT_BUSY = [rgb(HEX.flash)];

// ---- Page side: a text recorder and a pixel sampler (observation only) --------
const PAGE_SCRIPT = `(function () {
  var proto = CanvasRenderingContext2D.prototype, fillText = proto.fillText, clearRect = proto.clearRect;
  window.__q61Text = [];
  proto.clearRect = function () { if (this.canvas && this.canvas.id === 'cv') window.__q61Text = []; return clearRect.apply(this, arguments); };
  proto.fillText = function (text, x, y) {
    if (this.canvas && this.canvas.id === 'cv') { var m = this.getTransform(); window.__q61Text.push({ text: String(text), x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f, align: this.textAlign }); }
    return fillText.apply(this, arguments);
  };
  var inputs = [];
  var note = function () { inputs.push(performance.now()); };
  window.addEventListener('pointerdown', note, true);
  window.addEventListener('keydown', note, true);
  var frame = function () { return new Promise(function (r) { requestAnimationFrame(function () { r(performance.now()); }); }); };
  var snap = function () { var c = document.getElementById('cv'); return c.getContext('2d').getImageData(0, 0, c.width, c.height); };
  var read = function (img, p) { var i = (Math.floor(p.y) * img.width + Math.floor(p.x)) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
  var near = function (a, b) { return Math.abs(a[0] - b[0]) <= 2 && Math.abs(a[1] - b[1]) <= 2 && Math.abs(a[2] - b[2]) <= 2; };
  var count = function (img, g, c) { var n = 0; for (var i = 0; i < g.pts.length; i++) if (near(read(img, g.pts[i]), c)) n++; return n; };
  window.__q61 = {
    texts: async function () { await frame(); await frame(); return window.__q61Text.slice(); },
    px: async function (pts) { await frame(); await frame(); var img = snap(); return pts.map(function (p) { return read(img, p); }); },
    // Wait for quiet, then start recording; the recording's promise is left on window.__q61Sample for a second
    // evaluate to await after the action. A group lit when recording starts that is not in quietIds is credited only
    // once it has gone out and lit again (the PREVIOUS tap's light is never credited to this one); one that stays lit
    // the whole recording comes back as "masked": a hit on it could not be seen.
    start: async function (spec) {
      var t0 = performance.now(), quiet = false, img;
      var isBusy = function (img, g) { return spec.busy.some(function (c) { return count(img, g, c) >= g.need; }); };
      var watched = spec.groups.filter(function (g) { return !spec.quietIds || spec.quietIds.indexOf(g.id) >= 0; });
      for (;;) {
        await frame(); img = snap();
        if (!watched.some(function (g) { return isBusy(img, g); })) { quiet = true; break; }
        if (performance.now() - t0 > spec.quietMs) break;
      }
      var waited = performance.now() - t0;
      if (!quiet) return { quiet: false, waited: waited };
      var armed = {};
      spec.groups.forEach(function (g) { armed[g.id] = !isBusy(img, g); });
      var base = inputs.length;
      window.__q61Sample = (async function () {
        var seen = {}, begin = performance.now(), after = 0, last = begin, gap = 0;
        for (;;) {
          var at = await frame(); img = snap(); gap = Math.max(gap, at - last); last = at;
          var inputAt = inputs.length > base ? inputs[base] : null;
          for (var gi = 0; gi < spec.groups.length; gi++) {
            var g = spec.groups[gi];
            if (!armed[g.id]) { if (!isBusy(img, g)) armed[g.id] = true; continue; }
            for (var name in spec.colours) if (count(img, g, spec.colours[name]) >= g.need) { seen[g.id] = seen[g.id] || {}; if (seen[g.id][name] === undefined) seen[g.id][name] = at; }
          }
          if (inputAt !== null && at > inputAt) after++;
          if ((inputAt !== null && after >= 3 && at - begin >= 30) || at - begin >= 700) return { seen: seen, inputAt: inputAt, inputs: inputs.length - base, frames: after, maxGap: gap, masked: spec.groups.filter(function (g) { return !armed[g.id]; }).map(function (g) { return g.id; }) };
        }
      })();
      return { quiet: true, waited: waited };
    },
  };
})();`;

// ---- Driving and observing ----------------------------------------------------
const raf = (page) => page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
const feedback = (page) => page.evaluate("document.getElementById('feedback').textContent.trim()");
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

async function observe(page, groups, colours, busy, action, quietIds) {
  const q = await page.evaluate(`window.__q61.start(${JSON.stringify({ groups, colours, busy, quietMs: 400, quietIds })})`);
  if (!q.quiet) throw new Error(`the previous input was still lit after ${Math.round(q.waited)} ms, so this one cannot be told apart from it`);
  await action();
  return page.evaluate('window.__q61Sample');
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

// ... and a refusal if a person could not reach all of it where the page is now scrolled to.
async function reachable(page) {
  const m = await settledMetrics(page);
  const inside = m.left >= 0 && m.top >= 0 && m.left + m.cssWidth <= m.innerWidth && m.top + m.cssHeight <= m.innerHeight;
  assert.ok(inside, `the canvas is not fully on screen: left ${m.left.toFixed(1)}, top ${m.top.toFixed(1)}, ${m.cssWidth}x${m.cssHeight} in a ${m.innerWidth}x${m.innerHeight} window`);
  return m;
}

const keyGroups = (rects) => rects.keys.map((k) => { const pts = keyboardSamplePoints(k); return { id: k.midi, pts, need: pts.length }; });
const kitGroups = (all) => all.map((p) => ({ id: p.id, pts: kitSamplePoints(p), need: 5 }));
const aimVia = (page, m, pt) => { const c = toClient(pt, m); return () => page.tap(c.x, c.y); };

function missText(clicked, target) {
  const st = clicked - target, n = Math.abs(st);
  const where = n === 12 ? `Right note, wrong octave: go one octave ${st > 0 ? 'down' : 'up'}.` : `Go ${n} key${n > 1 ? 's' : ''} to the ${st > 0 ? 'left' : 'right'}.`;
  return `That was ${nm(clicked)}, the note is ${nm(target)}. ${where}`;
}
const passText = (target, afterMiss) => (afterMiss ? new RegExp(`^That is the one\\. ${nm(target)}\\.$`) : new RegExp(`^${nm(target)}: yes, in [0-9.]+ s\\.$`));
const afterMissLine = (before) => before.startsWith('That was ');
const stallNote = (res, pulse) => (res.maxGap > pulse * 0.6 ? `; the page went ${Math.round(res.maxGap)} ms between two frames while it was watched, so a ${pulse} ms light could have been missed` : '');

function keyboardFailure(where, expect, passed, res) {
  const want = passed ? 'good' : 'pressed', mine = res.seen[expect] || {};
  const lit = Object.keys(res.seen).map(Number).filter((k) => res.seen[k].pressed !== undefined || res.seen[k].good !== undefined);
  const others = lit.filter((k) => k !== expect);
  const colour = lit.includes(expect) && mine[want] === undefined ? `${lbl(expect)} lit ${Object.keys(mine).map((c) => COLOUR_NAME[c]).join(' and ')}, not ${COLOUR_NAME[want]}` : '';
  const right = lit.includes(expect) && mine[want] !== undefined;
  const got = [others.length ? others.map(lbl).join(' and ') : '', colour].filter(Boolean).join(' and ');
  const masked = res.masked.map(lbl);
  return `${where}: expected ${lbl(expect)} got ${got ? got + (right ? ', as well as the right key' : '') : 'nothing lit'}${masked.length ? `; ${masked.join(' and ')} ${masked.length > 1 ? 'were' : 'was'} still lit from the previous input, so a hit on ${masked.length > 1 ? 'them' : 'it'} could not be seen` : ''}${stallNote(res, 220)}`;
}

// One keyboard tap and everything the learner would notice. `expect` is the MIDI number that must be delivered,
// or null for "nothing may play here".
async function keyboardInput(page, ctx, { act, expect, what }) {
  const target = await readTarget(page);
  const before = await feedback(page);
  const afterMiss = afterMissLine(before);
  await page.evaluate("window.__q61Asked = document.querySelector('#prompt b')");
  const m = await reachable(page);
  const rects = keyboardRects(m);
  const res = await observe(page, keyGroups(rects), KEY_COLOURS, KEY_BUSY, act(m, rects), expect === null ? undefined : [expect]);
  const text = await feedback(page);
  const where = `${ctx} (${what})`;
  assert.ok(res.inputs >= 1, `${where}: the page received no input at all`);
  const lit = Object.keys(res.seen).map(Number).filter((k) => res.seen[k].pressed !== undefined || res.seen[k].good !== undefined);
  if (expect === null) {
    assert.deepEqual(lit, [], `NOTHING MAY PLAY HERE: ${where} lit key ${lit.map(lbl).join(' and ')}`);
    assert.equal(text, before, `NOTHING MAY PLAY HERE: ${where} changed the feedback line to "${text}"`);
    return;
  }
  const passed = expect === target;
  const seen = res.seen[expect] || {};
  const evidence = passed ? seen.good !== undefined : seen.pressed !== undefined;
  // The next question comes 0.7 s after a right answer; input in between is lit but not judged, so wait for the new
  // question (a new <b> in the prompt) BEFORE judging or throwing.
  const nextQuestion = (ms) => page.waitFor("document.querySelector('#prompt b') !== null && document.querySelector('#prompt b') !== window.__q61Asked", ms);
  if (!evidence || lit.some((k) => k !== expect)) {
    if (passed) await nextQuestion(3000).catch(() => {});
    throw new Error(keyboardFailure(where, expect, passed, res));
  }
  if (passed) {
    await nextQuestion(6000);
    assert.match(text, passText(target, afterMiss), `${where}: the feedback for the right note${afterMiss ? ' after a miss' : ' first time'}: got "${text}"`);
  } else {
    const wanted = missText(expect, target);
    assert.equal(text, wanted, `${where}: the feedback for a wrong note: got "${text}", wanted "${wanted}"`);
  }
}

async function kitInput(page, ctx, { act, expect, what }) {
  const m = await reachable(page);
  const all = kitRects(m);
  const res = await observe(page, kitGroups(all), KIT_COLOURS, KIT_BUSY, act(m, all), expect === null ? undefined : [expect]);
  const where = `${ctx} (${what})`;
  assert.ok(res.inputs >= 1, `${where}: the page received no input at all`);
  const lit = Object.keys(res.seen).filter((id) => res.seen[id].flash !== undefined);
  if (expect === null) assert.deepEqual(lit, [], `NOTHING MAY PLAY HERE: ${where} flashed ${lit.join(' and ')}`);
  else assert.deepEqual(lit, [expect], `${where}: expected ${expect} got ${lit.length ? lit.join(' and ') : 'nothing flashed'}${stallNote(res, 160)}`);
  if (expect !== null) await page.audio.waitForRunning();
}

// Run every input, keep going after a miss (a failure's light is let go out first), report them all together.
async function collect(page, items, run) {
  const failures = [];
  for (const it of items) {
    try { await run(it); } catch (e) {
      if (String(e.message).includes(DISAGREE)) throw e;
      failures.push(e.message);
      await page.evaluate('new Promise((r) => setTimeout(r, 400))');
    }
  }
  assert.equal(failures.length, 0, `${failures.length} of ${items.length} input(s) failed:\n- ${failures.join('\n- ')}`);
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
async function viewState(page, size) {
  return page.evaluate(`(() => { const o = { scrollY, innerWidth, innerHeight, rects: {} }; for (const id of ${JSON.stringify(viewIds(size))}) { const b = document.getElementById(id).getBoundingClientRect(); if (b.width > 0 && b.height > 0) o.rects[id] = { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; } return o; })()`);
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
async function checkFit(page, size, instr, ctx) {
  const policy = size[instr];
  const v0 = await viewState(page, size);
  const { top, bottom } = spanOf(v0), span = bottom - top;
  const where = `${ctx}: window ${v0.innerWidth}x${v0.innerHeight}, ${rectText(v0)}, scrolled to ${v0.scrollY.toFixed(0)}`;
  if (policy === NO_SCROLL) {
    assert.ok(noScroll(v0), `NO_SCROLL expected but the set does not fit on the first screen: ${where}`);
    assert.equal(v0.scrollY, 0, `NO_SCROLL expected but the page is scrolled to ${v0.scrollY}`);
    return;
  }
  assert.ok(!noScroll(v0), `ONE_SCROLL expected but the set already fits on the first screen, so the README's "one scroll" is wrong: ${where}`);
  assert.ok(span <= v0.innerHeight + 0.5, `ONE_SCROLL expected but the set spans ${span.toFixed(1)} px, more than the ${v0.innerHeight} px window: ${where}`);
  const v1 = onScreen(v0) ? v0 : (await wheelTo(page, Math.floor(top)), await viewState(page, size));
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

// ---- T5/T6 ---------------------------------------------------------------------------
const keyAt = (rects, midi) => rects.keys.find((k) => k.midi === midi);
const BLACK_POINTS = [0, 3, 4];
async function keyboardTaps(page, ctx) {
  const m = await reachable(page);
  const rects = keyboardRects(m);
  const plan = [];
  for (const k of rects.keys.filter((x) => !x.black)) plan.push({ midi: k.midi, i: 0, expect: k.midi, label: 'lower body' });
  // BLACK_POINTS: the centre and the two points just outside the edges (the wall-time cut); round-robin over the black keys (every key's first point, then every key's second) so the next tap on the same key comes after its light is out
  for (const i of BLACK_POINTS) for (const k of rects.keys.filter((x) => x.black)) { const p = keyboardProbePoints(k)[i]; plan.push({ midi: k.midi, i, expect: p.midi, label: p.label }); }
  await collect(page, plan, (e) => keyboardInput(page, ctx, { expect: e.expect, what: `tap ${lbl(e.midi)} ${e.label}`, act: (mm, r) => aimVia(page, mm, keyboardProbePoints(keyAt(r, e.midi))[e.i]) }));
}
async function keyboardNothing(page, ctx) {
  const regions = keyboardRects(await reachable(page)).noHit.filter((r) => r.name !== 'overview strip');
  await collect(page, regions, (region) => keyboardInput(page, `${ctx} ${region.name}`, { expect: null, what: 'tap in the middle', act: (m, rects) => { const r = rects.noHit.find((x) => x.name === region.name).rect; return aimVia(page, m, { x: r.x + r.w / 2, y: r.y + r.h / 2 }); } }));
}
// The wall-time cut for the kit: the centre and the inside east and south edges (both axes), not all four inside edges.
const KIT_TAP_POINTS = ['centre', 'inside east edge', 'inside south edge'];
async function kitTaps(page, ctx) {
  const m = await reachable(page);
  const all = kitRects(m);
  const plan = all.flatMap((piece) => kitProbePoints(piece, all).map((pt, i) => ({ piece, pt, i }))).filter((e) => KIT_TAP_POINTS.includes(e.pt.label));
  // round-robin (every piece's first point, then every piece's second), so the next tap on a piece comes after its 160 ms flash is over
  await collect(page, plan.sort((a, b) => a.i - b.i), (e) => kitInput(page, `${ctx} ${e.piece.id}`, { expect: e.pt.id, what: `tap ${e.pt.label}`, act: (mm, a) => aimVia(page, mm, kitProbePoints(a.find((p) => p.id === e.piece.id), a)[e.i]) }));
}
async function kitNothing(page, ctx) {
  const m = await reachable(page);
  const all = kitRects(m);
  assert.ok(kitEmptyPoint(m).room > 5, `${ctx}: the empty-space point is at least 5 px clear of every piece`);
  const plan = [{ label: 'empty space', at: (mm) => kitEmptyPoint(mm) }];
  for (const piece of all) kitProbePoints(piece, all).forEach((pt, i) => { if (pt.id === null) plan.push({ label: `${piece.id} ${pt.label}`, at: (mm, a) => kitProbePoints(a.find((p) => p.id === piece.id), a)[i] }); });
  await collect(page, plan, (e) => kitInput(page, `${ctx}`, { expect: null, what: `tap ${e.label}`, act: (mm, a) => aimVia(page, mm, e.at(mm, a)) }));
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
    await sub(st, 'T5 first tap (a wrong key) shows the feedback card', async () => {
      before = await cvBox(page);
      const target = await readTarget(page);
      const wrong = [48, 50, 52].find((n) => n !== target);
      await keyboardInput(page, `${at} first tap`, { expect: wrong, what: `tap ${lbl(wrong)} lower body`, act: (mm, r) => aimVia(page, mm, keyboardProbePoints(keyAt(r, wrong))[0]) });
      assert.notEqual(await feedback(page), '', `${at}: the feedback line is empty after a wrong key`);
    });
    await sub(st, 'T2/T2c/T4 keyboard with the feedback showing, both themes', async () => {
      for (const theme of ['light', 'dark']) {
        await setTheme(page, theme);
        await checkFit(page, size, 'keyboard', `${at} keyboard, ${theme}, feedback showing`);
        await checkObjective(page, `${at} keyboard, ${theme}`);
        await checkNoSideways(page, `${at} keyboard, ${theme}`);
        assert.deepEqual(await cvBox(page), before, `${at} keyboard, ${theme}: the canvas moved when the feedback card appeared (a drawn target would move under the finger)`);
      }
      await setTheme(page, 'light');
    }, 'keyboard fit');
    await sub(st, 'T5 keyboard taps at the policy position', () => keyboardTaps(page, `${at} keyboard`));
    await sub(st, 'T6 keyboard gaps and label strips do nothing', () => keyboardNothing(page, `${at} keyboard`));
    await endSession(page, size, 'keyboard');

    // --- drum kit, idle ---
    await pickInstrument(page, 'drum-kit', 'Drum kit');
    await wheelTo(page, 0);
    await sub(st, 'kit idle: the helper agrees with the canvas', async () => { await checkKitGeometry(page, `${at} kit`, size.vp, false); }, 'kit agree');
    await sub(st, 'T1 kit targets, both themes', (x) => checkTargets(page, x, `${at} kit`, 'kit', false), 'kit targets');
    await sub(st, 'T5 kit taps (canvas scrolled into view)', async () => {
      const m = await settledMetrics(page);
      await wheelTo(page, Math.max(0, (await page.evaluate('scrollY')) + m.top + m.cssHeight / 2 - m.innerHeight / 2));
      await kitTaps(page, `${at} kit`);
    });
    await sub(st, 'T6 kit empty space and outside edges do nothing', () => kitNothing(page, `${at} kit`));

    // --- drum kit, in a bar ---
    await wheelTo(page, 0);
    await startSession(page);
    await sub(st, 'kit in a bar: the helper agrees with the canvas', async () => { await checkKitGeometry(page, `${at} kit in a bar`, size.vp, true); }, 'kit bar agree');
    await sub(st, 'T1 kit targets in a bar, both themes', (x) => checkTargets(page, x, `${at} kit in a bar`, 'kit', true), 'kit bar targets');
    // The in-bar taps (each piece's centre, flashes when tapped) are the first cut for the 120 s wall time; the in-bar layout is covered by T1 after its agreement check.
    await page.waitFor("document.getElementById('feedback').textContent.trim() !== ''", 20000);
    await sub(st, 'T2 kit fit with the feedback showing, both themes', async () => {
      for (const theme of ['light', 'dark']) {
        await setTheme(page, theme);
        await checkFit(page, size, 'kit', `${at} kit, ${theme}, feedback showing`);
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
  for (const s of SIZES) assert.ok(bullet.includes(readmeClause(s)), `the README bullet does not say "${readmeClause(s)}"`);
});

test('A06 phone sizes: a learner sees and plays the keyboard and kit, and sees what the app says', async (t) => {
  await withAcceptancePage(t, { initScript: PAGE_SCRIPT }, async (page) => {
    for (const size of SIZES) await runSize(t, page, size);
    await runDesktop(t, page);
  });
});
