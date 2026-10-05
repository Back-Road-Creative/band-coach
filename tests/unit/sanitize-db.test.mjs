// src/core/sanitize-db.js: the one gate between a stored or restored profile
// and the running app, driven here with a few fake instrument tables and no
// browser. The inherited-key cases are the regression this module was
// extracted to pin: a plain-object lookup such as MODS[p.mod] is truthy for
// 'constructor', 'toString' or '__proto__', so a hand-edited backup could make
// the app boot on Object's own constructor. The seeded sweep then feeds it
// garbage shapes and asserts it never throws and always returns the full prefs
// shape, which is also stable under a second pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDB } from '../../src/core/sanitize-db.js';
import { sanitizePanelData } from '../../src/ui/panels.js';
import { EVENT_VERSION, EVENT_HISTORY_MAX } from '../../src/core/learning-events.js';

const MODS = { kbd: {}, gtr: {}, voice: {}, harp: {} };
const deps = {
  MODS,
  MOD_IDS: Object.keys(MODS),
  WIND_KINDS: { c: [], bb: [], eb: [] },
  VOICE_KINDS: { low: [], mid: [], high: [] },
  LOCALES: [{ code: 'en' }, { code: 'es' }],
  NOTATE_MOD_IDS: ['kbd', 'gtr', 'voice'],
  sanitizeModel: (m) => ({ m }),
  sanitizePanelData,
  skillMap: {},
};
const run = (v) => sanitizeDB(v, 12, 1.7e12, deps);
const INHERITED = ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__', 'isPrototypeOf', '__defineGetter__'];
const PREF_KEYS = ['mod', 'wind', 'voice', 'kbdHands', 'sessionMinutes', 'names', 'noiseFloor', 'noiseFloorV', 'inputDeviceId', 'notate', 'theme', 'locale', 'noteNaming', 'voiceRange', 'harpKey'];

test('an inherited key is not an instrument, a wind kind or a voice', () => {
  for (const k of INHERITED) {
    const d = run(JSON.parse(`{"prefs":{"mod":"${k}","wind":"${k}","voice":"${k}"}}`));
    assert.equal(d.prefs.mod, 'kbd', `mod ${k}`);
    assert.equal(d.prefs.wind, 'bb', `wind ${k}`);
    assert.equal(d.prefs.voice, 'low', `voice ${k}`);
    assert.equal(typeof d.prefs.mod, 'string');
  }
});

test('an inherited key is not a session row instrument', () => {
  for (const k of INHERITED) {
    const d = run(JSON.parse(`{"sessions":[{"d":"2026-01-01","mod":"${k}"},{"d":"2026-01-02","mod":"gtr"}]}`));
    assert.deepEqual(d.sessions.map((s) => s.mod), ['gtr'], `session mod ${k}`);
  }
});

test('"mine" is only a valid voice when a voice range is saved', () => {
  assert.equal(run({ prefs: { voice: 'mine' } }).prefs.voice, 'low');
  assert.equal(run({ prefs: { voice: 'mine', voiceRange: { low: 48, high: 72 } } }).prefs.voice, 'mine');
  assert.equal(run({ prefs: { voice: 'constructor', voiceRange: { low: 48, high: 72 } } }).prefs.voice, 'low');
});

test('real values still pass through', () => {
  const d = run({ prefs: { mod: 'harp', wind: 'eb', voice: 'high', theme: 'dark', locale: 'es', kbdHands: 'left', sessionMinutes: 10, harpKey: 5, notate: { kbd: 'staff', gtr: 'both', voice: 'nope' } } });
  assert.equal(d.prefs.mod, 'harp');
  assert.equal(d.prefs.wind, 'eb');
  assert.equal(d.prefs.voice, 'high');
  assert.equal(d.prefs.theme, 'dark');
  assert.equal(d.prefs.locale, 'es');
  assert.equal(d.prefs.kbdHands, 'left');
  assert.equal(d.prefs.sessionMinutes, 10);
  assert.equal(d.prefs.harpKey, 5);
  assert.deepEqual(d.prefs.notate, { kbd: 'staff', gtr: 'both', voice: 'names' });
});

