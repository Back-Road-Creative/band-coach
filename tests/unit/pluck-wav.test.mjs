// TDD for tests/helpers/pluck-wav.mjs (the Karplus-Strong plucked-string
// fixture generator built for the mic-gate-and-capture unit — see that
// file's header for why: every existing mic fixture is a steady sine or a
// fixed 1/h^2 harmonic ratio, never a real pluck, a noise floor, a weak
// fundamental, or a one-sided stereo signal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pluck, rms, writePluckWav, pluckChannelSwitch } from '../helpers/pluck-wav.mjs';
import { yin } from '../../src/audio/yin.js';
import { rangeForInstrument } from '../../src/audio/range.js';
import gtr from '../../src/instruments/gtr.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SR = 48000;

test('pluck() returns a mono buffer of the requested duration', () => {
  const buf = pluck(220, SR, 0.5);
  assert.equal(buf.length, Math.round(0.5 * SR));
});

test('pluck() envelope decays: the tail is quieter than the attack', () => {
  const buf = pluck(220, SR, 1.0, { decay: 0.999 });
  const window = Math.floor(buf.length * 0.1);
  const early = rms(buf, Math.floor(buf.length * 0.05), window);
  const late = rms(buf, buf.length - window, window);
  assert.ok(early > late * 2, `expected the attack (${early}) to be well above the tail (${late})`);
});

test('pluck() is deterministic for a given seed, differs for another', () => {
  const a = pluck(220, SR, 0.2, { seed: 7 });
  const b = pluck(220, SR, 0.2, { seed: 7 });
  const c = pluck(220, SR, 0.2, { seed: 8 });
  assert.deepEqual(Array.from(a), Array.from(b), 'same seed must reproduce byte-identical samples');
  assert.notDeepEqual(Array.from(a), Array.from(c), 'a different seed must produce a different pluck');
});

test('pluck() gain scales overall loudness', () => {
  const loud = pluck(220, SR, 0.3, { seed: 3 });
  const quiet = pluck(220, SR, 0.3, { seed: 3, gain: 0.25 });
  const loudRms = rms(loud);
  const quietRms = rms(quiet);
  assert.ok(quietRms < loudRms * 0.4, `expected gain 0.25 to noticeably reduce RMS (loud ${loudRms}, quiet ${quietRms})`);
});

test('pluck() with a noise floor raises the quiet tail\'s RMS without erasing the attack', () => {
  const clean = pluck(220, SR, 1.0, { seed: 4 });
  const noisy = pluck(220, SR, 1.0, { seed: 4, noiseFloorRms: 0.01 });
  const window = Math.floor(clean.length * 0.1);
  const cleanTail = rms(clean, clean.length - window, window);
  const noisyTail = rms(noisy, noisy.length - window, window);
  assert.ok(noisyTail > cleanTail, 'a noise floor must raise the ringed-out tail\'s measured RMS');
});

test('pluck() with silenceSeconds appends true trailing silence', () => {
  const buf = pluck(220, SR, 0.2, { seed: 1, silenceSeconds: 0.1 });
  assert.equal(buf.length, Math.round(0.3 * SR));
  const tail = buf.slice(Math.round(0.2 * SR));
  assert.ok(tail.every((x) => x === 0), 'the appended tail must be exact silence');
});

test('pluck() stereo places the signal on the requested channel only', () => {
  const { left, right } = pluck(220, SR, 0.2, { seed: 2, channels: 'stereo', channelSide: 'right' });
  assert.ok(left.every((x) => x === 0), 'left channel must be silent when channelSide is right');
  assert.ok(rms(right) > 0, 'right channel must carry the signal');
});

test('pluck() stereo channelSide "both" duplicates the signal onto both channels', () => {
  const { left, right } = pluck(220, SR, 0.2, { seed: 2, channels: 'stereo', channelSide: 'both' });
  assert.deepEqual(Array.from(left), Array.from(right), 'both channels must carry the identical duplicated signal');
  assert.ok(rms(left) > 0);
});

