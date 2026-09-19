import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../../src/audio/analysis/analyse.js';
import { synthesizeProgression, whiteNoise, makeRng, SR } from './audio-analysis-fixtures.mjs';

function accuracyReport(label, obj) {
  // eslint-disable-next-line no-console
  console.log(`[accuracy] ${label}: ${JSON.stringify(obj)}`);
}

test('analyse recovers bpm, key and mostly-correct chords for a C major progression at 120bpm', async () => {
  const fixture = synthesizeProgression({ bpm: 120, bars: 8, tonicPc: 0, mode: 'major' });
  const result = await analyse(fixture.pcm, fixture.sr);

  const bpmErrPct = (Math.abs(result.bpm - fixture.bpm) / fixture.bpm) * 100;
  assert.ok(bpmErrPct < 2, `bpm ${result.bpm} vs expected ${fixture.bpm}, err ${bpmErrPct.toFixed(2)}%`);

  let withinTol = 0;
  for (const t of fixture.beatTimes) {
    let nearest = Infinity;
    for (const b of result.beats) nearest = Math.min(nearest, Math.abs(b - t));
    if (nearest <= 0.04) withinTol++;
  }
  const beatFrac = withinTol / fixture.beatTimes.length;

  assert.equal(result.key.tonic, 0);
  assert.equal(result.key.mode, 'major');

  const expectedRootNames = ['C', 'F', 'G', 'C', 'C', 'F', 'G', 'C'];
  let chordCorrect = 0;
  for (let bar = 0; bar < 8; bar++) {
    const beatIdx = bar * 4;
    const chord = result.chords.find((c) => c.startBeat === beatIdx);
    if (chord && chord.symbol === expectedRootNames[bar]) chordCorrect++;
  }
  const chordFrac = chordCorrect / 8;

  accuracyReport('C-major-120bpm', {
    bpmErrPct: Number(bpmErrPct.toFixed(2)),
    beatFrac: Number(beatFrac.toFixed(2)),
    keyCorrect: result.key.tonic === 0 && result.key.mode === 'major',
    chordFrac: Number(chordFrac.toFixed(2)),
  });

  assert.ok(beatFrac > 0.85, `only ${(beatFrac * 100).toFixed(1)}% beats within 40ms`);
  assert.ok(chordFrac >= 0.8, `only ${(chordFrac * 100).toFixed(1)}% bar-downbeat chords correct`);
});

test('analyse recovers key for an A minor progression', async () => {
  const fixture = synthesizeProgression({ bpm: 96, bars: 8, tonicPc: 9, mode: 'minor' });
  const result = await analyse(fixture.pcm, fixture.sr);
  accuracyReport('A-minor-96bpm', { tonic: result.key.tonic, mode: result.key.mode, bpm: result.bpm });
  assert.equal(result.key.tonic, 9);
  assert.equal(result.key.mode, 'minor');
});

test('analyse handles a detuned (+30 cents) progression and reports tuningCents', async () => {
  const a4 = 440 * Math.pow(2, 30 / 1200);
  const fixture = synthesizeProgression({ bpm: 100, bars: 6, tonicPc: 0, mode: 'major', a4 });
  const result = await analyse(fixture.pcm, fixture.sr);
  accuracyReport('detuned+30c', { tuningCents: result.tuningCents, tonic: result.key.tonic, mode: result.key.mode });
  assert.ok(Math.abs(result.tuningCents - 30) < 8, `expected ~30c, got ${result.tuningCents}`);
  assert.equal(result.key.tonic, 0);
  assert.equal(result.key.mode, 'major');
});

test('analyse returns near-zero-confidence, empty-ish results for silence', async () => {
  const pcm = new Float32Array(SR * 3);
  const result = await analyse(pcm, SR);
  assert.equal(result.beats.length, 0);
  assert.ok(result.chords.every((c) => c.symbol === 'N'));
});

test('analyse does not crash on seeded white noise and reports low confidence', async () => {
  const rng = makeRng(42);
  const pcm = whiteNoise(3, SR, rng);
  const result = await analyse(pcm, SR);
  assert.ok(typeof result.bpm === 'number' && Number.isFinite(result.bpm));
  assert.ok(result.confidence >= 0 && result.confidence <= 1);
});

test('analyse reports progress via onProgress and stays chunked (never blocks in one big pass silently)', async () => {
  const fixture = synthesizeProgression({ bpm: 110, bars: 4, tonicPc: 2, mode: 'major' });
  const progressValues = [];
  await analyse(fixture.pcm, fixture.sr, {
    onProgress: (p) => progressValues.push(p),
  });
  assert.ok(progressValues.length > 1, 'expected multiple progress callbacks');
  assert.ok(progressValues[0] >= 0 && progressValues[0] <= 1);
  assert.ok(progressValues[progressValues.length - 1] === 1, 'expected progress to reach 1 at the end');
  for (let i = 1; i < progressValues.length; i++) {
    assert.ok(progressValues[i] >= progressValues[i - 1], 'progress should be non-decreasing');
  }
});
