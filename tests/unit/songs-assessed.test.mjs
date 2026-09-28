import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dimsFromStep, assessmentLines } from '../../src/ui/songs/assessed.js';
import { isIndependentOk, summarizeEvents } from '../../src/core/learning-events.js';

function rule(overrides = {}) {
  return { maxMeanErrorMs: 60, minDurationScore: 0.6, maxMeanAbsCents: 40, ...overrides };
}

function step(overrides = {}) {
  return { kind: 'phrase', passRule: rule(), ...overrides };
}

function result(overrides = {}) {
  return { judgedCount: 4, matches: [{ ok: true, pitchOk: true }], meanErrorMs: 10, durationScore: 0.9, meanAbsCents: 5, ...overrides };
}

const kbd = { id: 'kbd', family: 'keys' };
const gtr = { id: 'gtr', family: 'fretted', fretted: true };
const voice = { id: 'voice', family: 'voice' };

test('dimsFromStep is unchanged: a rhythm step marks pitch unassessed', () => {
  const { dims, unassessed } = dimsFromStep(step({ kind: 'rhythm' }), result());
  assert.equal(dims.onset, 'ok');
  assert.deepEqual(unassessed, ['pitch']);
});

test('dimsFromStep is unchanged: a judged sustained step with a full rule grades hold/tune', () => {
  const { dims, unassessed } = dimsFromStep(step(), result({ durationScore: 0.9, meanAbsCents: 90 }));
  assert.equal(dims.pitch, 'ok');
  assert.equal(dims.hold, 'ok');
  assert.equal(dims.tune, 'miss');
  assert.deepEqual(unassessed, []);
});

test('dimsFromStep is unchanged: no result, or judgedCount 0, unassesses everything', () => {
  assert.deepEqual(dimsFromStep(step(), null).unassessed, ['pitch', 'onset', 'hold', 'tune']);
  assert.deepEqual(dimsFromStep(step(), result({ judgedCount: 0 })).unassessed, ['pitch', 'onset', 'hold', 'tune']);
});

test('a rhythm step says Notes: Not assessed', () => {
  const { dims, unassessed } = dimsFromStep(step({ kind: 'rhythm' }), result());
  const lines = assessmentLines(dims, unassessed, { step: step({ kind: 'rhythm' }), instrument: kbd });
  const notes = lines.find((l) => l.dim === 'pitch');
  assert.equal(notes.state, 'not-assessed');
  assert.equal(notes.text, 'Notes: Not assessed (a clapped rhythm has no pitches)');
});

test('a keyboard says In tune: Not assessed', () => {
  const { dims, unassessed } = dimsFromStep(step({ passRule: rule({ maxMeanAbsCents: undefined }) }), result({ meanAbsCents: undefined }));
  const lines = assessmentLines(dims, unassessed, { step: step(), instrument: kbd });
  const tune = lines.find((l) => l.dim === 'tune');
  assert.equal(tune.state, 'not-assessed');
  assert.equal(tune.text, 'In tune: Not assessed (keyboards are always in tune)');
});

test('a fretted instrument also gets the fixed-pitch In tune reason', () => {
  const { dims, unassessed } = dimsFromStep(step({ passRule: rule({ maxMeanAbsCents: undefined }) }), result({ meanAbsCents: undefined }));
  const lines = assessmentLines(dims, unassessed, { step: step(), instrument: gtr });
  assert.equal(lines.find((l) => l.dim === 'tune').text, 'In tune: Not assessed (keyboards are always in tune)');
});

test('an instrument that can be judged for tune gets the plain reason instead', () => {
  const { dims, unassessed } = dimsFromStep(step({ passRule: rule({ maxMeanAbsCents: undefined }) }), result({ meanAbsCents: undefined }));
  const lines = assessmentLines(dims, unassessed, { step: step(), instrument: voice });
  assert.equal(lines.find((l) => l.dim === 'tune').text, 'In tune: Not assessed (not judged on this step)');
});

test('nothing heard marks every dimension Not assessed, with one shared honest reason', () => {
  const { dims, unassessed } = dimsFromStep(step(), null);
  const lines = assessmentLines(dims, unassessed, { step: step(), instrument: kbd });
  assert.equal(lines.length, 4);
  lines.forEach((l) => {
    assert.equal(l.state, 'not-assessed');
    assert.match(l.text, /Not assessed \(nothing was heard this try\)$/);
  });
});

test('E3b: a capability that cannot prove a dim moves it from graded to unassessed', () => {
  // 'midi' (src/core/input-event.js DIM_CAPABILITY) can prove pitch/onset/
  // hold/drum but never tune -- a keyboard's own passRule never sets
  // maxMeanAbsCents (family 'keys' is not a sustain recipe), but this
  // proves the gate itself: even a rule that DID grade tune gets overruled
  // by what the capability can actually prove.
  const { dims, unassessed } = dimsFromStep(step(), result(), { assess: 'midi' });
  assert.equal(dims.pitch, 'ok');
  assert.equal(dims.hold, 'ok');
  assert.equal(dims.tune, undefined);
  assert.ok(unassessed.includes('tune'));
});

