import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fitToInstrument, segment, buildLessonPlan, nextStep, creditFor } from '../../src/song/lesson.js';
import { difficultyLabel } from '../../src/ui/songs.js';
import gtr from '../../src/instruments/gtr.js';
import bass from '../../src/instruments/bass.js';
import harp from '../../src/instruments/harp.js';
import voice from '../../src/instruments/voice.js';

// ---------------------------------------------------------------------------
// An 8-bar, 4/4 hand-built song (ticksPerQuarter = 480, so a beat = 480 ticks
// and a bar = 1920 ticks). Deliberately mixes: a long note (bar 2), a rest gap
// (end of bar 3, end of bar 6) and a long run of short notes (bars 4-6) so
// segment() has to use every one of its break rules, not just the 4-bar cap.
// ---------------------------------------------------------------------------
function note(start, dur, midi) {
  return { start, dur, midi };
}

function eightBarSong(partId = 'melody') {
  const notes = [
    // bar 1: four quarter notes
    note(0, 480, 60), note(480, 480, 62), note(960, 480, 64), note(1440, 480, 65),
    // bar 2: one long note spanning the whole bar -> break after bar 2
    note(1920, 1920, 69),
    // bar 3: a note, then a rest of a full beat before the next -> break after bar 3
    note(3840, 480, 71), note(5280, 480, 72),
    // bars 4-6: sixteen back-to-back quarter notes, no gaps, no long notes
    note(5760, 480, 74), note(6240, 480, 72), note(6720, 480, 71), note(7200, 480, 69),
    note(7680, 480, 67), note(8160, 480, 65), note(8640, 480, 64), note(9120, 480, 62),
    note(9600, 480, 60),
    // rest of a full beat before the next note -> break after bar 6
    note(10560, 480, 62),
    // bars 7-8: eight more quarter notes, ends exactly at bar 8
    note(11520, 480, 64), note(12000, 480, 65), note(12480, 480, 67), note(12960, 480, 69),
    note(13440, 480, 71), note(13920, 480, 72), note(14400, 480, 74), note(14880, 480, 76)
  ];
  return {
    schema: 'song/1', id: 'test-song', title: 'Test Song', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100,
    ticksPerQuarter: 480,
    parts: [{ id: partId, name: 'Melody', notes }],
    chords: []
  };
}

// A run of six bars of continuous quarter notes with no rest and no long note
// anywhere: nothing but the 4-bar cap can force a break.
function sixBarNoBreakSong(partId = 'melody') {
  const notes = [];
  for (let bar = 0; bar < 6; bar++) {
    for (let beat = 0; beat < 4; beat++) {
      notes.push(note(bar * 1920 + beat * 480, 480, 60 + ((bar * 4 + beat) % 7)));
    }
  }
  return {
    schema: 'song/1', id: 'six-bar', title: 'Six Bar', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 120,
    ticksPerQuarter: 480,
    parts: [{ id: partId, name: 'Melody', notes }],
    chords: []
  };
}

// =====================  fitToInstrument  =====================

test('fitToInstrument leaves a song untouched when every note is already in range', () => {
  const song = eightBarSong();
  const fit = fitToInstrument(song, 'melody', gtr);
  assert.equal(fit.shiftSemitones, 0);
  assert.equal(fit.changed, false);
  assert.deepEqual(fit.unplayable, []);
  assert.equal(fit.notes.length, song.parts[0].notes.length);
  fit.notes.forEach((n, i) => assert.equal(n.midi, song.parts[0].notes[i].midi));
});

test('fitToInstrument octave-shifts a song that sits below a range down entirely', () => {
  // bass range is 28-55; shift the whole test song down two octaves (-24) so
  // it sits mostly out of range for anything else, then confirm bass pulls it
  // back into range with an octave shift, not a partial fix.
  const song = eightBarSong();
  song.parts[0].notes = song.parts[0].notes.map(n => ({ ...n, midi: n.midi + 36 })); // now 96..112, above bass range
  const fit = fitToInstrument(song, 'melody', bass);
  assert.notEqual(fit.shiftSemitones, 0);
  assert.ok(fit.shiftSemitones % 12 === 0, 'bass has no fixed pitch set, so only octave shifts are tried');
  assert.equal(fit.unplayable.length, 0);
  fit.notes.forEach(n => {
    assert.ok(n.midi >= bass.range.low && n.midi <= bass.range.high, 'note ' + n.midi + ' outside bass range');
  });
});

