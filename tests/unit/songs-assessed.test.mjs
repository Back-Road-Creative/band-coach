import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dimsFromStep, assessmentLines } from '../../src/ui/songs/assessed.js';

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