test('theme, locale, hands, session length and note naming fall back on unknown values', () => {
  const d = run({ prefs: { theme: 'purple', locale: 'xx', kbdHands: 'feet', sessionMinutes: '5', noteNaming: { system: 'x', accidentals: 'y' } } });
  assert.equal(d.prefs.theme, 'system');
  assert.equal(d.prefs.locale, 'en');
  assert.equal(d.prefs.kbdHands, 'both');
  assert.equal(d.prefs.sessionMinutes, null);
  assert.deepEqual(d.prefs.noteNaming, { system: 'letters', accidentals: 'mixed' });
  for (const k of INHERITED) {
    const e = run(JSON.parse(`{"prefs":{"theme":"${k}","locale":"${k}","kbdHands":"${k}","noteNaming":"${k}"}}`));
    assert.equal(e.prefs.theme, 'system');
    assert.equal(e.prefs.locale, 'en');
    assert.equal(e.prefs.kbdHands, 'both');
  }
});

test('a noise floor without the current room-check marker is dropped', () => {
  assert.equal(run({ prefs: { noiseFloor: 0.2 } }).prefs.noiseFloor, null);
  assert.equal(run({ prefs: { noiseFloor: 0.2, noiseFloorV: 2 } }).prefs.noiseFloor, 0.2);
  assert.equal(run({ prefs: { noiseFloorV: 2 } }).prefs.noiseFloorV, null);
});

test('an event row with a bad clock is repaired from the next real row, else the load time', () => {
  const ev = (id, at) => ({ v: EVENT_VERSION, id, at, instrument: 'kbd', skill: 's', source: 'drill', assistance: 'none', dims: {}, unassessed: [], activeMs: 1 });
  const d = run({ events: [ev('a', 5), ev('b', 1.5e12), ev('c', 7)] });
  assert.deepEqual(d.events.map((e) => e.at), [1.5e12, 1.5e12, 1.7e12]);
});

test('oversized sessions, events and custom lists are bounded', () => {
  const ev = (i) => ({ v: EVENT_VERSION, id: 'e' + i, at: 1.6e12 + i, instrument: 'kbd', skill: 's' + (i % 7), source: 'drill', assistance: 'none', dims: {}, unassessed: [], activeMs: 1 });
  const d = run({
    sessions: Array.from({ length: 5000 }, (_, i) => ({ d: '2026-01-01-and-more', mod: 'kbd', min: 1e9, acc: -4, a1: NaN, from: 0, to: 1e6, breaks: 'x' + i })),
    events: Array.from({ length: EVENT_HISTORY_MAX + 300 }, (_, i) => ev(i)),
    custom: Array.from({ length: 5000 }, (_, i) => i),
    latencyMs: 1e9,
  });
  assert.equal(d.sessions.length, 60);
  assert.equal(d.sessions[0].d, '2026-01-01');
  assert.equal(d.sessions[0].min, 600);
  assert.equal(d.sessions[0].acc, 0);
  assert.equal(d.sessions[0].to, 80);
  assert.ok(d.events.length <= EVENT_HISTORY_MAX);
  assert.equal(d.custom.length, 300);
  assert.equal(d.latencyMs, 300);
});

test('a missing latency takes the caller default', () => {
  assert.equal(sanitizeDB({}, 42, 1e12, deps).latencyMs, 42);
  assert.equal(sanitizeDB({}, undefined, 1e12, deps).latencyMs, 0);
});