test('fitToInstrument reports notes it cannot fit rather than dropping them', () => {
  // bass spans 28-55 (27 semitones); no octave shift can fit a two-octave-plus
  // melodic span, so some notes must be reported as unplayable.
  const song = eightBarSong('melody');
  song.parts[0].notes = [
    note(0, 480, 30), note(480, 480, 90) // 60 semitones apart, wider than any single octave window
  ];
  const fit = fitToInstrument(song, 'melody', bass);
  assert.equal(fit.notes.length, 2, 'every input note must still appear in the output');
  assert.ok(fit.unplayable.length > 0, 'expected at least one note flagged unplayable');
  fit.unplayable.forEach(u => assert.equal(typeof u.reason, 'string'));
});

test('fitToInstrument finds a friendlier key for a C harmonica when notes fall off its fixed pitches', () => {
  // C4 (60) is hole 1 blow, on the harmonica; C#4 (61) is not one of the 19
  // fixed Richter pitches available on any hole.
  const song = eightBarSong();
  song.parts[0].notes = song.parts[0].notes.map(n => ({ ...n, midi: 61 })); // all C#4, unplayable on any hole
  const fit = fitToInstrument(song, 'melody', harp);
  assert.notEqual(fit.shiftSemitones, 0);
  assert.equal(fit.unplayable.length, 0, 'a one-semitone key change should make every note playable');
});

test('fitToInstrument on a harmonica prefers the smallest key change that works', () => {
  const song = eightBarSong();
  song.parts[0].notes = [note(0, 480, 60)]; // already playable (hole 1 blow)
  const fit = fitToInstrument(song, 'melody', harp);
  assert.equal(fit.shiftSemitones, 0);
});

test('fitToInstrument octave-shifts a voice range (nearest-octave policy) without touching pitch class', () => {
  const song = eightBarSong();
  song.parts[0].notes = song.parts[0].notes.map(n => ({ ...n, midi: n.midi + 24 })); // pushed high
  const fit = fitToInstrument(song, 'melody', voice);
  assert.ok(fit.shiftSemitones % 12 === 0);
});

// =====================  segment  =====================

test('segment cuts the 8-bar fixture at the long note, the two rests, and the end', () => {
  const song = eightBarSong();
  const phrases = segment(song, 'melody');
  assert.deepEqual(phrases.map(p => p.bars), [[0, 1], [2, 2], [3, 5], [6, 7]]);
  const totalNotes = phrases.reduce((n, p) => n + p.notes.length, 0);
  assert.equal(totalNotes, song.parts[0].notes.length);
});

test('segment never produces a phrase longer than 4 bars even with no natural break', () => {
  const song = sixBarNoBreakSong();
  const phrases = segment(song, 'melody');
  phrases.forEach(p => {
    const bars = p.bars[1] - p.bars[0] + 1;
    assert.ok(bars >= 1 && bars <= 4, 'phrase spans ' + bars + ' bars');
  });
  assert.deepEqual(phrases.map(p => p.bars), [[0, 3], [4, 5]]);
});

test('segment is deterministic across repeated calls', () => {
  const song = eightBarSong();
  const a = segment(song, 'melody');
  const b = segment(song, 'melody');
  assert.deepEqual(a, b);
});

test('segment returns no phrases for a part with no notes', () => {
  const song = eightBarSong();
  song.parts[0].notes = [];
  assert.deepEqual(segment(song, 'melody'), []);
});

// =====================  buildLessonPlan  =====================

test('buildLessonPlan produces the seven-stage progression per phrase plus chaining and a whole-piece step', () => {
  const song = eightBarSong();
  const plan = buildLessonPlan(song, 'melody', gtr, { level: 1 });
  const kindsInOrder = plan.steps.map(s => s.kind);
  // first phrase must open with listen -> rhythm -> pitches -> phrase-slow -> ladder rungs
  assert.deepEqual(kindsInOrder.slice(0, 4), ['listen', 'rhythm', 'pitches', 'phrase-slow']);
  assert.ok(kindsInOrder.filter(k => k === 'tempo-ladder').length >= 4, 'expected at least one ladder per phrase');
  assert.ok(kindsInOrder.includes('chain'), 'multi-phrase song should chain phrases');
  assert.equal(kindsInOrder[kindsInOrder.length - 1], 'whole');
  plan.steps.forEach(s => {
    assert.ok(Array.isArray(s.bars) && s.bars.length === 2);
    assert.ok(Array.isArray(s.notes));
  });
});

