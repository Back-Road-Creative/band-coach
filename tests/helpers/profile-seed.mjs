// Shared pieces of the two release-file song tests (acceptance-song-flow and
// acceptance-retention): the audio-clock MIDI rig and the click-by-box helper
// (one copy, so the two tests cannot drift apart), and a saved learner profile
// and virtual clock for the retention test. The profile and clock are SIMULATED
// boundaries, declared as such in that test's options.simulated: the app is
// handed a profile that already holds earlier days' rows and a clock that says
// a given number of hours have passed since them, then every visit's behaviour
// is read through real clicks. Rows are built here, never inside the app, and
// every one must pass the app's own validateEvent or building it throws.
import assert from 'node:assert/strict';
import { validateEvent } from '../../src/core/learning-events.js';

export const LAG_OK_MS = 60; // the rig's own delivery must be this close to the plan, or the try says nothing about the app
export const ATTEMPTS = 3; // tries when the RIG reports it could not deliver the plan on time (never when the app answers wrongly)
export const RIG_LABEL = 'AudioContext handle kept by a launch script (RIG_INIT): plays the fake keyboard on the app\'s own audio clock, changes nothing else';
// The declared launch script (listed in options.simulated). It changes nothing the app does: it only keeps a handle to
// the app's own AudioContext and plays the fake keyboard's notes against THAT clock. Sent from the test process, or on a
// wall-clock timer, a note rides a CDP round trip or a timer a busy machine delays by 200-300 ms, and the app judges notes
// by its audio clock. __bcArm runs before the real click on Your turn and notes the audio time of that click; __bcPlay
// waits until the app is listening (the count label reads 'Notes heard'), then sends each note when the audio clock says
// so, and reports how late the rig itself was.
export const RIG_INIT = `(function () {
  var Orig = window.AudioContext, made = [];
  if (!Orig) return;
  window.AudioContext = class extends Orig { constructor() { super(...arguments); made.push(this); } };
  var ctx = function () { var c = made[made.length - 1]; if (!c) throw new Error('the app has not made an AudioContext'); return c; };
  window.__bcArm = function () { var c = ctx(); window.__bcClickAt = null; document.addEventListener('click', function () { window.__bcClickAt = c.currentTime; }, { capture: true, once: true }); };
  window.__bcListening = function () { var root = document.querySelector('.panel-songs-practice'); return new Promise(function (resolve, reject) {
    var done = function () { return /^Notes heard/.test((root.querySelector('.panel-songs-count') || {}).textContent || ''); };
    var to = setTimeout(function () { reject(new Error('the count-in never ended')); }, 30000);
    if (done()) { clearTimeout(to); return resolve(); }
    var mo = new MutationObserver(function () { if (done()) { clearTimeout(to); mo.disconnect(); resolve(); } });
    mo.observe(root, { subtree: true, childList: true, characterData: true }); }); };
  // plays: [{ midi, atMs }] from the first beat; leadSec: click to first beat (null: the first beat is the moment listening begins).
  window.__bcPlay = function (plays, leadSec) { return window.__bcListening().then(function () { return new Promise(function (resolve) {
    var c = ctx(), origin = leadSec == null ? c.currentTime : window.__bcClickAt + leadSec, evs = [], i = 0, worst = 0;
    plays.forEach(function (p, k) { evs.push({ t: p.atMs, b: [0x90, p.midi, 100] }); evs.push({ t: Math.min(p.atMs + 120, plays[k + 1] ? plays[k + 1].atMs - 30 : Infinity), b: [0x80, p.midi, 0] }); });
    evs.sort(function (a, b) { return a.t - b.t; });
    var tick = function () { var now = (c.currentTime - origin) * 1000;
      while (i < evs.length && evs[i].t <= now) { worst = Math.max(worst, now - evs[i].t); window.__midiSend('p1', evs[i].b); i++; }
      if (i < evs.length) setTimeout(tick, 2); else resolve({ worstLagMs: Math.round(worst) }); };
    tick(); }); }); };
})();`;
// Where a person would aim at the button with this text inside `scope`: the centre of its box (scrolled into view, and not covered).
export async function clickByText(page, scope, text) {
  const at = await page.evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return null;
    b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
    return hit && (b === hit || b.contains(hit)) ? { x, y } : null; })()`);
  assert.ok(at, `a "${text}" button is on screen and not covered`);
  await page.click(at.x, at.y);
}

export const HOUR = 3600 * 1000;
// The virtual clock starts here (a fixed instant, so the seeded rows' `at` and
// every visit's "now" are exact sums, not a race against the wall clock).
export const SEED_T0 = Date.UTC(2026, 5, 1, 12, 0, 0);

let counter = 0;
// seedEvent({ deltaMs, skill, songId, ... }) -> a validated kbd song row at SEED_T0 + deltaMs.
export function seedEvent(fields) {
  const { deltaMs, ...rest } = fields;
  const row = { v: 1, id: 'seed-' + (counter++), at: SEED_T0 + deltaMs, instrument: 'kbd', source: 'song', assistance: 'none', dims: { onset: 'ok' }, unassessed: [], activeMs: 1000, ...rest };
  if (row.at < 1e12) throw new Error('seed row at ' + row.at + ' is below 1e12: the app rewrites it on load');
  const v = validateEvent(row);
  if (!v.ok) throw new Error('seed row is not a valid event: ' + v.errors.join('; '));
  return row;
}

const MARY = 'mary-had-a-little-lamb';
const ODE = 'ode-to-joy';
const whole = (songId, deltaMs) => seedEvent({ deltaMs, skill: 'whole:null', songId, input: 'midi' });
const rhythm = (deltaMs) => seedEvent({ deltaMs, skill: 'rhythm:0', songId: MARY, input: 'midi' });

// S1: Mary's whole piece played on a MIDI keyboard at T0 and again five minutes later, and one rhythm row at T0.
export const seedS1 = () => [whole(MARY, 0), whole(MARY, 5 * 60 * 1000), rhythm(0)];
// S2: S1 plus a Mary whole-piece row 24.5 h after the first (retention, no transfer yet).
export const seedS2 = () => [...seedS1(), whole(MARY, 24.5 * HOUR)];
// S3: S2 plus an Ode to Joy whole-piece row (transfer).
export const seedS3 = () => [...seedS2(), whole(ODE, 24.6 * HOUR)];
// S4: one rhythm row passed on its own with no `input` field and no MIDI row anywhere.
export const seedS4 = () => [seedEvent({ deltaMs: 0, skill: 'rhythm:0', songId: MARY })];

export const profileOf = (events) => ({ v: 1, mods: {}, sessions: [], events, prefs: { mod: 'kbd' } });

// profileScheduleInit(visits) -> one initScript string. visits[i] = { offsetMs, events? }:
// document number i (0-based, counted in window.name, which survives a reload; a counter
// this script wrote to localStorage at document creation was measured lost on about half
// the reloads, while the app's own later saves were not) sees Date.now() = SEED_T0 + offsetMs + the real time elapsed since the document
// started, and, when `events` is given, that profile written to 'bandcoach.v1' before the
// app boots (omitted = the app keeps whatever it saved). Runs in the top frame of a file: page only.
export function profileScheduleInit(visits) {
  return `(function () {
    if (window.top !== window || location.protocol !== 'file:') return;
    var visits = ${JSON.stringify(visits.map((v) => ({ offsetMs: v.offsetMs, profile: v.events ? profileOf(v.events) : null })))};
    var n = /^q4b2\\.visit=(\\d+)$/.test(window.name) ? Number(RegExp.$1) : 0;
    window.name = 'q4b2.visit=' + (n + 1);
    var v = visits[Math.min(n, visits.length - 1)];
    var base = ${SEED_T0} + v.offsetMs, started = Date.now();
    Date.now = function () { return base + (new Date().getTime() - started); };
    if (v.profile) localStorage.setItem('bandcoach.v1', JSON.stringify(v.profile));
  })();`;
}
