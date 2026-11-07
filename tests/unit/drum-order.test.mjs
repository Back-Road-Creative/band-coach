// The drum "right drums, right order, no clock" step (kind 'drum-order'):
// placed after listen and before rhythm for a percussion part only. Its
// judge ignores time entirely; saved stepIndexes from before the step existed
// resume on the same musical step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLessonPlan, nextStep, upgradeLegacyDrumEntry, DRUM_ORDER_TEMPO_TAG } from '../../src/song/lesson.js';
import { judgeAttempt, firstCorrection } from '../../src/ui/songs/practice.js';
import { passesRule } from '../../src/core/pass-rule.js';
import { phaseOf } from '../../src/core/teaching.js';
import { sanitizeLessonEntry } from '../../src/song/lesson-resume.js';
import drumKit from '../../src/instruments/drum-kit.js';
import gtr from '../../src/instruments/gtr.js';

const TPQ = 480;
const note = (start, piece) => ({ start, dur: 240, midi: 36, piece });
function song(notes, role = 'percussion') {
  return {
    schema: 'song/1', id: 's', title: 'S', composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: TPQ,
    parts: [{ id: 'kit', name: 'Kit', role, notes }], chords: [],
  };
}
// two bars so there are two phrases-worth of steps + chain + whole
const beat = [note(0, 'kick'), note(480, 'snare'), note(960, 'kick'), note(1440, 'snare')];
const hit = (piece, atSec, extra = {}) => ({ piece, atSec, source: 'midi', ...extra });
const judge = (played, notes = beat) => judgeAttempt(notes, played, { bpm: 0, ticksPerQuarter: TPQ, timed: false, percussion: true });
const rule = () => buildLessonPlan(song(beat), 'kit', drumKit).steps.find((s) => s.kind === 'drum-order').passRule;
const passes = (played, notes) => passesRule(judge(played, notes), rule());

test('plan shape: drum-order sits right after listen and before rhythm, with its own rule', () => {
  const plan = buildLessonPlan(song(beat), 'kit', drumKit);
  const kinds = plan.steps.map((s) => s.kind);
  assert.deepEqual(kinds.slice(0, 3), ['listen', 'drum-order', 'rhythm']);
  const step = plan.steps[1];
  assert.equal(step.bpm, 0);
  assert.equal(step.tempoScale, 0);
  assert.equal(step.passRule.maxMeanErrorMs, null);
  assert.equal(phaseOf(step), 'guided');
  assert.equal(plan.steps.filter((s) => s.kind === 'drum-order').length, plan.steps.filter((s) => s.kind === 'listen').length);
});

test('a non-percussion plan has no drum-order step and is unchanged', () => {
  const pitched = song([{ start: 0, dur: 480, midi: 60 }, { start: 480, dur: 480, midi: 62 }], 'melody');
  const plan = buildLessonPlan(pitched, 'kit', gtr);
  assert.equal(plan.steps.some((s) => s.kind === 'drum-order'), false);
  assert.deepEqual(plan.steps.slice(0, 4).map((s) => s.kind), ['listen', 'rhythm', 'pitches', 'phrase-slow']);
});

test('right drums in order pass at any pace: slow, fast, with a long pause', () => {
  const at = (...t) => beat.map((n, i) => hit(n.piece, t[i]));
  assert.equal(passes(at(0, 0.5, 1, 1.5)), true);
  assert.equal(passes(at(0, 1.67, 3.33, 5)), true, '0.3x');
  assert.equal(passes(at(0, 0.25, 0.5, 0.75)), true, '2x');
  assert.equal(passes(at(0, 0.5, 9.5, 10)), true, 'long pause');
  assert.equal(judge(at(0, 0.5, 1, 1.5)).meanErrorMs, null);
});

test('wrong drum, wrong order, missing and extra hits each fail with a plain message', () => {
  const swapped = [hit('snare', 0), hit('kick', 1), hit('kick', 2), hit('snare', 3)];
  assert.equal(passes(swapped), false);
  assert.match(firstCorrection(judge(swapped), rule()), /snare.*kick/);
  const wrong = [hit('kick', 0), hit('kick', 1), hit('kick', 2), hit('snare', 3)];
  assert.equal(passes(wrong), false);
  const missing = [hit('kick', 0), hit('snare', 1), hit('kick', 2)];
  assert.equal(passes(missing), false);
  assert.match(firstCorrection(judge(missing), rule()), /Missed a beat/);
  const extra = [...beat.map((n, i) => hit(n.piece, i)), hit('snare', 9)];
  assert.equal(passes(extra), false);
  assert.match(firstCorrection(judge(extra), rule()), /extra/i);
  assert.equal(passes([]), false);
});

test('a same-moment group is accepted in either order and needs no simultaneity', () => {
  const notes = [note(0, 'kick'), note(0, 'hihat-closed'), note(480, 'snare')];
  assert.equal(passes([hit('kick', 0), hit('hihat-closed', 0.01), hit('snare', 2)], notes), true);
  assert.equal(passes([hit('hihat-closed', 0), hit('kick', 3), hit('snare', 4)], notes), true);
  assert.equal(passes([hit('kick', 0), hit('snare', 1), hit('hihat-closed', 2)], notes), false, 'group hits must come before the next beat');
});