test('buildLessonPlan tempo ladder rises monotonically toward the song tempo', () => {
  const song = eightBarSong();
  const plan = buildLessonPlan(song, 'melody', gtr, { level: 1 });
  const firstPhraseLadder = plan.steps.filter(s => s.kind === 'tempo-ladder' && s.phraseIndex === 0).map(s => s.bpm);
  for (let i = 1; i < firstPhraseLadder.length; i++) {
    assert.ok(firstPhraseLadder[i] >= firstPhraseLadder[i - 1]);
  }
  assert.equal(firstPhraseLadder[firstPhraseLadder.length - 1], song.bpm);
});

test('buildLessonPlan raises the pass-rule bar for a higher level', () => {
  const song = eightBarSong();
  const low = buildLessonPlan(song, 'melody', gtr, { level: 1 });
  const high = buildLessonPlan(song, 'melody', gtr, { level: 6 });
  const lowRhythm = low.steps.find(s => s.kind === 'rhythm');
  const highRhythm = high.steps.find(s => s.kind === 'rhythm');
  assert.ok(highRhythm.passRule.hitRate >= lowRhythm.passRule.hitRate);
});

test('buildLessonPlan carries the instrument fit into the plan', () => {
  const song = eightBarSong();
  song.parts[0].notes = song.parts[0].notes.map(n => ({ ...n, midi: n.midi + 36 }));
  const plan = buildLessonPlan(song, 'melody', bass, { level: 1 });
  assert.notEqual(plan.fit.shiftSemitones, 0);
  plan.steps.forEach(s => {
    s.notes.forEach(n => assert.ok(n.midi >= bass.range.low && n.midi <= bass.range.high));
  });
});

// A run of three adjacent semitones (60, 61, 62): no single shift can land
// all three on the harmonica's fixed Richter pitches (no three consecutive
// semitones ever appear together in BLOW_STEPS/DRAW_STEPS -- checked by hand
// against src/instruments/how/harmonica.js), so fitToInstrument must always
// flag at least one of the three as unplayable, for any key.
function threeChromaticNotesSong(partId = 'melody') {
  const notes = [note(0, 480, 60), note(480, 480, 61), note(960, 480, 62)];
  return {
    schema: 'song/1', id: 'chromatic-song', title: 'Chromatic', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100,
    ticksPerQuarter: 480,
    parts: [{ id: partId, name: 'Melody', notes }],
    chords: []
  };
}

test('buildLessonPlan drops notes fitToInstrument could not fit on a fixed-pitch instrument from every step', () => {
  const song = threeChromaticNotesSong();
  const plan = buildLessonPlan(song, 'melody', harp, { level: 1 });
  assert.ok(plan.fit.unplayable.length > 0, 'expected the harmonica fit to flag at least one unplayable note');
  const unplayableMidis = new Set(plan.fit.unplayable.map(u => u.attemptedMidi));
  plan.steps.forEach(s => {
    s.notes.forEach(n => assert.ok(!unplayableMidis.has(n.midi),
      s.kind + ' step still contains an unplayable note (midi ' + n.midi + ')'));
  });
});

test('buildLessonPlan does not crash on a part with no notes at all', () => {
  const song = threeChromaticNotesSong();
  song.parts[0].notes = [];
  const plan = buildLessonPlan(song, 'melody', harp, { level: 1 });
  assert.deepEqual(plan.fit.unplayable, []);
  assert.deepEqual(plan.steps, []);
});

// =====================  phrase difficulty on steps  =====================

// A one-bar phrase built entirely from small stepwise motion (2 semitones
// between every note): the least difficult shape phraseDifficulty scores.
function stepwiseOneBarSong(partId = 'melody') {
  const notes = [note(0, 480, 60), note(480, 480, 62), note(960, 480, 64), note(1440, 480, 65)];
  return {
    schema: 'song/1', id: 'stepwise-song', title: 'Stepwise', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100,
    ticksPerQuarter: 480,
    parts: [{ id: partId, name: 'Melody', notes }],
    chords: []
  };
}

// Same rhythm and duration as stepwiseOneBarSong but built from wide leaps
// (an octave-plus each step): the phrase-difficulty module's own tests
// confirm leaps alone raise the score, so this must score higher.
function leapyOneBarSong(partId = 'melody') {
  const notes = [note(0, 480, 60), note(480, 480, 73), note(960, 480, 55), note(1440, 480, 79)];
  return {
    schema: 'song/1', id: 'leapy-song', title: 'Leapy', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100,
    ticksPerQuarter: 480,
    parts: [{ id: partId, name: 'Melody', notes }],
    chords: []
  };
}

