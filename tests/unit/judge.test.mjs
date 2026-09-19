import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgePitch, OCTAVE_POLICY } from '../../src/core/judge.js';

test('OCTAVE_POLICY assigns exact to every instrument except voice', () => {
  assert.equal(OCTAVE_POLICY.kbd, 'exact');
  assert.equal(OCTAVE_POLICY.gtr, 'exact');
  assert.equal(OCTAVE_POLICY.bass, 'exact');
  assert.equal(OCTAVE_POLICY.uke, 'exact');
  assert.equal(OCTAVE_POLICY.wind, 'exact');
  assert.equal(OCTAVE_POLICY.harp, 'exact');
  assert.equal(OCTAVE_POLICY.voice, 'nearest-octave');
});

const TABLE = [
  // policy, heard, target, expected ok, label
  ['exact', 60, 60, true, 'right note'],
  ['exact', 72, 60, false, 'wrong octave'],
  ['exact', 61, 60, false, 'wrong note'],
  ['fold', 60, 60, true, 'right note'],
  ['fold', 72, 60, true, 'wrong octave'],
  ['fold', 61, 60, false, 'wrong note'],
  ['nearest-octave', 60, 60, true, 'right note'],
  ['nearest-octave', 72, 60, true, 'wrong octave'],
  ['nearest-octave', 48, 60, true, 'wrong octave, other direction'],
  ['nearest-octave', 61, 60, false, 'wrong note'],
];

for (const [policy, heardMidi, targetMidi, expected, label] of TABLE) {
  test(`judgePitch(${policy}): ${label} (${heardMidi} vs ${targetMidi}) -> ok=${expected}`, () => {
    const result = judgePitch({ heardMidi, targetMidi, policy });
    assert.equal(result.ok, expected);
  });
}

test('judgePitch(exact): right pitch class wrong octave reports that reason', () => {
  const result = judgePitch({ heardMidi: 72, targetMidi: 60, policy: 'exact' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'right-pitch-class-wrong-octave');
});

test('judgePitch(exact): a different pitch class reports wrong-pitch-class', () => {
  const result = judgePitch({ heardMidi: 61, targetMidi: 60, policy: 'exact' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'wrong-pitch-class');
});

// One home for octave policy: the instrument records. The judge must not keep
// its own table, or the two drift (they did, the day both were written).
test('OCTAVE_POLICY is derived from the instrument records', async () => {
  const { INSTRUMENTS } = await import('../../src/instruments/index.js');
  for (const rec of INSTRUMENTS.filter((r) => r.status === 'ready')) {
    assert.equal(OCTAVE_POLICY[rec.id], rec.octavePolicy, rec.id);
  }
});

test('only the voice may answer in its own octave', async () => {
  const { INSTRUMENTS } = await import('../../src/instruments/index.js');
  const loose = INSTRUMENTS.filter((r) => r.octavePolicy !== 'exact').map((r) => r.id);
  assert.deepEqual(loose, ['voice']);
});
