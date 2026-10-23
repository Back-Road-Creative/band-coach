import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kitLayout, kitRegions, pieceAt, KIT_ASPECT, describeHit } from '../../src/instruments/how/drum-kit.js';
import { computeHow } from '../../src/ui/fingerings/how.js';
import { instrumentSetup } from '../../src/ui/fingerings/setup.js';
import drumKit from '../../src/instruments/drum-kit.js';
import { sanitizeDB } from '../../src/core/sanitize-db.js';

test('left-handed kits mirror every hit region and the teaching directions', () => {
  const right = kitLayout(), left = kitLayout({ leftHanded: true });
  right.forEach((p, i) => {
    assert.equal(left[i].id, p.id);
    assert.equal(left[i].x, KIT_ASPECT - p.x);
    assert.equal(left[i].y, p.y);
  });
  assert.match(describeHit('kick', { leftHanded: true }), /left foot/);
  assert.match(describeHit('hihat-closed', { leftHanded: true }), /on your right/);
});

test('compact e-kit brings rack toms together and reduces the kick tower', () => {
  const map = opts => Object.fromEntries(kitLayout(opts).map(p => [p.id, p]));
  const standard = map(), compact = map({ preset: 'compact' });
  assert.ok(compact['tom-mid'].x - compact['tom-high'].x < standard['tom-mid'].x - standard['tom-high'].x);
  assert.ok(compact.kick.h < standard.kick.h);
  assert.deepEqual(Object.keys(compact), Object.keys(standard));
});

test('hidden pieces are absent from hit tests; required lesson pieces remain playable', () => {
  const box = { x: 5, y: 9, w: 560, h: 400 }, opts = { hiddenPieces: ['ride'] };
  const ride = kitRegions(box).find(p => p.id === 'ride');
  assert.equal(pieceAt(ride.cx, ride.cy, box, opts), null);
  assert.ok(!kitLayout(opts).some(p => p.id === 'ride'));
  assert.equal(pieceAt(ride.cx, ride.cy, box, opts, ['ride']), 'ride');
});

test('every visible piece remains hittable for both presets and handednesses', () => {
  const box = { x: 0, y: 0, w: 320, h: 200 };
  for (const preset of ['standard', 'compact']) for (const leftHanded of [false, true]) {
    const opts = { preset, leftHanded, hiddenPieces: ['crash'] };
    for (const r of kitRegions(box, opts)) assert.equal(pieceAt(r.cx, r.cy, box, opts), r.id);
  }
});

test('profile restore keeps valid kit preferences and drops malformed fields', () => {
  const deps = { MODS: { kbd: {} }, MOD_IDS: ['kbd'], WIND_KINDS: {}, VOICE_KINDS: {}, LOCALES: [], NOTATE_MOD_IDS: [], sanitizeModel: x => x, sanitizePanelData: () => ({}), skillMap: {} };
  const run = kit => sanitizeDB({ prefs: { kit } }, 0, 0, deps).prefs.kit;
  const prefs = { preset: 'compact', leftHanded: true, hiddenPieces: ['ride', 'crash'] };
  assert.deepEqual(run(JSON.parse(JSON.stringify(prefs))), prefs);
  assert.deepEqual(run({ preset: 'constructor', leftHanded: 'yes', hiddenPieces: ['ride', 'ride', '__proto__', 3] }), { preset: 'standard', leftHanded: false, hiddenPieces: ['ride'] });
  for (const bad of [null, 1, 'compact', [], undefined]) assert.deepEqual(run(bad), { preset: 'standard', leftHanded: false, hiddenPieces: [] });
});

test('How to play and Songs use the same saved kit layout, including the selected hidden target', () => {
  const kit = { preset: 'compact', leftHanded: true, hiddenPieces: ['ride', 'crash'] };
  const setup = instrumentSetup(drumKit, { prefs: { kit } });
  assert.deepEqual(setup.kit, kit);
  const how = computeHow(drumKit, 51, setup);
  assert.deepEqual(how.layout, kitLayout(kit, ['ride']));
  assert.ok(how.layout.some(p => p.id === 'ride'));
  assert.ok(!how.layout.some(p => p.id === 'crash'));
  assert.match(how.description, /on your left/);
});
