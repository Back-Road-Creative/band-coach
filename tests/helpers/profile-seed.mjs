// A saved learner profile and a virtual clock for the release-file retention
// test (tests/release/acceptance-retention.test.mjs). Both are SIMULATED
// boundaries, declared as such in that test's options.simulated: the app is
// handed a profile that already holds earlier days' rows and a clock that says
// a given number of hours have passed since them, then every visit's behaviour
// is read through real clicks. Rows are built here, never inside the app, and
// every one must pass the app's own validateEvent or building it throws.
import { validateEvent } from '../../src/core/learning-events.js';

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