// ---- seeded garbage-shape sweep ----
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function garbage(r, depth = 0) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const leaves = [null, undefined, true, false, 0, -1, 1e308, -1e308, NaN, Infinity, '', 'x', '5', 'constructor', '__proto__', 'toString', 'kbd', 'harp', 'both', 'dark', 'en', 60, 0.5, 2, 99, [], {}];
  if (depth > 3 || r() < 0.35) return pick(leaves);
  if (r() < 0.4) return Array.from({ length: Math.floor(r() * 5) }, () => garbage(r, depth + 1));
  const keys = ['mod', 'wind', 'voice', 'voiceRange', 'low', 'high', 'names', 'noiseFloor', 'noiseFloorV', 'inputDeviceId', 'notate', 'kbd', 'theme', 'locale', 'noteNaming', 'system', 'accidentals', 'harpKey', 'kbdHands', 'sessionMinutes', 'd', 'min', 'acc', 'source', 'songId', 'at', 'id', 'constructor', '__proto__', 'item', 'level'];
  const o = {};
  for (let i = Math.floor(r() * 6); i > 0; i--) Object.defineProperty(o, pick(keys), { value: garbage(r, depth + 1), enumerable: true, configurable: true, writable: true });
  return o;
}
function topLevelGarbage(r) {
  const o = { v: garbage(r, 2), mods: garbage(r, 1), sessions: r() < 0.7 ? Array.from({ length: Math.floor(r() * 90) }, () => garbage(r, 1)) : garbage(r), events: r() < 0.7 ? Array.from({ length: Math.floor(r() * 30) }, () => garbage(r, 1)) : garbage(r), prefs: garbage(r), custom: garbage(r), latencyMs: garbage(r), panels: garbage(r) };
  for (const k of Object.keys(o)) if (r() < 0.15) delete o[k];
  return o;
}

test('seeded sweep: never throws, always the full prefs shape, stable on a second pass', () => {
  const nonObjects = [null, undefined, 0, 1, NaN, 'abc', '', true, false, [], [1, 2], ['a'], () => 1];
  const inputs = nonObjects.slice();
  const r = rng(20261005);
  for (let i = 0; i < 1500; i++) inputs.push(topLevelGarbage(r));
  for (const input of inputs) {
    const d = run(input);
    assert.deepEqual(Object.keys(d.prefs).sort(), PREF_KEYS.slice().sort());
    assert.ok(Object.prototype.hasOwnProperty.call(MODS, d.prefs.mod));
    assert.ok(Object.prototype.hasOwnProperty.call(deps.WIND_KINDS, d.prefs.wind));
    assert.ok(['low', 'mid', 'high', 'mine'].includes(d.prefs.voice));
    assert.ok(['system', 'light', 'dark'].includes(d.prefs.theme));
    assert.ok(['en', 'es'].includes(d.prefs.locale));
    assert.ok(['both', 'right', 'left'].includes(d.prefs.kbdHands));
    assert.ok([null, 5, 10, 15].includes(d.prefs.sessionMinutes));
    assert.equal(typeof d.prefs.names, 'boolean');
    assert.ok(d.prefs.noiseFloor === null || (d.prefs.noiseFloor >= 0 && d.prefs.noiseFloor <= 1));
    assert.ok(d.prefs.inputDeviceId === null || typeof d.prefs.inputDeviceId === 'string');
    assert.ok(Number.isInteger(d.prefs.harpKey) && d.prefs.harpKey >= 0 && d.prefs.harpKey <= 11);
    assert.deepEqual(Object.keys(d.prefs.notate), deps.NOTATE_MOD_IDS);
    assert.deepEqual(Object.keys(d.mods), deps.MOD_IDS);
    assert.ok(Array.isArray(d.sessions) && d.sessions.length <= 60);
    assert.ok(d.sessions.every((s) => Object.prototype.hasOwnProperty.call(MODS, s.mod) && typeof s.d === 'string' && s.d.length <= 10));
    assert.ok(Array.isArray(d.events) && Array.isArray(d.custom) && d.custom.length <= 300);
    assert.ok(Number.isFinite(d.latencyMs) && d.latencyMs >= 0 && d.latencyMs <= 300);
    assert.equal(typeof d.panels, 'object');
    assert.equal(d.v, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(run(d))), JSON.parse(JSON.stringify(d)), 'a second pass changes nothing');
  }
});