test('buildLessonPlan attaches a numeric 0..1 difficulty to every per-phrase step', () => {
  const song = eightBarSong();
  const plan = buildLessonPlan(song, 'melody', gtr, { level: 1 });
  const perPhraseKinds = new Set(['listen', 'rhythm', 'pitches', 'phrase-slow', 'tempo-ladder']);
  plan.steps.filter(s => perPhraseKinds.has(s.kind)).forEach(s => {
    assert.equal(typeof s.difficulty, 'number', s.kind + ' step missing a numeric difficulty');
    assert.ok(s.difficulty >= 0 && s.difficulty <= 1, s.kind + ' difficulty ' + s.difficulty + ' out of bounds');
  });
});

test('buildLessonPlan scores a leap-heavy phrase harder than a stepwise one', () => {
  const stepwisePlan = buildLessonPlan(stepwiseOneBarSong(), 'melody', gtr, { level: 1 });
  const leapyPlan = buildLessonPlan(leapyOneBarSong(), 'melody', gtr, { level: 1 });
  const stepwiseListen = stepwisePlan.steps.find(s => s.kind === 'listen');
  const leapyListen = leapyPlan.steps.find(s => s.kind === 'listen');
  assert.ok(leapyListen.difficulty > stepwiseListen.difficulty,
    'leapy (' + leapyListen.difficulty + ') should score above stepwise (' + stepwiseListen.difficulty + ')');
});

// =====================  difficultyLabel (src/ui/songs.js)  =====================

test('difficultyLabel maps a 0..1 score to Easy/Medium/Hard', () => {
  assert.equal(difficultyLabel(0), 'Easy');
  assert.equal(difficultyLabel(0.33), 'Easy');
  assert.equal(difficultyLabel(0.34), 'Medium');
  assert.equal(difficultyLabel(0.66), 'Medium');
  assert.equal(difficultyLabel(0.67), 'Hard');
  assert.equal(difficultyLabel(1), 'Hard');
});

// =====================  nextStep  =====================

test('nextStep starts at step 0 with no history', () => {
  const plan = buildLessonPlan(eightBarSong(), 'melody', gtr, { level: 1 });
  assert.equal(nextStep(plan, []), 0);
});

test('nextStep repeats the same step on a single failure', () => {
  const plan = buildLessonPlan(eightBarSong(), 'melody', gtr, { level: 1 });
  const next = nextStep(plan, [{ stepIndex: 1, passed: false }]);
  assert.equal(next, 1);
});

test('nextStep advances to the next step on a pass', () => {
  const plan = buildLessonPlan(eightBarSong(), 'melody', gtr, { level: 1 });
  const next = nextStep(plan, [{ stepIndex: 1, passed: true }]);
  assert.equal(next, 2);
});

test('nextStep slows the tempo ladder down after two misses on the same rung', () => {
  const plan = buildLessonPlan(eightBarSong(), 'melody', gtr, { level: 1 });
  const ladderIdx = plan.steps.findIndex(s => s.kind === 'tempo-ladder' && s.phraseIndex === 0);
  const secondRung = ladderIdx + 1;
  assert.equal(plan.steps[secondRung].kind, 'tempo-ladder');
  const history = [
    { stepIndex: secondRung, passed: false },
    { stepIndex: secondRung, passed: false }
  ];
  const next = nextStep(plan, history);
  assert.equal(next, ladderIdx, 'should drop back to the previous, slower rung');
  assert.ok(plan.steps[next].bpm < plan.steps[secondRung].bpm);
});

test('nextStep skips ahead a rung after a clean first-try pass on the tempo ladder', () => {
  const plan = buildLessonPlan(eightBarSong(), 'melody', gtr, { level: 1 });
  const ladderIdx = plan.steps.findIndex(s => s.kind === 'tempo-ladder' && s.phraseIndex === 0);
  const next = nextStep(plan, [{ stepIndex: ladderIdx, passed: true }]);
  assert.ok(next > ladderIdx + 1, 'a clean first try should skip past the very next rung');
});

test('nextStep does not skip ahead when the pass came after a retry', () => {
  const plan = buildLessonPlan(eightBarSong(), 'melody', gtr, { level: 1 });
  const ladderIdx = plan.steps.findIndex(s => s.kind === 'tempo-ladder' && s.phraseIndex === 0);
  const history = [
    { stepIndex: ladderIdx, passed: false },
    { stepIndex: ladderIdx, passed: true }
  ];
  const next = nextStep(plan, history);
  assert.equal(next, ladderIdx + 1);
});

test('nextStep is a pure function of its inputs', () => {
  const plan = buildLessonPlan(eightBarSong(), 'melody', gtr, { level: 1 });
  const history = [{ stepIndex: 0, passed: true }];
  assert.equal(nextStep(plan, history), nextStep(plan, history));
});