test('E3b: a percussion step\'s drum dim is unassessed when the capability cannot prove it', () => {
  const percStep = step({ passRule: { minPieceRate: 0.8, maxMeanErrorMs: 60 } });
  const percResult = result({ pieceRate: 0.9, meanAbsCents: undefined, durationScore: undefined });
  const { dims, unassessed } = dimsFromStep(percStep, percResult, { assess: 'mic-single-note' });
  assert.equal(dims.drum, undefined);
  assert.ok(unassessed.includes('drum'));
});

test('E3b: omitting the third argument keeps the 2-arg behaviour byte-identical', () => {
  const withOpts = dimsFromStep(step(), result(), undefined);
  const without = dimsFromStep(step(), result());
  assert.deepEqual(withOpts, without);
});

// Unit XTR: a try that clears every threshold EXCEPT extras (a wrong note
// struck alongside the right ones, passesRule/failedDimension's own
// maxExtras gate, src/ui/songs/practice.js) must not read as "passed on your
// own" -- extras aren't one of the four dims judgeAttempt grades, so without
// this fold-in every dim above would log 'ok' and isIndependentOk/
// summarizeEvents/pathway.js's qualifies() would all wrongly agree it passed
// independently.
function makeDrillEvent(dims, unassessed = []) {
  return { v: 1, id: 'a', at: 1, instrument: 'kbd', skill: 'n4', source: 'song', assistance: 'none', dims, unassessed, activeMs: 400 };
}

test('XTR: an extras-only failure marks pitch a miss, not a silent ok', () => {
  const { dims, unassessed } = dimsFromStep(step({ passRule: rule({ maxExtras: 0 }) }), result({ extras: { count: 1 } }));
  assert.equal(dims.pitch, 'miss');
  assert.equal(dims.onset, 'ok');
  assert.equal(dims.hold, 'ok');
  assert.equal(dims.tune, 'ok');
  assert.ok(!unassessed.includes('pitch'));
  assert.equal(isIndependentOk(makeDrillEvent(dims, unassessed)), false);
  const s = summarizeEvents([makeDrillEvent(dims, unassessed)]);
  assert.equal(s.independent, 0);
});

test('XTR control: the same try with extras.count 0 is still independent-ok', () => {
  const { dims, unassessed } = dimsFromStep(step({ passRule: rule({ maxExtras: 0 }) }), result({ extras: { count: 0 } }));
  assert.equal(dims.pitch, 'ok');
  assert.equal(isIndependentOk(makeDrillEvent(dims, unassessed)), true);
  const s = summarizeEvents([makeDrillEvent(dims, unassessed)]);
  assert.equal(s.independent, 1);
});

test('XTR: a rhythm step\'s extras-only failure marks onset a miss (pitch has no dim to fold into)', () => {
  const { dims, unassessed } = dimsFromStep(step({ kind: 'rhythm', passRule: rule({ maxExtras: 0 }) }), result({ extras: { count: 1 } }));
  assert.equal(dims.onset, 'miss');
  assert.equal(dims.pitch, undefined);
  assert.deepEqual(unassessed, ['pitch']);
  assert.equal(isIndependentOk(makeDrillEvent(dims, unassessed)), false);
});

test('XTR: a capability that can only prove onset (tap) folds the extras miss onto onset, surviving gateByCapability', () => {
  const { dims, unassessed } = dimsFromStep(step({ passRule: rule({ maxExtras: 0 }) }), result({ extras: { count: 1 } }), { assess: 'tap' });
  assert.equal(dims.onset, 'miss');
  assert.equal(dims.pitch, undefined);
  assert.ok(unassessed.includes('pitch'));
  assert.ok(!unassessed.includes('onset'));
  assert.equal(isIndependentOk(makeDrillEvent(dims, unassessed)), false);
});

test('XTR: a capability that can prove nothing (none) invents no dim for extras, and the row still does not count', () => {
  const { dims, unassessed } = dimsFromStep(step({ passRule: rule({ maxExtras: 0 }) }), result({ extras: { count: 1 } }), { assess: 'none' });
  assert.deepEqual(dims, {});
  assert.ok(unassessed.includes('pitch'));
  assert.equal(isIndependentOk(makeDrillEvent(dims, unassessed)), false);
});

test('each line is plain words, never a key name', () => {
  const { dims, unassessed } = dimsFromStep(step({ kind: 'rhythm' }), result());
  const lines = assessmentLines(dims, unassessed, { step: step({ kind: 'rhythm' }), instrument: kbd });
  lines.forEach((l) => {
    assert.ok(!l.text.startsWith('pitch:'), l.text);
    assert.ok(!l.text.startsWith('onset:'), l.text);
    assert.ok(!l.text.startsWith('hold:'), l.text);
    assert.ok(!l.text.toLowerCase().startsWith('tune:'), l.text);
  });
});
