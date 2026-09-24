// The drum-kit trainer's levels (src/instruments/drum-kit.js TRAINER_LEVELS):
// every bar is a real bar of its metre, names one kit piece (or a stack of
// them, or a flam) per sounding note, and the record's curriculum is exactly
// the level names in order -- so the app's MODS entry and the record can
// never disagree about what the levels are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as RHY from '../../src/core/rhythm.js';
import rec, { PIECES, TRAINER_LEVELS, kitBar } from '../../src/instruments/drum-kit.js';
import { validateInstrument } from '../../src/instruments/schema.js';

const ids = new Set(PIECES.map(p => p.id));

test('kitBar reads "cell:hits" steps: + stacks pieces, F marks a flam', () => {
  assert.deepEqual(kitBar('ee:H+K,H q:FS q:T1 q:C'), {
    cells: ['ee', 'q', 'q', 'q'],
    hits: [
      { pieces: ['hihat-closed', 'kick'], flam: false },
      { pieces: ['hihat-closed'], flam: false },
      { pieces: ['snare'], flam: true },
      { pieces: ['tom-high'], flam: false },
      { pieces: ['crash'], flam: false }
    ]
  });
  assert.throws(() => kitBar('q:X'), /unknown drum/);
});

test('the levels run in the teaching order the trainer promises', () => {
  const names = TRAINER_LEVELS.map(l => l.name);
  assert.equal(names.length, 9);
  assert.match(names[0], /one drum/i);
  assert.match(names[2], /rock beat/i);
  assert.match(names[4], /fill/i);
  assert.match(names[5], /rudiment/i);
  assert.equal(TRAINER_LEVELS[6].metre, '3/4');
  assert.equal(TRAINER_LEVELS[7].metre, '6/8');
  assert.ok(TRAINER_LEVELS[8].swing > 0, 'the last level swings');
  assert.ok(TRAINER_LEVELS[8].bars.every(b => b.hits.some(h => h.pieces.includes('ride'))), 'swing level keeps time on the ride');
});

test('every bar sums to its metre, starts on the downbeat and has one hit per sounding note', () => {
  for (const l of TRAINER_LEVELS) {
    assert.ok(RHY.METRES[l.metre], l.name + ' metre');
    assert.ok(l.bpm >= 40 && l.bpm <= 140, l.name + ' bpm');
    assert.ok(l.bars.length > 0, l.name + ' has bars');
    for (const b of l.bars) {
      const phrase = RHY.buildPhrase({ metre: l.metre, cells: b.cells });
      assert.ok(RHY.validateBar(phrase.events, l.metre), l.name + ': ' + b.cells.join(' '));
      const sounding = phrase.events.filter(e => !e.rest && !e.tied).length;
      assert.equal(b.hits.length, sounding, l.name + ': hits vs notes in ' + b.cells.join(' '));
      assert.ok(!phrase.events[0].rest, l.name + ': the bar opens on a hit (the staff lays out from the first hit)');
      for (const h of b.hits) {
        assert.ok(h.pieces.length > 0);
        for (const p of h.pieces) assert.ok(ids.has(p), l.name + ': ' + p);
        if (h.flam) assert.deepEqual(h.pieces, ['snare'], 'a flam is two snare hits');
      }
    }
  }
});

test('level 1 gives every piece of the kit its own bar; fills run high tom to floor tom; rudiments include a flam', () => {
  const alone = TRAINER_LEVELS[0].bars.map(b => [...new Set(b.hits.flatMap(h => h.pieces))]);
  assert.ok(alone.every(p => p.length === 1));
  assert.deepEqual(alone.map(p => p[0]).sort(), [...ids].sort());
  const fill = TRAINER_LEVELS[4].bars.some(b => { const s = b.hits.flatMap(h => h.pieces).join(' '); return /tom-high.*tom-mid.*tom-floor/.test(s); });
  assert.ok(fill, 'a fill moves tom-high -> tom-mid -> tom-floor');
  assert.ok(TRAINER_LEVELS[5].bars.some(b => b.hits.some(h => h.flam)), 'a flam bar');
  assert.ok(TRAINER_LEVELS[5].bars.every(b => b.hits.every(h => h.pieces.join() === 'snare')), 'rudiments stay on the snare');
});

test('the record is ready and its curriculum is the level names, in order', () => {
  assert.equal(rec.status, 'ready');
  assert.deepEqual(rec.curriculum, TRAINER_LEVELS.map((l, i) => ({ level: i + 1, items: [l.name] })));
  const { ok, errors } = validateInstrument(rec);
  assert.equal(ok, true, errors.join('; '));
});
