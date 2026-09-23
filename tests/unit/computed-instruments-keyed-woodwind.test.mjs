import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FLUTE_NOTES, CLARINET_NOTES, OBOE_NOTES, SAX_NOTES, keyedFingeringFor } from '../../src/instruments/how/keyed-woodwind.js';
import flute from '../../src/instruments/flute.js';
import clarinetBb from '../../src/instruments/clarinet-bb.js';
import oboe from '../../src/instruments/oboe.js';
import saxAlto from '../../src/instruments/sax-alto-eb.js';
import saxTenor from '../../src/instruments/sax-tenor-bb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS_PATH = path.join(__dirname, '..', '..', 'src', 'app.js');

const TABLES = { flute: FLUTE_NOTES, clarinet: CLARINET_NOTES, oboe: OBOE_NOTES, sax: SAX_NOTES };

for (const [chart, table] of Object.entries(TABLES)) {
  test(chart + ': every entry round-trips through keyedFingeringFor by its own midi', () => {
    table.forEach(e => assert.equal(keyedFingeringFor(e.midi, chart).name, e.name));
  });

  test(chart + ': midi values are ascending and unique', () => {
    for (let i = 1; i < table.length; i++) {
      assert.ok(table[i].midi > table[i - 1].midi, table[i].name + ' should be higher than ' + table[i - 1].name);
    }
  });

  test(chart + ': every entry has a non-empty keys description', () => {
    table.forEach(e => assert.ok(typeof e.keys === 'string' && e.keys.length > 0, e.name));
  });
}

test('flute: record range endpoints (60-72) resolve to a non-null entry', () => {
  assert.equal(flute.range.low, 60);
  assert.equal(flute.range.high, 72);
  assert.ok(keyedFingeringFor(flute.range.low, 'flute') !== null);
  assert.ok(keyedFingeringFor(flute.range.high, 'flute') !== null);
});

test('clarinet: record range endpoints (55-67) resolve to a non-null entry', () => {
  assert.equal(clarinetBb.range.low, 55);
  assert.equal(clarinetBb.range.high, 67);
  assert.ok(keyedFingeringFor(clarinetBb.range.low, 'clarinet') !== null);
  assert.ok(keyedFingeringFor(clarinetBb.range.high, 'clarinet') !== null);
});

test('oboe: record range endpoints (62-74) resolve to a non-null entry, and D5 is flagged half-hole', () => {
  assert.equal(oboe.range.low, 62);
  assert.equal(oboe.range.high, 74);
  assert.ok(keyedFingeringFor(oboe.range.low, 'oboe') !== null);
  const top = keyedFingeringFor(oboe.range.high, 'oboe');
  assert.ok(top !== null);
  assert.equal(top.name, 'D5');
  assert.equal(top.halfHole, true);
});

test('sax: alto and tenor record ranges (58-67) start on Bb3, the horn\'s actual lowest written note', () => {
  // Fixed alongside the sax records becoming ready: a saxophone's lowest
  // written note is Bb3 (midi 58) -- SAX_NOTES has no entries below it, so
  // the old range.low of 55 put three notes (55-57) in the drill range with
  // no fingering to show. range.low is now 58 on both records.
  assert.equal(saxAlto.range.low, 58);
  assert.equal(saxAlto.range.high, 67);
  assert.equal(saxTenor.range.low, 58);
  assert.equal(saxTenor.range.high, 67);
  assert.ok(keyedFingeringFor(saxAlto.range.low, 'sax') !== null, 'Bb3, the sax\'s actual lowest written note');
  assert.ok(keyedFingeringFor(saxAlto.range.high, 'sax') !== null);
});

test('a pitch outside every table returns null, not a guess', () => {
  assert.equal(keyedFingeringFor(40, 'flute'), null);
  assert.equal(keyedFingeringFor(40, 'clarinet'), null);
  assert.equal(keyedFingeringFor(40, 'oboe'), null);
  assert.equal(keyedFingeringFor(40, 'sax'), null);
});

test('keyedFingeringFor rejects an unknown chart', () => {
  assert.throws(() => keyedFingeringFor(60, 'kazoo'));
});

// Every written-pitch note id (Wn(...)) that MODS['<id>'] actually drills in
// src/app.js must resolve to a non-null fingering in its chart -- otherwise
// a learner would be drilled on a note this app cannot show a fingering
// for. Extracted from the real source rather than hand-copied, so the check
// stays true if a level's note set changes later.
const CHART_FOR_ID = { flute: 'flute', 'clarinet-bb': 'clarinet', oboe: 'oboe', 'sax-alto-eb': 'sax', 'sax-tenor-bb': 'sax' };

for (const [id, chart] of Object.entries(CHART_FOR_ID)) {
  test(id + ': every Wn(...) note MODS drills has a non-null fingering in the "' + chart + '" chart', () => {
    const src = readFileSync(APP_JS_PATH, 'utf8');
    const idRef = /^[a-z][a-z0-9]*$/.test(id) ? 'MODS.' + id : "MODS['" + id + "']";
    const modStart = src.indexOf(idRef + ' = {');
    assert.ok(modStart >= 0, idRef + ' not found in app.js');
    const modEnd = src.slice(modStart + 1).search(/\n  MODS(\.\w+|\[)/) + modStart + 1;
    const block = modEnd > modStart ? src.slice(modStart, modEnd) : src.slice(modStart, modStart + 4000);
    const midiIds = [...block.matchAll(/Wn\(([^)]*)\)/g)].flatMap(m => m[1].split(',').map(s => Number(s.trim())));
    assert.ok(midiIds.length > 0, "MODS['" + id + "'] names no Wn(...) notes to check");
    for (const midi of midiIds) {
      assert.ok(keyedFingeringFor(midi, chart) !== null, id + ': written note ' + midi + ' has no fingering in the "' + chart + '" chart');
    }
  });
}
