import test from 'node:test';
import assert from 'node:assert/strict';
import { FLUTE_NOTES, CLARINET_NOTES, OBOE_NOTES, SAX_NOTES, keyedFingeringFor } from '../../src/instruments/how/keyed-woodwind.js';
import flute from '../../src/instruments/flute.js';
import clarinetBb from '../../src/instruments/clarinet-bb.js';
import oboe from '../../src/instruments/oboe.js';
import saxAlto from '../../src/instruments/sax-alto-eb.js';
import saxTenor from '../../src/instruments/sax-tenor-bb.js';

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

test('sax: alto and tenor record ranges (55-67) are written the same, and the low end (55-57) does not exist on the horn', () => {
  assert.equal(saxAlto.range.low, 55);
  assert.equal(saxAlto.range.high, 67);
  assert.equal(saxTenor.range.low, 55);
  assert.equal(saxTenor.range.high, 67);
  assert.equal(keyedFingeringFor(55, 'sax'), null);
  assert.equal(keyedFingeringFor(56, 'sax'), null);
  assert.equal(keyedFingeringFor(57, 'sax'), null);
  assert.ok(keyedFingeringFor(58, 'sax') !== null, 'Bb3, the sax\'s actual lowest written note');
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
