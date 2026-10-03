// Acceptance scenario A06 (desktop sizes): the keyboard and the drum kit are
// pixels on one canvas, with no buttons to click, so the only way to know a
// learner can play them is to aim a real mouse, finger and computer key at
// where they are DRAWN and see what the page does. The release file, launched
// the way a person's browser runs it (withAcceptancePage); the learner acts only
// through clickSelector/click/tap/press. page.evaluate only OBSERVES: canvas
// pixels, the text the canvas drew, the feedback line. Never window.__coach.
//
// Why not the older tests: they ask the app's debug hook where its keys are
// (window.__coach.kbdKeys(), kitBox()), so a hit-test and a drawing that drift
// apart pass together. Here the geometry comes from tests/helpers/
// instrument-geometry.mjs (the draw formulas written out again), and test 1
// checks it against what the canvas really drew BEFORE any click: a bug in the
// helper fails as "GEOMETRY HELPER DISAGREES WITH CANVAS", never as a hit-test
// failure.
//
// Viewports: 1280x800 at device scale factor 1 and 2, and 1024x640 at 1. One
// page per viewport; the instrument is switched inside it. 1024x640 runs tests 1
// and 2 only. A step that fails does not stop the later steps: every failure is
// reported together, each named "<viewport> test N ...". A helper disagreement
// is the exception: it stops the viewport before any click.
//
// Probed on the real build before writing (these shaped the test):
// - A fresh profile shows no first-visit card, variant group or mic prompt in the
//   way: #picker is open (aria-expanded true) and #picker button[data-mod="kbd"]
//   / ="drum-kit" are the controls. The picker is read first and #navInstrument
//   is clicked only if it is closed.
// - 24 wrong keys in a row do not end the task: the keyboard keeps asking for the
//   same note and says what was played and where the note is. The target is
//   clicked last.
// - Chrome delivers tap() as pointerdown with pointerType "touch" without touch
//   emulation, once, so no Emulation call is made.
// - press() sends a keydown whose ev.key is the key named, including "A" with
//   Shift and with no text, so no { text } is passed.
// - A question is one note. A right answer flashes the key green for 300 ms, and the
//   next question (a new <b> in #prompt) comes 0.7 s later, 1.5 s after a wrong
//   answer; keys played in between light but are not judged, so every pass waits
//   for the new question before the next input.
// - Test 10 (a judged kit bar) is dropped, after the probe the plan asks for: three
//   tries, no loop, no retry. One drum at a time, level 1: a 3.9 s count-in (the piece
//   asked for shows orange), then four quarter notes at 66 bpm, each judged within
//   150 ms of its beat. Real clicks were aimed at the piece from the moment the orange
//   went out, and the bar came back "1 missed, 1 extra hit" (try 1), "2 missed, 2 extra
//   hits" (try 2) and "1 missed, 1 extra hit" (try 3): the first click landed 215 ms
//   after its beat (page clock, pointerdown against the count-in's end), 82, 11 and 43
//   ms for the rest, on a box at load average 25-27 on 12 cores, where one DevTools
//   round trip is the same size as the window. No click can be placed inside a 150 ms
//   window from outside the page on a loaded machine, so a green mark under each note
//   would pass or fail with the load, not with the app. Logs: bc-logs/q3c/
//   probe-t10-m1-1.log, -2.log, -3.log. The bar also costs about 8 s of a 75 s budget.
//
// An in-page sampler reads the canvas's own pixels every animation frame around
// each action. Before it, the key (or piece) the action must reach has to be
// quiet (not lit pressed or passed, not flashing; at most 400 ms), and anything else
// still lit from the PREVIOUS click is credited only once it has gone out and lit
// again, so a previous click is never credited to this one; an action that must do
// nothing waits for the whole instrument to be quiet. (Waiting for everything after
// every click would cost 0.2 s a click, about 400 clicks over the file, and the
// 75 s budget.) The key and piece colours are the draw code's (src/app.js drawKeys,
// drawKit), written out as literals below, never imported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage, VIEWPORTS } from '../helpers/browser.mjs';
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

