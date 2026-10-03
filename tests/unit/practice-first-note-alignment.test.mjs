// Q4b-F: a wrong first note is named as the extra note, not as a missed note
// the learner played. judgeAttempt used to give each single expected note the
// FIRST forward pitch match, so D D C D E E E for E D C D E E E let the first
// expected E take the fifth event and turned the D, C, D the learner played
// into misses ("Missed the D4 -- 3 of 7 notes."). A step of single notes now
// keeps the greedy answer when it already scores as many hits as any
// in-order matching can, and otherwise matches on the longest in-order
// matching. Chord, onset-only and drum steps are not touched.
// The "legacy" literals below were recorded from a run at the parent commit
// (before this change) and pinned; the exhaustive test uses its own
// independent greedy and brute-force LCS, never the code under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeAttempt, firstCorrection } from '../../src/ui/songs/practice.js';

const T = { bpm: 100, ticksPerQuarter: 480, policy: 'exact' };
const UNTIMED = { ...T, timed: false };
const EXPECTED = [64, 62, 60, 62, 64, 64, 64]; // E D C D E E E
const notesOf = (midis) => midis.map((midi, i) => ({ start: i * 480, dur: i === midis.length - 1 ? 960 : 480, midi }));
const NOTES = notesOf(EXPECTED);
const untimedPlay = (midis) => midis.map((midi, i) => ({ midi, atSec: i * 0.35 }));
const timedPlay = (midis) => midis.map((midi, i) => ({ midi, atSec: i * 0.6 }));
const EXTRAS_RULE = { hitRate: 0.8, maxMeanErrorMs: null, maxExtras: 0 };
const EXTRA_D4 = 'An extra D4 crept in — just the written notes.';

const F1 = [62, 62, 60, 62, 64, 64, 64]; // D D C D E E E: the wrong first note
const C1 = [64, 62, 60, 62, 62, 64, 64]; // E D C D D E E: a wrong note in the middle
const D = [64, 62, 60, 62, 64]; // E D C D E: two notes missing
const E = [64, 62, 60, 65, 62, 64, 64, 64]; // E D C F D E E E: one extra note

const r6 = (x) => (x === null ? null : Math.round(x * 1e6) / 1e6 + 0);
function digest(res, played) {
  const at = (ev) => (ev ? played.indexOf(ev) : -1);
  return {
    hit: res.hitCount, judged: res.judgedCount, rate: r6(res.hitRate), meanErr: r6(res.meanErrorMs),
    ok: res.matches.map((m) => m.ok), at: res.matches.map((m) => at(m.played)), err: res.matches.map((m) => r6(m.errorMs)),
    pitchOk: res.matches.map((m) => (m.pitchOk === undefined ? null : m.pitchOk)), pieceOk: res.matches.map((m) => (m.pieceOk === undefined ? null : m.pieceOk)),
    extras: res.extras.list.map(at),
  };
}

test('U1: a wrong first note is one missed note and one extra, the rest are hits (untimed)', () => {
  const played = untimedPlay(F1);
  const r = judgeAttempt(NOTES, played, UNTIMED);
  assert.equal(r.hitCount, 6);
  assert.equal(r.judgedCount, 7);
  assert.equal(r.matches[0].ok, false);
  assert.equal(r.matches[0].note.midi, 64);
  for (let i = 1; i < 7; i++) assert.equal(r.matches[i].ok, true, 'note ' + i);
  assert.equal(r.matches[1].played, played[0]);
  assert.equal(r.extras.count, 1);
  assert.equal(r.extras.list[0], played[1]);
});

test('U2: at levels 1-3 the wrong first note is named as the extra D4', () => {
  const r = judgeAttempt(NOTES, untimedPlay(F1), UNTIMED);
  assert.equal(firstCorrection(r, EXTRAS_RULE), EXTRA_D4);
});

test('U3: at level 4 the same try says the E4 was missed', () => {
  const r = judgeAttempt(NOTES, untimedPlay(F1), UNTIMED);
  assert.equal(firstCorrection(r, { hitRate: 0.86, maxMeanErrorMs: null, maxExtras: 0 }), 'Missed the E4 — 6 of 7 notes.');
});

test('U4: a mic-heard wrong first note is still exempt from the extras', () => {
  const played = untimedPlay(F1);
  played[1] = { ...played[1], source: 'mic' };
  const r = judgeAttempt(NOTES, played, UNTIMED);
  assert.equal(r.extras.count, 0);
  assert.equal(r.hitCount, 6);
});