test('mic leniency: a mic hit that cannot be named is not held against the learner', () => {
  const notes = [note(0, 'kick'), note(480, 'tom-high'), note(960, 'snare')];
  const mic = (piece, t) => ({ piece, atSec: t, source: 'mic' });
  assert.equal(passes([mic('kick', 0), mic('snare', 5), mic('snare', 6)], notes), true, 'tom the mic cannot name');
  assert.equal(passes([mic(null, 0), mic(null, 1), mic(null, 2)], notes), true, 'nothing named at all');
  assert.equal(passes([mic('kick', 0), mic(null, 1), mic('kick', 2)], notes), false, 'a named wrong drum still fails');
  const hats = [note(0, 'hihat-open')];
  assert.equal(passes([mic('hihat', 0)], hats), true, 'generic mic hi-hat matches any hi-hat');
  assert.equal(passes([hit('hihat-closed', 0)], hats), false, 'a MIDI kit must name the exact hi-hat');
});

test('a failed attempt repeats the step, a pass moves on to rhythm', () => {
  const plan = buildLessonPlan(song(beat), 'kit', drumKit);
  assert.equal(nextStep(plan, [{ stepIndex: 1, passed: false }]), 1);
  assert.equal(nextStep(plan, [{ stepIndex: 1, passed: true }]), 2);
  assert.equal(plan.steps[2].kind, 'rhythm');
});

test('three failed tries in a row move on to rhythm, so a misheard hit can never wall off the song', () => {
  const plan = buildLessonPlan(song(beat), 'kit', drumKit);
  const i = plan.steps.findIndex((x) => x.kind === 'drum-order');
  assert.equal(plan.steps[i + 1].kind, 'rhythm');
  const fail = { stepIndex: i, passed: false };
  assert.equal(nextStep(plan, [fail]), i, 'first miss repeats');
  assert.equal(nextStep(plan, [fail, fail]), i, 'second miss repeats');
  assert.equal(nextStep(plan, [fail, fail, fail]), i + 1, 'third miss moves on');
  // Control: a pass between misses restarts the count, and a rhythm step still repeats however often it fails.
  assert.equal(nextStep(plan, [fail, fail, { stepIndex: i, passed: true }, fail]), i);
  const r = { stepIndex: i + 1, passed: false };
  assert.equal(nextStep(plan, [r, r, r]), i + 1);
});

test('timed percussion judging is unchanged (timed default still time-nearest)', () => {
  const r = judgeAttempt(beat, beat.map((n, i) => hit(n.piece, i * 0.6)), { bpm: 100, ticksPerQuarter: TPQ, percussion: true });
  assert.equal(r.matches.every((m) => m.errorMs != null), true);
});

// ---- saved progress ----
const twoBars = [...beat, ...beat.map((n) => note(n.start + 1920, n.piece))];
test('an old saved stepIndex resumes on the same musical step', () => {
  const plan = buildLessonPlan(song(twoBars), 'kit', drumKit);
  const oldKinds = plan.steps.filter((s) => s.kind !== 'drum-order').map((s) => ({ kind: s.kind, phraseIndex: s.phraseIndex, tempoScale: s.tempoScale }));
  assert.ok(plan.steps.length > oldKinds.length);
  const key = { songId: 's', rev: 'r', partId: 'kit', arrangement: 'a', setup: 'drum-kit|0||', tempo: '0:100', assist: 'shown' };
  oldKinds.forEach((old, oldIndex) => {
    const raw = { key, stepIndex: oldIndex, tail: [{ stepIndex: oldIndex, passed: false }], level: 1, rate: null };
    const clean = sanitizeLessonEntry(raw, oldKinds.length);
    const up = upgradeLegacyDrumEntry(plan, clean);
    const step = plan.steps[up.stepIndex];
    assert.deepEqual({ kind: step.kind, phraseIndex: step.phraseIndex, tempoScale: step.tempoScale }, old, 'old index ' + oldIndex);
    assert.deepEqual(up.tail, [{ stepIndex: up.stepIndex, passed: false }]);
    assert.equal(up.key.tempo, '0:100' + DRUM_ORDER_TEMPO_TAG);
  });
  assert.equal(upgradeLegacyDrumEntry(plan, { ...sanitizeLessonEntry({ key, stepIndex: 0, tail: [], level: 1, rate: null }), stepIndex: 999 }), null);
});

// #638: listenDrumKit (src/ui/songs.js) stops counting the mic only from the first real MIDI
// hit, so a mic onset heard before it (room noise in the count-in, the stick click before the
// first pad) is still in the take. Once a take has a MIDI hit, its mic hits are the e-kit's echo
// or noise and are not judged.
test('a mic hit heard before the first MIDI hit does not shift a drum-order take', () => {
  const played = [{ piece: 'snare', atSec: -0.3, source: 'mic' }, ...beat.map((n, i) => hit(n.piece, i * 0.5))];
  const r = judge(played);
  assert.equal(passes(played), true);
  assert.equal(r.extras.count, 0);
  assert.deepEqual(r.matches.map((m) => m.pieceOk), [true, true, true, true]);
});

test('a mic hit heard before the first MIDI hit is not an extra on a timed drum step', () => {
  const played = [{ piece: 'kick', atSec: 0.1, source: 'mic' }, ...beat.map((n, i) => hit(n.piece, i * 0.5))];
  const r = judgeAttempt(beat, played, { bpm: 120, ticksPerQuarter: TPQ, percussion: true });
  assert.equal(r.extras.count, 0);
});

test('a take with no MIDI hit still judges every mic hit', () => {
  const mic = beat.map((n, i) => ({ piece: n.piece, atSec: i * 0.5, source: 'mic' }));
  const r = judge([{ piece: 'snare', atSec: -0.3, source: 'mic' }, ...mic]);
  assert.equal(r.extras.count, 1);
});
