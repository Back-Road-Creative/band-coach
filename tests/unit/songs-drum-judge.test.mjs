// P4-11: drum judging -- which drum was hit, within what the mic can tell.
// buildLessonPlan (src/song/lesson.js) drops the "pitches" step for a
// percussion part (drums have no pitches) and adds minPieceRate to every
// timed step's pass rule; judgeAttempt (src/ui/songs/practice.js) judges a
// percussion step on onsets and also scores WHICH drum was hit, leniently
// where the mic genuinely cannot tell (see MIC_UNNAMEABLE).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLessonPlan } from '../../src/song/lesson.js';
import { judgeAttempt, passesRule, firstCorrection, MIC_UNNAMEABLE } from '../../src/ui/songs/practice.js';
import drumKit from '../../src/instruments/drum-kit.js';

const TPQ = 480;

function note(start, dur, midi, piece) {
  return { start, dur, midi, piece };
}

function drumSong(notes) {
  return {
    schema: 'song/1', id: 'drum-song', title: 'Drum Song', composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: TPQ,
    parts: [{ id: 'kit', name: 'Kit', role: 'percussion', notes }],
    chords: []
  };
}

test('a drum part has no any-speed step and asks for the right drum', () => {
  const song = drumSong([note(0, 480, 38, 'snare'), note(480, 480, 35, 'kick')]);
  const plan = buildLessonPlan(song, 'kit', drumKit, { level: 1 });
  assert.equal(plan.steps.some((s) => s.kind === 'pitches'), false, 'no pitches step for a percussion part');
  const timedKinds = ['rhythm', 'phrase-slow', 'tempo-ladder', 'whole'];
  plan.steps.filter((s) => timedKinds.includes(s.kind)).forEach((s) => {
    assert.equal(s.passRule.minPieceRate, 0.8, s.kind + ' should require minPieceRate 0.8');
  });
  const listenStep = plan.steps.find((s) => s.kind === 'listen');
  assert.equal(listenStep.passRule, null, 'listen still has no passRule');
});

test('MIDI hits on the right drums pass', () => {
  const expected = [note(0, 480, 35, 'kick'), note(480, 480, 38, 'snare')];
  const played = [
    { piece: 'kick', atSec: 0, source: 'midi' },
    { piece: 'snare', atSec: 0.5, source: 'midi' },
  ];
  const r = judgeAttempt(expected, played, { bpm: 100, ticksPerQuarter: TPQ, percussion: true });
  assert.deepEqual(r.matches.map((m) => m.pieceOk), [true, true]);
  assert.equal(r.pieceRate, 1);
  assert.equal(passesRule(r, { hitRate: 0.8, maxMeanErrorMs: 120, minPieceRate: 0.8 }), true);
});

test('a MIDI snare where the kick is wanted fails with a plain correction', () => {
  const expected = [note(0, 480, 35, 'kick')];
  const played = [{ piece: 'snare', atSec: 0, source: 'midi' }];
  const r = judgeAttempt(expected, played, { bpm: 100, ticksPerQuarter: TPQ, percussion: true });
  assert.equal(r.matches[0].pieceOk, false);
  assert.equal(r.pieceRate, 0);
  const passRule = { hitRate: 0.8, maxMeanErrorMs: 120, minPieceRate: 0.8 };
  assert.equal(passesRule(r, passRule), false);
  assert.equal(firstCorrection(r, passRule), 'That was the snare — this beat wants the bass drum.');
});

test('a mic hit on a tom beat is on time but its drum is not assessed', () => {
  const expected = [note(0, 480, 45, 'tom-mid')];
  const played = [{ piece: 'kick', atSec: 0, source: 'mic' }];
  const r = judgeAttempt(expected, played, { bpm: 100, ticksPerQuarter: TPQ, percussion: true });
  assert.equal(r.matches[0].ok, true, 'the onset itself was heard on time');
  assert.equal(r.matches[0].errorMs, 0);
  assert.equal(r.matches[0].pieceOk, null, 'the mic cannot name a tom, so this is not assessed');
  assert.equal(r.pieceRate, null);
});

test('an unnamed mic hit is never held against you', () => {
  const expected = [note(0, 480, 35, 'kick')];
  const played = [{ piece: null, atSec: 0, source: 'mic' }];
  const r = judgeAttempt(expected, played, { bpm: 100, ticksPerQuarter: TPQ, percussion: true });
  assert.equal(r.matches[0].ok, true);
  assert.equal(r.matches[0].pieceOk, null);
  assert.equal(r.pieceRate, null);
});

test("the mic's hi-hat covers open and closed hi-hat", () => {
  const expected = [note(0, 480, 42, 'hihat-closed'), note(480, 480, 46, 'hihat-open')];
  const played = [
    { piece: 'hihat', atSec: 0, source: 'mic' },
    { piece: 'hihat', atSec: 0.5, source: 'mic' },
  ];
  const r = judgeAttempt(expected, played, { bpm: 100, ticksPerQuarter: TPQ, percussion: true });
  assert.deepEqual(r.matches.map((m) => m.pieceOk), [true, true]);
  assert.equal(r.pieceRate, 1);
});

test('pieceRate is null when nothing could be named, and the step can still pass on timing', () => {
  const expected = [note(0, 480, 41, 'tom-floor'), note(480, 480, 49, 'crash')];
  const played = [
    { piece: null, atSec: 0, source: 'mic' },
    { piece: 'snare', atSec: 0.5, source: 'mic' }, // crash is MIC_UNNAMEABLE, so still not assessed
  ];
  const r = judgeAttempt(expected, played, { bpm: 100, ticksPerQuarter: TPQ, percussion: true });
  assert.equal(r.pieceRate, null);
  assert.equal(r.hitRate, 1);
  const passRule = { hitRate: 0.8, maxMeanErrorMs: 200, minPieceRate: 0.8 };
  assert.equal(passesRule(r, passRule), true, 'minPieceRate is ignored when pieceRate is null');
});

test('MIC_UNNAMEABLE lists exactly the pieces the mic cannot name', () => {
  assert.deepEqual([...MIC_UNNAMEABLE].sort(), ['crash', 'ride', 'tom-floor', 'tom-high', 'tom-mid'].sort());
});