// ---- What a learner sees: literals, never read from src/** ------------------
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const nm = (m) => NAMES[((m % 12) + 12) % 12];
const lbl = (m) => `${m} (${nm(m)})`;
// Drawn names: white keys only, the octave on C (drawKeys).
const WHITE_NAMES = { 48: 'C3', 50: 'D', 52: 'E', 53: 'F', 55: 'G', 57: 'A', 59: 'B', 60: 'C4', 62: 'D', 64: 'E', 65: 'F', 67: 'G', 69: 'A', 71: 'B', 72: 'C5' };
// The help text (kbd.help): a-k play C4 up to C5, sharps included; z-m play C3 up to B3, naturals.
const COMPUTER_KEYS = { a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, u: 70, j: 71, k: 72, z: 48, x: 50, c: 52, v: 53, b: 55, n: 57, m: 59 };
const LEVEL1_TARGET = { C: 60, D: 62, E: 64 };
// Drawn kit shapes (drawKit fills). Test 1 checks the key letter drawn on each piece against the literal KIT_LETTERS below
// (the spec's own letters, from the PIECES list in src/instruments/drum-kit.js:33-42@708aef7), so a changed letter fails test 1 first.
// Test 9 presses the letter it reads off the canvas, so it proves the pressed key reaches the piece drawn with that letter.
const KIT_LETTERS = { kick: 'F', snare: 'J', 'hihat-closed': 'D', 'hihat-pedal': 'C', 'hihat-open': 'E', 'tom-floor': 'K', 'tom-mid': 'I', 'tom-high': 'U', crash: 'R', ride: 'O' };
const KIT_SHAPE = { kick: 'drum', snare: 'drum', 'hihat-closed': 'cymbal', 'hihat-pedal': 'drum', 'hihat-open': 'cymbal', 'tom-floor': 'drum', 'tom-mid': 'drum', 'tom-high': 'drum', crash: 'cymbal', ride: 'cymbal' };
const HEX = { white: '#e9edf6', black: '#10131c', pressed: '#9fb4d8', good: '#5be08a', flash: '#f3c52f', cymbal: '#2a3140', drum: '#1b2130' };
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const KEY_COLOURS = { pressed: rgb(HEX.pressed), good: rgb(HEX.good) };
const COLOUR_NAME = { pressed: `pressed (${HEX.pressed})`, good: `passed (${HEX.good})` };
const KEY_BUSY = [rgb(HEX.pressed), rgb(HEX.good)];
const KIT_COLOURS = { flash: rgb(HEX.flash) };
const KIT_BUSY = [rgb(HEX.flash)];