// Recorded from a run at the parent commit (first-match search), before this change.
const PINS = {
  c1: { hit: 6, judged: 7, rate: 0.857143, meanErr: null, ok: [true, true, true, true, true, true, false], at: [0, 1, 2, 3, 5, 6, -1], err: [null, null, null, null, null, null, null], pitchOk: [null, null, null, null, null, null, null], pieceOk: [null, null, null, null, null, null, null], extras: [4] },
  d: { hit: 5, judged: 7, rate: 0.714286, meanErr: null, ok: [true, true, true, true, true, false, false], at: [0, 1, 2, 3, 4, -1, -1], err: [null, null, null, null, null, null, null], pitchOk: [null, null, null, null, null, null, null], pieceOk: [null, null, null, null, null, null, null], extras: [] },
  e: { hit: 7, judged: 7, rate: 1, meanErr: null, ok: [true, true, true, true, true, true, true], at: [0, 1, 2, 4, 5, 6, 7], err: [null, null, null, null, null, null, null], pitchOk: [null, null, null, null, null, null, null], pieceOk: [null, null, null, null, null, null, null], extras: [3] },
  fullTimed: { hit: 7, judged: 7, rate: 1, meanErr: 0, ok: [true, true, true, true, true, true, true], at: [0, 1, 2, 3, 4, 5, 6], err: [0, 0, 0, 0, 0, 0, 0], pitchOk: [null, null, null, null, null, null, null], pieceOk: [null, null, null, null, null, null, null], extras: [] },
  dTimed: { hit: 5, judged: 7, rate: 0.714286, meanErr: 0, ok: [true, true, true, true, true, false, false], at: [0, 1, 2, 3, 4, -1, -1], err: [0, 0, 0, 0, 0, null, null], pitchOk: [null, null, null, null, null, null, null], pieceOk: [null, null, null, null, null, null, null], extras: [] },
  bounce: { hit: 1, judged: 1, rate: 1, meanErr: 100, ok: [true], at: [0], err: [-100], pitchOk: [null], pieceOk: [null], extras: [] },
  chord: { hit: 3, judged: 3, rate: 1, meanErr: 203.333333, ok: [true, true, true], at: [1, 2, 3], err: [300, 310, 0], pitchOk: [null, null, null], pieceOk: [null, null, null], extras: [] },
  onsets: { hit: 3, judged: 3, rate: 1, meanErr: 26.666667, ok: [true, true, true], at: [0, 1, 2], err: [50, 20, -10], pitchOk: [false, true, false], pieceOk: [null, null, null], extras: [] },
  drums: { hit: 2, judged: 2, rate: 1, meanErr: 15, ok: [true, true], at: [0, 1], err: [20, 10], pitchOk: [null, null], pieceOk: [false, true], extras: [] },
};
const pin = (name, res, played, literal) => assert.deepEqual(digest(res, played), literal, name);
const SENT = (res, rule = EXTRAS_RULE) => firstCorrection(res, rule);

test('U5: tries greedy already scores best keep their sentence and their result', () => {
  for (const [name, midis, sentence, literal] of [
    ['c1', C1, EXTRA_D4, PINS.c1], ['d', D, 'Missed the E4 — 5 of 7 notes.', PINS.d], ['e', E, 'An extra F4 crept in — just the written notes.', PINS.e],
  ]) {
    const played = untimedPlay(midis);
    const r = judgeAttempt(NOTES, played, UNTIMED);
    assert.equal(SENT(r), sentence, name);
    pin(name, r, played, literal);
  }
});

test('U6: a try that hits every note, or that greedy scores best, is unchanged', () => {
  const full = timedPlay(EXPECTED);
  pin('full-timed', judgeAttempt(NOTES, full, T), full, PINS.fullTimed);
  const dTimed = timedPlay(D);
  pin('d-timed', judgeAttempt(NOTES, dTimed, T), dTimed, PINS.dTimed);
  // a key bounce: the first E is 100 ms early, the second is on the beat; greedy hit the note, so it keeps the first
  const bounce = [{ midi: 64, atSec: 0.5 }, { midi: 64, atSec: 0.6 }];
  const r = judgeAttempt([{ start: 480, dur: 480, midi: 64 }], bounce, T);
  assert.equal(r.matches[0].played, bounce[0]);
  assert.equal(r.extras.count, 0);
  pin('bounce', r, bounce, PINS.bounce);
});

