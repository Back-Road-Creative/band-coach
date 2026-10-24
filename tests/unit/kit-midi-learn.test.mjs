import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pieceForMidi, canonicalMidi, PIECES } from '../../src/instruments/drum-kit.js';
import { sanitizeKitPrefs, learnPad, kitNoteFor } from '../../src/instruments/how/kit-presets.js';
import { sanitizeDB } from '../../src/core/sanitize-db.js';
import { en, es } from '../../src/core/i18n.js';

test('a learned map overrides the General MIDI note; notes it has not seen keep the GM reading', () => {
  const map = { 60: 'snare', 38: 'tom-high' };
  assert.equal(pieceForMidi(60, map), 'snare');
  assert.equal(pieceForMidi(38, map), 'tom-high', 'a learned note beats GM');
  assert.equal(pieceForMidi(36, map), 'kick', 'unlearned notes fall back to GM');
  assert.equal(pieceForMidi(39, map), null, 'a note nobody has seen is still an extra note');
});

test('no map, an empty map or a hostile map falls back to GM', () => {
  for (const map of [undefined, null, {}, [], 'snare', 7, { constructor: 'kick', toString: 'kick', 38: 'not-a-piece' }]) {
    assert.equal(pieceForMidi(38, map), 'snare');
    assert.equal(pieceForMidi(39, map), null);
    assert.equal(pieceForMidi(36, map), 'kick');
  }
  assert.equal(pieceForMidi('60', { 60: 'snare' }), null, 'a string is still not a note');
});

test('learnPad gives a piece the new note, dropping its earlier ones and any other piece that owned the note', () => {
  let map = learnPad(undefined, 'snare', 60);
  assert.deepEqual(map, { 60: 'snare' });
  map = learnPad(map, 'snare', 61);
  assert.deepEqual(map, { 61: 'snare' }, 'hitting the pad again replaces the old note');
  map = learnPad(map, 'kick', 61);
  assert.deepEqual(map, { 61: 'kick' }, 'a note belongs to one piece');
  assert.deepEqual(learnPad({ 61: 'kick' }, 'nope', 5), { 61: 'kick' });
  assert.deepEqual(learnPad({ 61: 'kick' }, 'snare', 200), { 61: 'kick' }, 'not a MIDI note');
});

test('kitNoteFor turns a learned note into the GM note for its piece, and leaves everything else alone', () => {
  const kit = sanitizeKitPrefs({ midiMaps: { 'XKORCE Kit': { 60: 'snare', 61: 'ride' } } });
  assert.equal(kitNoteFor(kit, 'XKORCE Kit', 60), canonicalMidi('snare'));
  assert.equal(kitNoteFor(kit, 'XKORCE Kit', 61), canonicalMidi('ride'));
  assert.equal(kitNoteFor(kit, 'XKORCE Kit', 38), 38, 'not learned: unchanged');
  assert.equal(kitNoteFor(kit, 'Other Kit', 60), 60, 'a different device has no map');
  assert.equal(kitNoteFor(kit, undefined, 60), 60);
  assert.equal(kitNoteFor(undefined, 'XKORCE Kit', 60), 60);
  assert.equal(pieceForMidi(kitNoteFor(kit, 'XKORCE Kit', 60)), 'snare');
});

test('sanitizeKitPrefs keeps valid per-device maps and drops everything malformed', () => {
  const good = { 'XKORCE Kit': { 60: 'snare', 61: 'ride' }, 'Other': { 36: 'kick' } };
  assert.deepEqual(sanitizeKitPrefs({ midiMaps: JSON.parse(JSON.stringify(good)) }).midiMaps, good);
  const dirty = sanitizeKitPrefs({ midiMaps: {
    '  Padded  ': { 60: 'snare', 128: 'kick', '-1': 'kick', 1.5: 'kick', abc: 'kick', 62: 'bogus', 63: 3, 64: 'snare' },
    '': { 60: 'snare' },
    __proto__: { 60: 'snare' },
    Empty: {},
    Bad: 'x',
    List: ['snare']
  } }).midiMaps;
  assert.deepEqual(dirty, { Padded: { 60: 'snare', 64: 'snare' } });
  for (const bad of [null, 1, 'x', [], undefined]) assert.ok(!('midiMaps' in sanitizeKitPrefs({ midiMaps: bad })));
  assert.ok(!('midiMaps' in sanitizeKitPrefs({ midiMaps: { Empty: {} } })));
  assert.equal(({}).polluted, undefined);
});

test('device names and device count are bounded', () => {
  const maps = {};
  for (let i = 0; i < 20; i++) maps['Kit ' + i] = { 36: 'kick' };
  maps['x'.repeat(200)] = { 36: 'kick' };
  const out = sanitizeKitPrefs({ midiMaps: maps }).midiMaps;
  assert.ok(Object.keys(out).length <= 8);
  assert.ok(Object.keys(out).every(k => k.length <= 80));
});

test('learned maps survive profile restore beside the other kit preferences', () => {
  const deps = { MODS: { kbd: {} }, MOD_IDS: ['kbd'], WIND_KINDS: {}, VOICE_KINDS: {}, LOCALES: [], NOTATE_MOD_IDS: [], sanitizeModel: x => x, sanitizePanelData: () => ({}), skillMap: {} };
  const kit = { preset: 'compact', leftHanded: false, hiddenPieces: [], midiMaps: { 'XKORCE Kit': { 60: 'snare' } } };
  assert.deepEqual(sanitizeDB({ prefs: { kit: JSON.parse(JSON.stringify(kit)) } }, 0, 0, deps).prefs.kit, kit);
});

test('every piece can be learned and the set-up sheet strings exist in both languages', () => {
  const keys = ['kit.learn', 'kit.learnHint', 'kit.learnPrompt', 'kit.learnSkip', 'kit.learnStop', 'kit.learnDone', 'kit.learnForget'];
  for (const k of keys) { assert.ok(en[k], 'en ' + k); assert.ok(es[k], 'es ' + k); }
  assert.ok(PIECES.every(p => en['kit.piece.' + p.id]));
});

test('the finish line has a singular form in both languages', () => {
  for (const [lang, table] of [['en', en], ['es', es]]) {
    assert.ok(table['kit.learnDone.one'], lang + ' kit.learnDone.one');
    assert.ok(!table['kit.learnDone.one'].includes('{count}'), lang + ' singular names no count');
    assert.ok(table['kit.learnDone.one'].includes('{device}'), lang + ' singular names the device');
  }
  assert.ok(/\b1 pad\b/.test(en['kit.learnDone.one']) && !/pads/.test(en['kit.learnDone.one']));
});