// ---- Page side: a text recorder and a pixel sampler (observation only) -----
// The recorder keeps what the canvas drew THIS frame (text, where, alignment),
// reset on each clearRect, like the gate test's. The sampler reads the canvas's
// pixels each animation frame; it never touches the app's state.
const PAGE_SCRIPT = `(function () {
  var proto = CanvasRenderingContext2D.prototype, fillText = proto.fillText, clearRect = proto.clearRect;
  window.__q3cText = [];
  proto.clearRect = function () { if (this.canvas && this.canvas.id === 'cv') window.__q3cText = []; return clearRect.apply(this, arguments); };
  proto.fillText = function (text, x, y) {
    if (this.canvas && this.canvas.id === 'cv') { var m = this.getTransform(); window.__q3cText.push({ text: String(text), x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f, align: this.textAlign }); }
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
  window.__q3c = {
    texts: async function () { await frame(); await frame(); return window.__q3cText.slice(); },
    px: async function (pts) { await frame(); await frame(); var img = snap(); return pts.map(function (p) { return read(img, p); }); },
    // Wait for quiet, then start recording; the recording's promise is left on
    // window.__q3cSample for a second evaluate to await after the action. Quiet means no
    // group in spec.quietIds (default: all) is lit pressed/passed/flashing. A group that is
    // lit when recording starts but is not in quietIds is only credited once it has gone
    // unlit and lit again, so the PREVIOUS click's lit key is never credited to this click; one
    // that stays lit the whole recording comes back as "masked": a hit on it could not be seen.
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
      window.__q3cSample = (async function () {
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

// ---- Driving and observing -------------------------------------------------
const feedback = (page) => page.evaluate("document.getElementById('feedback').textContent.trim()");

async function readTarget(page) {
  await page.waitFor("document.querySelector('#prompt b') !== null");
  const t = await page.evaluate("document.querySelector('#prompt b').textContent.trim()");
  if (LEVEL1_TARGET[t] === undefined) throw new Error(`the level 1 prompt names "${t}", not C, D or E`);
  return LEVEL1_TARGET[t];
}

async function observe(page, groups, colours, busy, action, quietIds) {
  const q = await page.evaluate(`window.__q3c.start(${JSON.stringify({ groups, colours, busy, quietMs: 400, quietIds })})`);
  if (!q.quiet) throw new Error(`the previous input was still lit after ${Math.round(q.waited)} ms, so this one cannot be told apart from it`);
  await action();
  return page.evaluate('window.__q3cSample');
}

// The canvas's box on screen, read once the app has caught its drawing buffer up
// with it (size() resizes the buffer on the next frame after a layout change, so
// a read straight after picking an instrument or resizing can mix old and new).
async function settledMetrics(page) {
  for (let i = 0; i < 40; i++) {
    const m = await canvasMetrics(page);
    const d = Math.min(m.devicePixelRatio, 2);
    if (m.width === Math.round(m.cssWidth * d) && m.height === Math.round(m.cssHeight * d)) return m;
    await page.evaluate('new Promise((r) => requestAnimationFrame(() => r()))');
  }
  throw new Error('the canvas drawing buffer never matched its box on screen');
}

// ... and a refusal if a person could not reach all of it (no scrolling is done
// for them here; the kit's box is taller than the keyboard's, so a short window can need it).
async function reachable(page) {
  const m = await settledMetrics(page);
  const inside = m.left >= 0 && m.top >= 0 && m.left + m.cssWidth <= m.innerWidth && m.top + m.cssHeight <= m.innerHeight;
  assert.ok(inside, `the canvas is not fully on screen: left ${m.left}, top ${m.top}, ${m.cssWidth}x${m.cssHeight} in a ${m.innerWidth}x${m.innerHeight} window`);
  return m;
}

const keyGroups = (rects) => rects.keys.map((k) => { const pts = keyboardSamplePoints(k); return { id: k.midi, pts, need: pts.length }; });
const kitGroups = (all) => all.map((p) => ({ id: p.id, pts: kitSamplePoints(p), need: 5 }));

// The pointer/finger/key action the learner makes.
const aimVia = (page, via, m, pt) => {
  const c = toClient(pt, m);
  return via === 'tap' ? () => page.tap(c.x, c.y) : () => page.click(c.x, c.y);
};

// What the app must say about a key that was played with the target T.
function missText(clicked, target) {
  const st = clicked - target, n = Math.abs(st);
  const where = n === 12 ? `Right note, wrong octave: go one octave ${st > 0 ? 'down' : 'up'}.` : `Go ${n} key${n > 1 ? 's' : ''} to the ${st > 0 ? 'left' : 'right'}.`;
  return `That was ${nm(clicked)}, the note is ${nm(target)}. ${where}`;
}
// First try: "<T>: yes, in N s."; after a miss on the same question: "That is the one. <T>." (passEl :1137).
const passText = (target, afterMiss) => (afterMiss ? new RegExp(`^That is the one\\. ${nm(target)}\\.$`) : new RegExp(`^${nm(target)}: yes, in [0-9.]+ s\\.$`));

// A miss does not end the question, so the pass that follows must read "That is the one." The feedback line
// before the input says whether this question has had a miss ("That was <X>, the note is <Y>. ..."), read
// from the page, so one failed input never changes how the next ones are judged.
const afterMissLine = (before) => before.startsWith('That was ');

// A light lasts 220 ms (key) or 160 ms (piece); a page that stalls longer between two frames cannot show it,
// so a failure says so rather than blaming the app.
const stallNote = (res, pulse) => (res.maxGap > pulse * 0.6 ? `; the page went ${Math.round(res.maxGap)} ms between two frames while it was watched, so a ${pulse} ms light could have been missed` : '');

// What a failed keyboard input looked like, in the learner's terms: the key wanted and every
// key that lit (with the colour it lit), and the keys that could not be watched.
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

// One keyboard input and everything the learner would notice. `expect` is the
// MIDI number that must be delivered, or null for "nothing may play here".
async function keyboardInput(page, ctx, { act, expect, what }) {
  const target = await readTarget(page);
  const before = await feedback(page);
  const afterMiss = afterMissLine(before);
  await page.evaluate("window.__q3cAsked = document.querySelector('#prompt b')");
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
  // The task is done when the target was played; the next question comes 0.7 s later (1.5 s after a
  // wrong note). Input in between is lit but not judged, so wait for the new question (a new <b> in
  // the prompt) BEFORE judging or throwing: a failure then belongs to this input only, never to the
  // later ones that start on a question already over. On a failed light check the question may not
  // have ended at all, so that wait is shorter and its timeout is ignored.
  const nextQuestion = (ms) => page.waitFor("document.querySelector('#prompt b') !== null && document.querySelector('#prompt b') !== window.__q3cAsked", ms);
  if (!evidence || lit.some((k) => k !== expect)) {
    if (passed) await nextQuestion(3000).catch(() => {});
    throw new Error(keyboardFailure(where, expect, passed, res));
  }
  if (passed) {
    await nextQuestion(6000);
    assert.match(text, passText(target, afterMiss), `${where}: the feedback for the right note${afterMiss ? ' after a miss' : ' first time'}: got "${text}", wanted ${afterMiss ? `"That is the one. ${nm(target)}."` : `"${nm(target)}: yes, in <seconds> s."`}`);
  } else {
    const wanted = missText(expect, target);
    assert.equal(text, wanted, `${where}: the feedback for a wrong note: got "${text}", wanted "${wanted}"`);
  }
}

const keyAt = (rects, midi) => rects.keys.find((k) => k.midi === midi);
const clickKey = (page, ctx, midi, pointIndex = 0, via = 'click') =>
  keyboardInput(page, ctx, {
    expect: midi,
    what: `${via} on ${lbl(midi)}`,
    act: (m, rects) => aimVia(page, via, m, keyboardProbePoints(keyAt(rects, midi))[pointIndex]),
  });

// ---- Test 1: the helper agrees with the canvas ------------------------------
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
  const texts = await page.evaluate('window.__q3c.texts()');
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
  const got = await page.evaluate(`window.__q3c.px(${JSON.stringify(pts.map(({ x, y }) => ({ x, y })))})`);
  pts.forEach((p, i) => {
    const want = p.k.black ? HEX.black : HEX.white;
    if (!colourOk(got[i], want)) disagree(`${p.k.black ? 'black' : 'white'} key ${lbl(p.k.midi)} sample (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) reads ${rgbText(got[i])}, not ${want}`);
  });
}

async function checkKitGeometry(page, ctx, vp) {
  const m = await settledMetrics(page);
  assert.equal(m.devicePixelRatio, vp.deviceScaleFactor, `${ctx}: the device scale factor took effect`);
  const all = kitRects(m);
  const texts = await page.evaluate('window.__q3c.texts()');
  for (const p of all) {
    const letter = KIT_LETTERS[p.id];
    const drawn = texts.find((t) => t.text === letter && near1(t.x, p.cx) && t.y >= p.cy - p.r && t.y <= p.cy + p.r);
    if (!drawn) disagree(`${p.id}: its key letter "${letter}" was not drawn within 1 px of x ${p.cx.toFixed(1)} and inside y ${(p.cy - p.r).toFixed(1)}-${(p.cy + p.r).toFixed(1)}${texts.some((t) => /^[A-Z]$/.test(t.text) && near1(t.x, p.cx) && t.y >= p.cy - p.r && t.y <= p.cy + p.r) ? ` (a different letter is drawn there)` : ''}`);
  }
  const pts = all.flatMap((p) => kitSamplePoints(p).map((s) => ({ ...s, p })));
  const got = await page.evaluate(`window.__q3c.px(${JSON.stringify(pts.map(({ x, y }) => ({ x, y })))})`);
  for (const p of all) {
    const want = HEX[KIT_SHAPE[p.id]];
    const mine = pts.map((s, i) => ({ s, c: got[i] })).filter((e) => e.s.p === p);
    const ok = mine.filter((e) => colourOk(e.c, want)).length;
    if (ok < 5) disagree(`${p.id}: only ${ok} of 8 sample points inside its circle read ${want} (first reads ${rgbText(mine[0].c)})`);
  }
}

// ---- Navigation, the way a learner does it ----------------------------------
async function pickInstrument(page, mod, name) {
  if (await page.evaluate("document.getElementById('picker').hidden")) await page.clickSelector('#navInstrument');
  const button = `#picker button[data-mod="${mod}"]`;
  const text = await page.evaluate(`document.querySelector(${JSON.stringify(button)}).textContent`);
  assert.ok(text.startsWith(name), `the picker button for ${mod} reads "${text}", not "${name}..."`);
  await page.clickSelector(button);
  assert.equal(await page.evaluate("document.querySelector('#picker button[aria-pressed=\"true\"]').dataset.mod"), mod, `${name} is the pressed instrument`);
  await page.waitFor(`document.getElementById('navInstrument').textContent.includes(${JSON.stringify(name)})`);
}

