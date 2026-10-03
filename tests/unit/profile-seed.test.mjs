// The seeds and clock schedule the release retention test hands the app. Each is
// pinned against the app's own pure logic, so a seed that stopped meaning what
// the release test says it means fails here in milliseconds, not there in a minute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOUR, SEED_T0, seedEvent, seedS1, seedS2, seedS3, seedS4, profileScheduleInit } from '../helpers/profile-seed.mjs';
import { validateEvent, isIndependentOk, summarizeEvents } from '../../src/core/learning-events.js';
import { pathwayState } from '../../src/core/pathway.js';

const at = (h) => SEED_T0 + h * HOUR;
const step = (events, h, midiProof = false) => pathwayState({ events, sessions: [], midiProof, level: 3, now: at(h) });

test('every seed row is a valid event at a real epoch time', () => {
  for (const seed of [seedS1(), seedS2(), seedS3(), seedS4()]) {
    for (const row of seed) { assert.equal(validateEvent(row).ok, true); assert.ok(row.at >= 1e12); }
  }
});

test('S1 to S3 rows are independent-ok; S4 is the row with no input field', () => {
  for (const row of [...seedS3()]) assert.equal(isIndependentOk(row), true);
  assert.equal('input' in seedS4()[0], false);
  assert.equal(isIndependentOk(seedS4()[0]), true);
});

test('the pathway reads each seed at its visit as the release test expects', () => {
  assert.deepEqual([step(seedS1(), 19).step, step(seedS1(), 19).action.kind], ['return', 'wait']);
  assert.deepEqual([step(seedS1(), 21).step, step(seedS1(), 21).action.kind], ['return', 'wait']);
  assert.deepEqual([step(seedS1(), 25).step, step(seedS1(), 25).action.kind], ['return', 'recheck']);
  assert.deepEqual([step(seedS2(), 25).step, step(seedS2(), 25).action.kind], ['return', 'transfer']);
  assert.equal(step(seedS3(), 25).step, 'complete');
  assert.deepEqual([step(seedS4(), 25).step, step(seedS4(), 25).action.kind], ['setup', 'connect-midi']);
});

test('S1 holds no retained skill yet: the progress summary says 0', () => {
  assert.equal(summarizeEvents(seedS1(), { instrument: 'kbd' }).retained, 0);
});

test('a row below 1e12 or an invalid row throws', () => {
  assert.throws(() => seedEvent({ deltaMs: -SEED_T0, skill: 'whole:null' }), /1e12/);
  assert.throws(() => seedEvent({ deltaMs: 0, skill: '' }), /not a valid event/);
});

test('the init script parses and acts only in a top-level file page', () => {
  const src = profileScheduleInit([{ offsetMs: 19 * HOUR, events: seedS1() }, { offsetMs: 25 * HOUR }]);
  assert.doesNotThrow(() => new Function(src));
  assert.match(src, /window\.top !== window \|\| location\.protocol !== 'file:'/);
});