// =====================  creditFor  =====================

test('creditFor counts every note in the step as judged when no override is given', () => {
  const step = { kind: 'rhythm', phraseIndex: 0, bars: [0, 0], bpm: 100, notes: [note(0, 480, 60), note(480, 480, 62)] };
  const credit = creditFor({ step, passed: true, elapsedMs: 30000 });
  assert.equal(credit.judged, 2);
  assert.equal(credit.ok, 2);
  assert.equal(credit.minutes, 0.5);
});

test('creditFor gives zero ok on a failed step but still records minutes and judged count', () => {
  const step = { kind: 'pitches', phraseIndex: 0, bars: [0, 0], bpm: 0, notes: [note(0, 480, 64)] };
  const credit = creditFor({ step, passed: false, elapsedMs: 15000 });
  assert.equal(credit.judged, 1);
  assert.equal(credit.ok, 0);
  assert.equal(credit.minutes, 0.25);
});

test('creditFor produces one mastery key per distinct pitch, not per note', () => {
  const step = { kind: 'rhythm', phraseIndex: 0, bars: [0, 0], bpm: 100, notes: [note(0, 240, 60), note(240, 240, 60), note(480, 240, 62)] };
  const credit = creditFor({ step, passed: true, elapsedMs: 10000 });
  assert.equal(credit.masteryKeys.length, 2);
  assert.deepEqual(credit.masteryKeys.map(k => k.key).sort(), ['midi:60', 'midi:62']);
  credit.masteryKeys.forEach(k => assert.equal(k.hit, true));
});

test('creditFor respects an explicit judgedCount override', () => {
  const step = { kind: 'whole', phraseIndex: null, bars: [0, 7], bpm: 100, notes: [note(0, 480, 60)] };
  const credit = creditFor({ step, passed: true, elapsedMs: 60000, judgedCount: 40 });
  assert.equal(credit.judged, 40);
  assert.equal(credit.ok, 40);
});

// creditFor + per-note `matches` (result.matches from src/ui/songs/practice.js
// judgeAttempt): a step that passes overall can still have missed one of its
// notes, and a step that fails overall can still have gotten some notes
// right -- mastery credit should reflect the NOTE's own outcome, not just
// the step's pass/fail, when matches is available.
test('creditFor with matches scores each note by its own outcome, not the step pass/fail', () => {
  const step = { kind: 'pitches', phraseIndex: 0, bars: [0, 0], bpm: 0, notes: [note(0, 480, 60), note(480, 480, 62)] };
  const matches = [
    { note: { midi: 60 }, ok: true, pitchOk: true },
    { note: { midi: 62 }, ok: false, pitchOk: null },
  ];
  // Step overall failed (a missed note failed the whole step), but the
  // first note was actually played correctly.
  const credit = creditFor({ step, passed: false, elapsedMs: 10000, matches });
  assert.deepEqual(credit.masteryKeys.sort((a, b) => a.key.localeCompare(b.key)), [
    { key: 'midi:60', hit: true },
    { key: 'midi:62', hit: false },
  ]);
});

test('creditFor with matches treats a clap-only hit (ok true, pitchOk false) as a miss', () => {
  const step = { kind: 'rhythm', phraseIndex: 0, bars: [0, 0], bpm: 100, notes: [note(0, 480, 60)] };
  const matches = [{ note: { midi: 60 }, ok: true, pitchOk: false }];
  const credit = creditFor({ step, passed: true, elapsedMs: 10000, matches });
  assert.deepEqual(credit.masteryKeys, [{ key: 'midi:60', hit: false }]);
});

test('creditFor with matches: a key hit once and missed once counts as missed', () => {
  const step = { kind: 'pitches', phraseIndex: 0, bars: [0, 0], bpm: 0, notes: [note(0, 240, 60), note(240, 240, 60)] };
  const matches = [
    { note: { midi: 60 }, ok: true, pitchOk: true },
    { note: { midi: 60 }, ok: false, pitchOk: null },
  ];
  const credit = creditFor({ step, passed: false, elapsedMs: 10000, matches });
  assert.deepEqual(credit.masteryKeys, [{ key: 'midi:60', hit: false }]);
});

test('creditFor falls back to step.notes + passed when matches is not given (back-compat)', () => {
  const step = { kind: 'pitches', phraseIndex: 0, bars: [0, 0], bpm: 0, notes: [note(0, 480, 60)] };
  const credit = creditFor({ step, passed: true, elapsedMs: 10000 });
  assert.deepEqual(credit.masteryKeys, [{ key: 'midi:60', hit: true }]);
});