async function startSession(page) {
  await page.clickSelector('#playBtn');
  await page.waitFor("document.getElementById('playBtn').textContent.trim() === 'Pause'");
  await page.waitFor("document.querySelector('#prompt b') !== null");
}

// ---- Keyboard tests ---------------------------------------------------------
// Test 2: every key, by mouse, the target last.
async function keyboardEveryKey(page, ctx) {
  const target = await readTarget(page);
  const rects = keyboardRects(await reachable(page));
  const order = [...rects.keys.map((k) => k.midi).filter((n) => n !== target), target];
  for (const midi of order) await clickKey(page, `${ctx} test 2`, midi);
}

// Test 3: both sides of every black key's edge. Round-robin over the black keys (every
// key's first point, then every key's second), so the next click on the same key comes
// after its 220 ms light is out and never waits for it.
async function blackKeyBoundaries(page, ctx) {
  const rects = keyboardRects(await reachable(page));
  const blacks = rects.keys.filter((k) => k.black);
  for (let i = 1; i < 5; i++) { // point 0 is the centre: test 2 has it
    for (const black of blacks) {
      const point = keyboardProbePoints(black)[i];
      await keyboardInput(page, `${ctx} test 3 black key ${lbl(black.midi)}`, {
        expect: point.midi,
        what: `click ${point.label}`,
        act: (m, r) => aimVia(page, 'click', m, keyboardProbePoints(keyAt(r, black.midi))[i]),
      });
    }
  }
  // the white key under each black one, by its own lower body
  for (const black of blacks) await clickKey(page, `${ctx} test 3 black key ${lbl(black.midi)}`, black.midi - 1);
}

