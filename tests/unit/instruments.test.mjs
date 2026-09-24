import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { validateInstrument } from '../../src/instruments/schema.js';
import { INSTRUMENTS, byId } from '../../src/instruments/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS_PATH = path.join(__dirname, '..', '..', 'src', 'app.js');

test('every instrument record carries a provenance field, provisional (null) until a musician reviews it', () => {
  for (const rec of INSTRUMENTS) {
    assert.ok('provenance' in rec, rec.id + ' is missing a provenance field');
    assert.equal(rec.provenance, null, rec.id + ': no reviewer name/date has been supplied yet, so provenance must stay null');
  }
});

test('every instrument record passes validateInstrument', () => {
  for (const rec of INSTRUMENTS) {
    const { ok, errors } = validateInstrument(rec);
    assert.equal(ok, true, rec && rec.id + ': ' + errors.join('; '));
  }
});

test('instrument ids are unique', () => {
  const ids = INSTRUMENTS.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('byId maps every id back to its record', () => {
  for (const rec of INSTRUMENTS) {
    assert.equal(byId[rec.id], rec);
  }
});

test('every fretted or bowed record has a tuning inside its range', () => {
  const stringed = INSTRUMENTS.filter(r => r.family === 'fretted' || r.family === 'bowed');
  assert.ok(stringed.length > 0, 'expected at least one fretted/bowed instrument');
  for (const rec of stringed) {
    assert.ok(Array.isArray(rec.tuning) && rec.tuning.length > 0, rec.id + ' missing tuning');
    for (const note of rec.tuning) {
      assert.ok(note >= rec.range.low && note <= rec.range.high, rec.id + ': tuning note ' + note + ' outside range ' + rec.range.low + '-' + rec.range.high);
    }
  }
});

test('validator rejects a table of bad records', () => {
  const good = {
    id: 'test-good',
    name: 'Test Good',
    family: 'keys',
    input: 'midi',
    range: { low: 40, high: 60 },
    transposition: 0,
    clefs: ['treble'],
    octavePolicy: 'exact',
    status: 'ready',
    curriculum: [{ level: 1, items: ['First'] }]
  };
  assert.equal(validateInstrument(good).ok, true, validateInstrument(good).errors.join('; '));

  const cases = [
    ['missing id', { ...good, id: undefined }],
    ['low >= high', { ...good, range: { low: 60, high: 40 } }],
    ['unknown clef', { ...good, clefs: ['kazoo'] }],
    ['fretted with no tuning', { ...good, family: 'fretted' }],
    ['ready with empty curriculum', { ...good, curriculum: [] }],
    ['transposition not an integer', { ...good, transposition: 1.5 }]
  ];
  for (const [label, bad] of cases) {
    const { ok, errors } = validateInstrument(bad);
    assert.equal(ok, false, label + ': expected rejection, got ok with ' + JSON.stringify(bad));
    assert.ok(errors.length > 0, label + ': expected at least one error message');
  }
});

test('guitar and bass are written an octave above their sounding pitch', () => {
  // Standard notation convention: guitar and bass sound an octave below what
  // is printed, to keep the part off a thicket of ledger lines.
  assert.equal(byId.gtr.writtenOctaveUp, true);
  assert.equal(byId.bass.writtenOctaveUp, true);
});

test('validateInstrument accepts a boolean writtenOctaveUp and rejects anything else', () => {
  const good = {
    id: 'test-good-2',
    name: 'Test Good 2',
    family: 'keys',
    input: 'midi',
    range: { low: 40, high: 60 },
    transposition: 0,
    clefs: ['treble'],
    octavePolicy: 'exact',
    status: 'ready',
    curriculum: [{ level: 1, items: ['First'] }]
  };
  assert.equal(validateInstrument(good).ok, true, 'writtenOctaveUp is optional');
  assert.equal(validateInstrument({ ...good, writtenOctaveUp: true }).ok, true);
  assert.equal(validateInstrument({ ...good, writtenOctaveUp: false }).ok, true);
  const { ok, errors } = validateInstrument({ ...good, writtenOctaveUp: 'yes' });
  assert.equal(ok, false);
  assert.ok(errors.length > 0);
});

test('READY instrument ids match the instrument ids in today\'s MODS', () => {
  const src = readFileSync(APP_JS_PATH, 'utf8');
  const modsStart = src.indexOf('const MODS = {');
  assert.ok(modsStart >= 0, 'could not find "const MODS = {" in app.js');
  // Find the end of the MODS object literal: the first "\n  };" after modsStart
  // (the literal is closed at 2-space indent, matching "const MODS = {" itself).
  const modsEnd = src.indexOf('\n  };', modsStart);
  assert.ok(modsEnd > modsStart, 'could not find the end of the MODS object literal');
  const modsBlock = src.slice(modsStart, modsEnd);

  const topLevelIds = new Set();
  for (const m of modsBlock.matchAll(/^ {4}(\w+): \{/gm)) topLevelIds.add(m[1]);
  // Instruments added onto MODS after the initial literal (e.g. MODS.harp = {...}).
  for (const m of src.matchAll(/^\s*MODS\.(\w+) = \{/gm)) topLevelIds.add(m[1]);
  // Hyphenated ids (e.g. bass-5-string) cannot be dot-notation properties, so
  // those are added as MODS['id'] = {...} -- same convention, bracket syntax.
  for (const m of src.matchAll(/^\s*MODS\['([\w-]+)'\] = \{/gm)) topLevelIds.add(m[1]);

  assert.ok(topLevelIds.size > 0, 'found no MODS keys to compare against');

  // ear (ear training) and rhy (rhythm reading) are trainers, not instruments:
  // their input is 'answer'/'tap', not a physical instrument being played.
  // This unit only extracts the instrument mods, so exclude them here too.
  const NOT_INSTRUMENTS = new Set(['ear', 'rhy']);
  const modsInstrumentIds = [...topLevelIds].filter(id => !NOT_INSTRUMENTS.has(id)).sort();

  const readyIds = INSTRUMENTS.filter(r => r.status === 'ready').map(r => r.id).sort();

  assert.deepEqual(readyIds, modsInstrumentIds);
});

test('oboe is a ready concert-pitch wind record with a curriculum, no invented fingerings field', () => {
  assert.equal(byId.oboe.status, 'ready');
  assert.equal(byId.oboe.family, 'wind');
  assert.equal(byId.oboe.transposition, 0);
  assert.ok(byId.oboe.curriculum.length > 0);
  assert.equal(byId.oboe.fingerings, undefined, 'fingering data lives in src/instruments/how/keyed-woodwind.js, not a field on the record itself');
});

test('validateInstrument accepts a null or absent provenance (provisional, no reviewer yet)', () => {
  const good = {
    id: 'test-good-3',
    name: 'Test Good 3',
    family: 'keys',
    input: 'midi',
    range: { low: 40, high: 60 },
    transposition: 0,
    clefs: ['treble'],
    octavePolicy: 'exact',
    status: 'ready',
    curriculum: [{ level: 1, items: ['First'] }]
  };
  assert.equal(validateInstrument(good).ok, true, 'provenance is optional');
  assert.equal(validateInstrument({ ...good, provenance: null }).ok, true, validateInstrument({ ...good, provenance: null }).errors.join('; '));
});

test('validateInstrument accepts a fully-reviewed provenance and rejects a half-filled one', () => {
  const good = {
    id: 'test-good-4',
    name: 'Test Good 4',
    family: 'keys',
    input: 'midi',
    range: { low: 40, high: 60 },
    transposition: 0,
    clefs: ['treble'],
    octavePolicy: 'exact',
    status: 'ready',
    curriculum: [{ level: 1, items: ['First'] }]
  };
  const reviewed = { ...good, provenance: { reference: 'Standard of Excellence, Book 1', reviewedBy: 'A. Reviewer', reviewedAt: '2026-09-24' } };
  assert.equal(validateInstrument(reviewed).ok, true, validateInstrument(reviewed).errors.join('; '));

  const unreviewed = { ...good, provenance: { reference: 'Standard of Excellence, Book 1', reviewedBy: null, reviewedAt: null } };
  assert.equal(validateInstrument(unreviewed).ok, true, validateInstrument(unreviewed).errors.join('; '));

  const cases = [
    ['reviewedBy without reviewedAt', { ...good, provenance: { reference: 'X', reviewedBy: 'A. Reviewer', reviewedAt: null } }],
    ['reviewedAt without reviewedBy', { ...good, provenance: { reference: 'X', reviewedBy: null, reviewedAt: '2026-09-24' } }],
    ['empty reference', { ...good, provenance: { reference: '', reviewedBy: null, reviewedAt: null } }],
    ['missing reference', { ...good, provenance: { reviewedBy: null, reviewedAt: null } }],
    ['reviewedAt not YYYY-MM-DD', { ...good, provenance: { reference: 'X', reviewedBy: 'A. Reviewer', reviewedAt: '9/24/2026' } }],
    ['provenance as a string', { ...good, provenance: 'reviewed by someone' }]
  ];
  for (const [label, bad] of cases) {
    const { ok, errors } = validateInstrument(bad);
    assert.equal(ok, false, label + ': expected rejection, got ok');
    assert.ok(errors.length > 0, label + ': expected at least one error message');
  }
});

test('mallet-percussion is a ready percussion record with a non-empty curriculum', () => {
  const rec = byId['mallet-percussion'];
  assert.equal(rec.status, 'ready');
  assert.equal(rec.family, 'percussion');
  assert.equal(rec.octavePolicy, 'exact');
  assert.equal(rec.transposition, 0);
  assert.ok(rec.curriculum.length > 0);
});

// Drum kit: a planned percussion record whose `kit` lists the drawn pieces,
// their General MIDI percussion notes and a computer-key suggestion each.
// These ids and notes are a contract other units code against.
const DRUM_CONTRACT = {
  kick: [35, 36],
  snare: [38, 37, 40],
  'hihat-closed': [42],
  'hihat-pedal': [44],
  'hihat-open': [46],
  'tom-floor': [41, 43],
  'tom-mid': [45, 47],
  'tom-high': [48, 50],
  crash: [49, 52, 55, 57],
  ride: [51, 53, 59]
};

test('drum-kit is a ready percussion record with the contract kit and a curriculum', async () => {
  const rec = byId['drum-kit'];
  assert.ok(rec, 'expected a drum-kit record in INSTRUMENTS');
  assert.equal(rec.name, 'Drum kit');
  assert.equal(rec.family, 'percussion');
  // 'mic+midi', not plain 'midi': the trainer now also hears a real kit
  // through the microphone (kick/snare/hi-hat only -- see src/app.js).
  assert.equal(rec.input, 'mic+midi');
  assert.deepEqual(rec.range, { low: 35, high: 59 });
  assert.deepEqual(rec.clefs, ['percussion']);
  assert.equal(rec.status, 'ready');
  assert.ok(rec.curriculum.length > 0, 'a ready record needs its curriculum');
  const { ok, errors } = validateInstrument(rec);
  assert.equal(ok, true, errors.join('; '));
  const got = Object.fromEntries(rec.kit.map(p => [p.id, p.midi]));
  assert.deepEqual(got, DRUM_CONTRACT);
  const keys = Object.fromEntries(rec.kit.map(p => [p.id, p.key]));
  assert.deepEqual(keys, { kick: 'f', snare: 'j', 'hihat-closed': 'd', 'hihat-open': 'e', 'hihat-pedal': 'c', 'tom-high': 'u', 'tom-mid': 'i', 'tom-floor': 'k', crash: 'r', ride: 'o' });
  const names = Object.fromEntries(rec.kit.map(p => [p.id, p.name]));
  assert.deepEqual(names, { kick: 'Bass drum', snare: 'Snare', 'hihat-closed': 'Hi-hat (closed)', 'hihat-pedal': 'Hi-hat (pedal)', 'hihat-open': 'Hi-hat (open)', 'tom-floor': 'Floor tom', 'tom-mid': 'Mid tom', 'tom-high': 'High tom', crash: 'Crash cymbal', ride: 'Ride cymbal' });
});

test('drum-kit helpers map every GM note to its piece and each piece to its first note', async () => {
  const { PIECES, pieceForMidi, canonicalMidi } = await import('../../src/instruments/drum-kit.js');
  assert.equal(PIECES, byId['drum-kit'].kit);
  for (const [id, notes] of Object.entries(DRUM_CONTRACT)) {
    for (const n of notes) assert.equal(pieceForMidi(n), id, 'MIDI ' + n);
    assert.equal(canonicalMidi(id), notes[0]);
  }
  assert.equal(pieceForMidi(39), null, 'hand clap is not on this kit');
  assert.equal(pieceForMidi(60), null);
  assert.equal(pieceForMidi('38'), null);
  assert.equal(canonicalMidi('cowbell'), null);
});

test('validateInstrument checks an optional kit field piece by piece', () => {
  const base = {
    id: 'test-kit',
    name: 'Test kit',
    family: 'percussion',
    input: 'midi',
    range: { low: 35, high: 59 },
    transposition: 0,
    clefs: ['percussion'],
    octavePolicy: 'exact',
    status: 'planned',
    provenance: null,
    curriculum: []
  };
  const kick = { id: 'kick', name: 'Bass drum', midi: [35, 36], key: 'f' };
  const snare = { id: 'snare', name: 'Snare', midi: [38], key: 'j' };
  assert.equal(validateInstrument(base).ok, true, 'kit is optional');
  const good = { ...base, kit: [kick, snare] };
  assert.equal(validateInstrument(good).ok, true, validateInstrument(good).errors.join('; '));

  const cases = [
    ['kit not an array', { ...base, kit: { kick } }],
    ['empty kit', { ...base, kit: [] }],
    ['piece not an object', { ...base, kit: [kick, 'snare'] }],
    ['id not kebab-case', { ...base, kit: [kick, { ...snare, id: 'Snare Drum' }] }],
    ['duplicate id', { ...base, kit: [kick, { ...snare, id: 'kick' }] }],
    ['empty name', { ...base, kit: [kick, { ...snare, name: '' }] }],
    ['empty midi list', { ...base, kit: [kick, { ...snare, midi: [] }] }],
    ['midi not an integer', { ...base, kit: [kick, { ...snare, midi: [38.5] }] }],
    ['midi outside range', { ...base, kit: [kick, { ...snare, midi: [60] }] }],
    ['one note on two pieces', { ...base, kit: [kick, { ...snare, midi: [36] }] }],
    ['key uppercase', { ...base, kit: [kick, { ...snare, key: 'J' }] }],
    ['key two letters', { ...base, kit: [kick, { ...snare, key: 'jj' }] }],
    ['key not a letter', { ...base, kit: [kick, { ...snare, key: ';' }] }],
    ['duplicate key', { ...base, kit: [kick, { ...snare, key: 'f' }] }]
  ];
  for (const [label, bad] of cases) {
    const { ok, errors } = validateInstrument(bad);
    assert.equal(ok, false, label + ': expected rejection, got ok');
    assert.ok(errors.some(e => /kit/.test(e)), label + ': expected an error naming the kit, got ' + JSON.stringify(errors));
  }
});