test('U7: chord steps, onset-only steps and drum steps are not touched', () => {
  const chordNotes = [{ start: 0, dur: 480, midi: 64 }, { start: 0, dur: 480, midi: 67 }, { start: 480, dur: 480, midi: 62 }];
  const chordPlayed = [{ midi: 60, atSec: 0 }, { midi: 64, atSec: 0.3 }, { midi: 67, atSec: 0.31 }, { midi: 62, atSec: 0.6 }];
  pin('chord', judgeAttempt(chordNotes, chordPlayed, T), chordPlayed, PINS.chord);
  const onsetPlayed = [{ midi: 60, atSec: 0.05 }, { midi: 62, atSec: 0.62 }, { midi: 64, atSec: 1.19 }];
  pin('onsets', judgeAttempt(notesOf([64, 62, 60]), onsetPlayed, { ...T, onsetsOnly: true }), onsetPlayed, PINS.onsets);
  const drumNotes = [{ start: 0, dur: 240, midi: 38, piece: 'snare' }, { start: 480, dur: 240, midi: 35, piece: 'kick' }];
  const drumPlayed = [{ atSec: 0.02, piece: 'kick' }, { atSec: 0.61, piece: 'kick' }];
  pin('drums', judgeAttempt(drumNotes, drumPlayed, { ...T, percussion: true }), drumPlayed, PINS.drums);
});

test('U8: a wrong first note on the beat is matched in time, so no note is called early', () => {
  const played = timedPlay(F1);
  const r = judgeAttempt(NOTES, played, T);
  assert.equal(r.hitCount, 6);
  assert.equal(r.matches[1].played, played[1]);
  for (const m of r.matches.filter((x) => x.ok)) assert.ok(Math.abs(m.errorMs) < 1e-6, 'error ' + m.errorMs);
  assert.equal(r.extras.list[0], played[0]);
  assert.equal(SENT(r, { hitRate: 0.8, maxMeanErrorMs: 150, maxExtras: 0 }), EXTRA_D4);
});

// Independent oracles: the old first-match search, and a brute-force longest in-order matching.
function legacy(target, played) {
  let cursor = 0; let hit = 0; const at = []; const extras = [];
  for (const t of target) {
    let f = -1;
    for (let i = cursor; i < played.length; i++) if (played[i].midi === t) { f = i; break; }
    if (f === -1) { at.push(-1); continue; }
    for (let i = cursor; i < f; i++) extras.push(i);
    at.push(f); hit++; cursor = f + 1;
  }
  return { hit, at, extras };
}
function bestInOrder(target, played) {
  let best = 0;
  const go = (i, j, n) => { best = Math.max(best, n); if (i === target.length || j === played.length) return; go(i + 1, j, n); if (target[i] === played[j]) go(i + 1, j + 1, n + 1); go(i, j + 1, n); };
  go(0, 0, 0);
  return best;
}

test('U9: every try over three notes scores the best in-order total, and keeps greedy where greedy was already best', () => {
  const target = [64, 62, 60, 62];
  const tNotes = notesOf(target);
  const lists = [[]];
  for (let len = 1; len <= 5; len++) for (const prev of lists.filter((l) => l.length === len - 1)) for (const m of [60, 62, 64]) lists.push([...prev, m]);
  assert.equal(lists.length, 364);
  let aligned = 0;
  for (const midis of lists) {
    for (const timed of [false, true]) {
      const played = timed ? timedPlay(midis) : untimedPlay(midis);
      const r = judgeAttempt(tNotes, played, timed ? T : UNTIMED);
      const best = bestInOrder(target, midis);
      const old = legacy(target, played);
      const label = (timed ? 'timed ' : 'untimed ') + midis.join(',');
      assert.equal(r.hitCount, best, label);
      if (old.hit === best) {
        assert.deepEqual(r.matches.map((m) => (m.played ? played.indexOf(m.played) : -1)), old.at, label);
        assert.deepEqual(r.extras.list.map((e) => played.indexOf(e)), old.extras, label);
      } else aligned++;
    }
  }
  assert.ok(aligned > 0, 'some tries must need the alignment');
});