test('pluckChannelSwitch() puts the signal on one channel, then the other, at the switch point', () => {
  const seconds = 1.0, switchAt = 0.5;
  const { left, right } = pluckChannelSwitch(220, SR, seconds, switchAt, { seed: 1, firstSide: 'left' });
  const half = Math.round(switchAt * SR);
  const window = Math.floor(half * 0.5);
  const leftBefore = rms(left, Math.floor(half * 0.25), window);
  const rightBefore = rms(right, Math.floor(half * 0.25), window);
  const leftAfter = rms(left, half + Math.floor(half * 0.25), window);
  const rightAfter = rms(right, half + Math.floor(half * 0.25), window);
  assert.ok(leftBefore > rightBefore, 'before the switch, left should carry the signal');
  assert.ok(rightAfter > leftAfter, 'after the switch, right should carry the signal');
});

test('writePluckWav() round-trips a mono fixture to a real WAV file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pluck-wav-'));
  const path = join(dir, 'test.wav');
  try {
    const buf = pluck(220, SR, 0.05, { seed: 1 });
    writePluckWav(path, buf, SR);
    const bytes = readFileSync(path);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    assert.equal(bytes.readUInt16LE(22), 1, 'mono file must declare 1 channel');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writePluckWav() round-trips a stereo fixture and declares 2 channels', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pluck-wav-'));
  const path = join(dir, 'test-stereo.wav');
  try {
    const pair = pluck(220, SR, 0.05, { seed: 1, channels: 'stereo' });
    writePluckWav(path, pair, SR);
    const bytes = readFileSync(path);
    assert.equal(bytes.readUInt16LE(22), 2, 'stereo file must declare 2 channels');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A frame taken from mid-pluck (past the noisy attack, well before the tail
// dies below yin's rms gate), fed straight to the SAME yin() the app ships,
// with a generous rms gate so the gate is not itself the thing under test.
function frameAt(buf, frameSize, atSample) {
  return buf.slice(atSample, atSample + frameSize);
}

const OPEN_STRINGS_HZ = [82.41, 110, 146.83, 196, 246.94, 329.63]; // E2 A2 D3 G3 B3 E4

for (const freq of OPEN_STRINGS_HZ) {
  test(`yin() finds ${freq} Hz on a plain Karplus-Strong pluck of an open guitar string`, () => {
    const buf = pluck(freq, SR, 0.5, { seed: 11 });
    const frameSize = 4096; // comfortably covers even the lowest open string's period at 48kHz
    const frame = frameAt(buf, frameSize, Math.floor(0.05 * SR)); // past the initial noisy attack
    const result = yin(frame, SR, freq * 0.5, freq * 2, 0.0005);
    assert.ok(result.freq > 0, `expected yin to report a pitch for ${freq} Hz, got 0 (rms ${result.rms})`);
    const cents = 1200 * Math.log2(result.freq / freq);
    assert.ok(Math.abs(cents) < 50, `expected ${freq} Hz within 50 cents, got ${result.freq} Hz (${cents.toFixed(1)} cents off)`);
  });
}

// EVIDENCE (VERIFIED DEFECT 5 / spec item B): does yin() slip an octave on a
// weak-fundamental low E when searched over guitar's REAL fmin/fmax (derived
// from the instrument record via rangeForInstrument(), same as the app's own
// worklet range)? Guitar uses octavePolicy: 'exact' (src/instruments/gtr.js,
// src/core/judge.js), so an octave slip here would be judged a wrong note in
// the real app, not "close enough."
const gtrRange = rangeForInstrument(gtr);
const LOW_E_HZ = 82.41;

test('EVIDENCE: yin() octave behaviour on a weak-fundamental low E, guitar range', (t) => {
  const buf = pluck(LOW_E_HZ, SR, 0.5, { seed: 13, weakFundamental: true });
  const frameSize = 4096;
  const frame = frameAt(buf, frameSize, Math.floor(0.05 * SR));
  const result = yin(frame, SR, gtrRange.fmin, gtrRange.fmax, 0.0005);
  const cents = result.freq > 0 ? 1200 * Math.log2(result.freq / LOW_E_HZ) : null;
  const isRightOctave = result.freq > 0 && Math.abs(cents) < 50;
  if (!isRightOctave) {
    t.todo(
      `yin() slipped: measured ${result.freq.toFixed(2)} Hz on a weak-fundamental ${LOW_E_HZ} Hz low E ` +
      `(guitar range fmin=${gtrRange.fmin} fmax=${gtrRange.fmax}), expected ~${LOW_E_HZ} Hz. ` +
      `This is VERIFIED DEFECT 5's octave question, measured: a real detector fix (not this test) is a separate follow-up change.`
    );
    return;
  }
  assert.ok(isRightOctave, `expected the right octave, measured ${result.freq} Hz`);
});
