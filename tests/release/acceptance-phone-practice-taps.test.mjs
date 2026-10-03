// Acceptance scenario A06 at phone sizes, the taps half (the other half, acceptance-phone-practice.test.mjs, measures
// sizes and fit): a real finger aimed at where every key and kit piece is DRAWN, on the release file, launched the way
// a person's browser runs it (withAcceptancePage). Split out so each file keeps its own 120 s budget. The learner acts
// only through tap() and a mouse wheel; page.evaluate only OBSERVES (rects, canvas pixels, the feedback line). Never
// window.__coach (the release build has none).
//
//   T5  real taps at 320x568, 390x844, 844x390 and 640x400 CSS px (device scale factors 2, 3, 3, 2), after the least
//       scroll that brings the whole canvas on screen: every white key (lower body), every black key (its centre and
//       the two points just outside its edges: the wall-time cut), every kit piece when idle (its centre and all four
//       inside edges); the key or piece that lights is the one aimed at.
//   T6  negative control: taps on the gaps, label strips and empty space light nothing and leave the feedback as it was.
//
// The geometry comes from tests/helpers/instrument-geometry.mjs and is checked against what the canvas really drew
// BEFORE any tap, so a bug in it fails as "GEOMETRY HELPER DISAGREES WITH CANVAS" and stops that size, never as a
// hit-test failure. The pixel sampler, judges and agreement checks are a trimmed copy of
// acceptance-drawn-instruments.test.mjs (nothing there is exported), also copied into the sizes file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
} from '../helpers/instrument-geometry.mjs';

const SIZES = [
  { name: '320x568', vp: { width: 320, height: 568, mobile: true, deviceScaleFactor: 2 } },
  { name: '390x844', vp: { width: 390, height: 844, mobile: true, deviceScaleFactor: 3 } },
  { name: '844x390', vp: { width: 844, height: 390, mobile: true, deviceScaleFactor: 3 } },
  { name: '640x400', vp: { width: 640, height: 400, mobile: false, deviceScaleFactor: 2 } },
];

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
  var inputs = [], actedAt = null;
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
    // The 700 ms wait for a tap's input runs from when the driver says the tap was sent (acted), not from when recording began: a slow driver on a loaded box must not read as a tap the page never got.
    acted: function () { actedAt = performance.now(); },
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
      actedAt = null;
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
          if ((inputAt !== null && after >= 3 && at - begin >= 30) || (actedAt !== null && at - actedAt >= 700) || at - begin >= 30000) return { seen: seen, inputAt: inputAt, inputs: inputs.length - base, frames: after, maxGap: gap, masked: spec.groups.filter(function (g) { return !armed[g.id]; }).map(function (g) { return g.id; }) };
        }
      })();
      return { quiet: true, waited: waited };
    },
  };
})();`;

// ---- Driving and observing ----------------------------------------------------
const raf = (page) => page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
const feedback = (page) => page.evaluate("document.getElementById('feedback').textContent.trim()");

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
  await page.evaluate('window.__q61.acted()');
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
async function kitTaps(page, ctx) {
  const m = await reachable(page);
  const all = kitRects(m);
  // every piece at every one of its probe points that must hit it (its centre and the four inside edges)
  const plan = all.flatMap((piece) => kitProbePoints(piece, all).map((pt, i) => ({ piece, pt, i }))).filter((e) => e.pt.id !== null);
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

// A person's scroll: the least one that brings the whole canvas on screen (none if it already is).
async function showCanvas(page) {
  const m = await settledMetrics(page);
  if (m.top >= 0 && m.top + m.cssHeight <= m.innerHeight) return;
  await wheelTo(page, (await page.evaluate('scrollY')) + m.top - Math.max(0, (m.innerHeight - m.cssHeight) / 2));
}

// ---- One size ---------------------------------------------------------------------------
async function runSize(t, page, size) {
  const ctx = { stop: false }, at = size.name;
  const sub = (st, name, fn) => st.test(`${at} ${name}`, async () => {
    assert.ok(!ctx.stop, 'stopped: the geometry helper disagrees with the canvas at this size, so no tap is aimed');
    try { await fn(); } catch (e) { if (String(e.message).includes(DISAGREE)) ctx.stop = true; throw e; }
  });
  const open = async (mod, name) => { await page.setViewport(size.vp); await page.reload(); await page.waitFor("document.getElementById('playBtn') !== null"); await raf(page); await pickInstrument(page, mod, name); };
  await t.test(`${at}@${size.vp.deviceScaleFactor}`, async (st) => {
    await open('kbd', 'Keyboard');
    await sub(st, 'keyboard idle: the helper agrees with the canvas', () => checkKeyboardGeometry(page, `${at} keyboard`, size.vp));
    await startSession(page);
    await showCanvas(page);
    await sub(st, 'T5 keyboard taps', () => keyboardTaps(page, `${at} keyboard`));
    await sub(st, 'T6 keyboard gaps and label strips do nothing', () => keyboardNothing(page, `${at} keyboard`));
    await open('drum-kit', 'Drum kit');
    await sub(st, 'kit idle: the helper agrees with the canvas', () => checkKitGeometry(page, `${at} kit`, size.vp, false));
    await showCanvas(page);
    await sub(st, 'T5 kit taps', () => kitTaps(page, `${at} kit`));
    await sub(st, 'T6 kit empty space and outside edges do nothing', () => kitNothing(page, `${at} kit`));
    assert.deepEqual(page.exceptions, [], `${at}: no uncaught exceptions`);
  });
}

test('A06 phone sizes, taps: every key and kit piece plays when tapped where it is drawn, and nothing else does', async (t) => {
  await withAcceptancePage(t, { initScript: PAGE_SCRIPT }, async (page) => {
    for (const size of SIZES) await runSize(t, page, size);
  });
});
