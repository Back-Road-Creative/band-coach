import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { validateInstrument } from '../../src/instruments/schema.js';
import { INSTRUMENTS, byId } from '../../src/instruments/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS_PATH = path.join(__dirname, '..', '..', 'src', 'app.js');

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

  assert.ok(topLevelIds.size > 0, 'found no MODS keys to compare against');

  // ear (ear training) and rhy (rhythm reading) are trainers, not instruments:
  // their input is 'answer'/'tap', not a physical instrument being played.
  // This unit only extracts the instrument mods, so exclude them here too.
  const NOT_INSTRUMENTS = new Set(['ear', 'rhy']);
  const modsInstrumentIds = [...topLevelIds].filter(id => !NOT_INSTRUMENTS.has(id)).sort();

  const readyIds = INSTRUMENTS.filter(r => r.status === 'ready').map(r => r.id).sort();

  assert.deepEqual(readyIds, modsInstrumentIds);
});