// Test 4: the two rows, and the places in between that must do nothing.
async function handRows(page, ctx) {
  const target = await readTarget(page);
  await clickKey(page, `${ctx} test 4 lower row`, target - 12); // right note, wrong octave
  for (const midi of [48, 60, 55, 67]) await clickKey(page, `${ctx} test 4 same note in both rows`, midi);
  await clickKey(page, `${ctx} test 4`, await readTarget(page)); // the target itself passes
  const regions = keyboardRects(await reachable(page)).noHit;
  for (const region of regions) {
    await keyboardInput(page, `${ctx} test 4 ${region.name}`, {
      expect: null,
      what: 'click in the middle',
      act: (m, rects) => {
        const r = rects.noHit.find((x) => x.name === region.name).rect;
        return aimVia(page, 'click', m, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
      },
    });
  }
}

// Test 5: the same, with a finger. [key aimed at, probe point, what is delivered, what it is]
async function keyboardTouch(page, ctx) {
  for (const [midi, i, expect, what] of [[55, 0, 55, 'white key, lower row'], [67, 0, 67, 'white key, upper row'], [66, 0, 66, 'black key'], [58, 4, 59, 'just outside a black key (its white neighbour)']]) {
    await keyboardInput(page, `${ctx} test 5 ${what}`, {
      expect,
      what: `tap ${lbl(midi)} point ${i}`,
      act: (m, rects) => aimVia(page, 'tap', m, keyboardProbePoints(keyAt(rects, midi))[i]),
    });
  }
}

// Test 6: computer keys.
async function computerKeys(page, ctx) {
  for (const upper of [false, true]) {
    for (const [letter, midi] of Object.entries(COMPUTER_KEYS)) {
      const key = upper ? letter.toUpperCase() : letter;
      await keyboardInput(page, `${ctx} test 6 key ${key}`, {
        expect: midi,
        what: `press ${key}${upper ? ' with Shift' : ''}`,
        act: () => () => page.press(key, upper ? { modifiers: 8 } : {}),
      });
    }
  }
  for (const key of ['q', '1']) {
    await keyboardInput(page, `${ctx} test 6 key ${key}`, { expect: null, what: `press ${key}`, act: () => () => page.press(key) });
  }
}

// ---- Kit tests --------------------------------------------------------------
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

// Test 7: every piece, by mouse. The points that must do nothing (outside every piece, and
// empty space) go first, while nothing is flashing, so each can wait for a fully quiet kit
// without the 160 ms flash of an earlier click; then each piece's own points.
async function kitEveryPiece(page, ctx) {
  const m = await reachable(page);
  const all = kitRects(m);
  const aim = (piece, i) => (mm, a) => aimVia(page, 'click', mm, kitProbePoints(a.find((p) => p.id === piece.id), a)[i]);
  const plan = all.flatMap((piece) => kitProbePoints(piece, all).map((pt, i) => ({ piece, pt, i })));
  assert.ok(kitEmptyPoint(m).room > 5, `${ctx}: the empty-space point is at least 5 px clear of every piece`);
  await kitInput(page, `${ctx} test 7`, { expect: null, what: 'click in empty space', act: (mm) => aimVia(page, 'click', mm, kitEmptyPoint(mm)) });
  for (const { piece, pt, i } of plan.filter((e) => e.pt.id === null)) await kitInput(page, `${ctx} test 7 ${piece.id}`, { expect: null, what: `click ${pt.label}`, act: aim(piece, i) });
  // round-robin (every piece's first point, then every piece's second), so the next click on
  // a piece comes after its 160 ms flash is over and never waits for it
  for (const { piece, pt, i } of plan.filter((e) => e.pt.id !== null).sort((a, b) => a.i - b.i)) await kitInput(page, `${ctx} test 7 ${piece.id}`, { expect: pt.id, what: `click ${pt.label}`, act: aim(piece, i) });
}

// Test 8: by finger.
async function kitTouch(page, ctx) {
  const m = await reachable(page);
  const all = kitRects(m);
  for (const id of ['snare', 'hihat-closed', 'hihat-pedal']) {
    const piece = all.find((p) => p.id === id);
    for (const label of ['centre', 'inside east edge', 'outside west edge']) {
      const point = kitProbePoints(piece, all).find((p) => p.label === label);
      assert.ok(point, `${ctx}: ${id} has a ${label} point that is not inside another piece`);
      await kitInput(page, `${ctx} test 8 ${id}`, {
        expect: point.id,
        what: `tap ${label}`,
        act: (mm, a) => aimVia(page, 'tap', mm, kitProbePoints(a.find((p) => p.id === id), a).find((p) => p.label === label)),
      });
    }
  }
}

// Test 9: the letter drawn on each piece, pressed.
async function kitComputerKeys(page, ctx) {
  const all = kitRects(await reachable(page));
  const texts = await page.evaluate('window.__q3c.texts()');
  for (const piece of all) {
    const drawn = texts.find((t) => /^[A-Z]$/.test(t.text) && near1(t.x, piece.cx) && t.y >= piece.cy - piece.r && t.y <= piece.cy + piece.r);
    assert.ok(drawn, `${ctx} test 9: no letter is drawn on ${piece.id}`);
    await kitInput(page, `${ctx} test 9 ${piece.id}`, { expect: piece.id, what: `press ${drawn.text.toLowerCase()} (the letter drawn on it)`, act: () => () => page.press(drawn.text.toLowerCase()) });
  }
}

// ---- One page per viewport --------------------------------------------------
async function playViewport(t, vp, { full }) {
  const ctx = `${vp.width}x${vp.height}@${vp.deviceScaleFactor}`;
  await withAcceptancePage(t, { initScript: PAGE_SCRIPT }, async (page) => {
    await page.setViewport(vp);
    const failures = [];
    const step = async (name, fn) => {
      const began = Date.now();
      try {
        await fn();
        t.diagnostic(`${ctx} ${name}: ${Date.now() - began} ms`);
      } catch (e) {
        if (String(e.message).includes(DISAGREE)) throw e; // the helper is wrong: no click may follow
        failures.push(`${ctx} ${name}: ${e.message}`);
        await page.evaluate('new Promise((r) => setTimeout(r, 400))'); // let what it lit go out before the next step
      }
    };
    // Test 1, before any click: both instruments, idle.
    await pickInstrument(page, 'drum-kit', 'Drum kit');
    await checkKitGeometry(page, `${ctx} test 1 kit`, vp);
    await pickInstrument(page, 'kbd', 'Keyboard');
    await checkKeyboardGeometry(page, `${ctx} test 1 keyboard`, vp);

    if (full) {
      await pickInstrument(page, 'drum-kit', 'Drum kit');
      await step('test 7 (kit, mouse)', () => kitEveryPiece(page, ctx));
      await step('test 8 (kit, touch)', () => kitTouch(page, ctx));
      await step('test 9 (kit, computer keys)', () => kitComputerKeys(page, ctx));
      await pickInstrument(page, 'kbd', 'Keyboard');
    }
    await startSession(page);
    await step('test 2 (keyboard, mouse, every key)', () => keyboardEveryKey(page, ctx));
    if (full) {
      await step('test 3 (black-key boundaries)', () => blackKeyBoundaries(page, ctx));
      await step('test 4 (hand rows and dead zones)', () => handRows(page, ctx));
      await step('test 5 (keyboard, touch)', () => keyboardTouch(page, ctx));
      await step('test 6 (keyboard, computer keys)', () => computerKeys(page, ctx));
    }
    assert.deepEqual(page.exceptions, [], `${ctx}: no uncaught exceptions`);
    assert.equal(failures.length, 0, `${failures.length} step(s) failed:\n- ${failures.join('\n- ')}`);
  });
}

test('A06 desktop 1280x800: a learner plays the drawn keyboard and kit with mouse, finger and computer keys', async (t) => {
  await playViewport(t, { ...VIEWPORTS.desktop, deviceScaleFactor: 1 }, { full: true });
});

test('A06 desktop 1280x800 at device scale 2: the same, on a sharp screen', async (t) => {
  await playViewport(t, { ...VIEWPORTS.desktop, deviceScaleFactor: 2 }, { full: true });
});

test('A06 desktop 1024x640: the keyboard and kit are where they are drawn, and every key answers a click', async (t) => {
  await playViewport(t, { width: 1024, height: 640, mobile: false, deviceScaleFactor: 1 }, { full: false });
});
