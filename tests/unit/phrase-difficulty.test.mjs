import { test } from 'node:test';
import assert from 'node:assert/strict';

import { phraseDifficulty, orderByDifficulty, WEIGHTS } from '../../src/song/phrase-difficulty.js';
import { segment } from '../../src/song/lesson.js';
import { starterSongs } from '../../src/song/starter/index.js';

const BEAT = 480; // ticksPerQuarter for every starter song / test fixture below

function phrase(notes, { startTick = 0, endTick } = {}) {
  const lastEnd = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  return { bars: [0, 0], startTick, endTick: endTick ?? Math.max(lastEnd, startTick), notes };
}

function note(start, dur, midi) {
  return { start, dur, midi };
}

const C_MAJOR = { tonic: 0, mode: 'major' };

// ---- bounds ----

test('score and every part are within 0..1', () => {
  const cases = [
    phrase([]),
    phrase([note(0, BEAT, 60)]),
    phrase([note(0, 60, 60), note(60, 60, 90), note(120, 60, 30), note(180, 60, 100)]),
    phrase([note(0, BEAT * 4, 60), note(BEAT * 4, BEAT * 4, 127)]),
  ];
  for (const p of cases) {
    const { score, parts } = phraseDifficulty(p, { beatTicks: BEAT, key: C_MAJOR });
    assert.ok(score >= 0 && score <= 1, 'score ' + score + ' out of bounds');
    for (const [name, v] of Object.entries(parts)) {
      assert.ok(v >= 0 && v <= 1, 'part ' + name + ' = ' + v + ' out of bounds');
    }
  }
});

test('weights are exported and sum to 1', () => {
  const total = Object.values(WEIGHTS).reduce((s, w) => s + w, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, 'weights summed to ' + total);
});

// ---- monotonicity: leaps ----

test('adding a leap raises the score while density, range and accidentals stay equal', () => {
  // Same pitch set {60,62,64,66,68}, all within C major except 66 (F#) which
  // both variants share, so accidentals is identical; same min/max (60/68)
  // so range is identical; same starts/durs so density and rhythm are
  // identical. Only the ORDER of pitches differs, which changes which
  // consecutive intervals exceed the leap threshold.
  const starts = [0, BEAT, BEAT * 2, BEAT * 3, BEAT * 4];
  const stepwise = phrase(starts.map((s, i) => note(s, BEAT, [60, 62, 64, 66, 68][i])));
  const leapy = phrase(starts.map((s, i) => note(s, BEAT, [60, 68, 64, 66, 62][i])));

  const a = phraseDifficulty(stepwise, { beatTicks: BEAT, key: C_MAJOR });
  const b = phraseDifficulty(leapy, { beatTicks: BEAT, key: C_MAJOR });

  assert.equal(a.parts.density, b.parts.density);
  assert.equal(a.parts.range, b.parts.range);
  assert.equal(a.parts.accidentals, b.parts.accidentals);
  assert.equal(a.parts.rhythm, b.parts.rhythm);
  assert.ok(b.parts.leaps > a.parts.leaps, 'leaps part did not rise');
  assert.ok(b.score > a.score, 'overall score did not rise');
});

// ---- monotonicity: accidentals ----

test('adding an accidental raises the score while density, range and leaps stay equal', () => {
  // C major diatonic notes 60,62,64,65,67 (C D E F G): every consecutive
  // interval is <=4 semitones (2,2,1,2), so leaps is 0 either way. Swapping
  // the middle note (E, midi 64) for Eb (midi 63) keeps both neighbouring
  // intervals <=4 (1 and 2) so leaps stays 0, and keeps min/max at 60/67 so
  // range is unchanged; only the key-membership of that one note changes.
  const starts = [0, BEAT, BEAT * 2, BEAT * 3, BEAT * 4];
  const diatonic = phrase(starts.map((s, i) => note(s, BEAT, [60, 62, 64, 65, 67][i])));
  const chromatic = phrase(starts.map((s, i) => note(s, BEAT, [60, 62, 63, 65, 67][i])));

  const a = phraseDifficulty(diatonic, { beatTicks: BEAT, key: C_MAJOR });
  const b = phraseDifficulty(chromatic, { beatTicks: BEAT, key: C_MAJOR });

  assert.equal(a.parts.density, b.parts.density);
  assert.equal(a.parts.range, b.parts.range);
  assert.equal(a.parts.leaps, b.parts.leaps);
  assert.equal(a.parts.rhythm, b.parts.rhythm);
  assert.ok(b.parts.accidentals > a.parts.accidentals, 'accidentals part did not rise');
  assert.ok(b.score > a.score, 'overall score did not rise');
});

// ---- monotonicity: syncopation ----

test('adding a syncopation raises the score while density, range, leaps and accidentals stay equal', () => {
  const pitches = [60, 62, 64, 65]; // same order & pitch set in both variants
  const onBeat = phrase([
    note(0, BEAT, pitches[0]),
    note(BEAT, BEAT, pitches[1]),
    note(BEAT * 2, BEAT, pitches[2]),
    note(BEAT * 3, BEAT, pitches[3]),
  ]);
  const syncopated = phrase([
    note(0, BEAT, pitches[0]),
    note(BEAT, BEAT * 0.5, pitches[1]),
    note(BEAT * 1.5, BEAT, pitches[2]), // starts off-beat, crosses the next beat line
    note(BEAT * 2.5, BEAT * 1.5, pitches[3]), // starts off-beat, crosses the next beat line
  ]);

  const a = phraseDifficulty(onBeat, { beatTicks: BEAT, key: C_MAJOR });
  const b = phraseDifficulty(syncopated, { beatTicks: BEAT, key: C_MAJOR });

  assert.equal(a.parts.density, b.parts.density);
  assert.equal(a.parts.range, b.parts.range);
  assert.equal(a.parts.leaps, b.parts.leaps);
  assert.equal(a.parts.accidentals, b.parts.accidentals);
  assert.ok(b.parts.rhythm > a.parts.rhythm, 'rhythm part did not rise');
  assert.ok(b.score > a.score, 'overall score did not rise');
});

// ---- whole-note scale vs sixteenth-note arpeggio ----

test('a whole-note scale scores below a sixteenth-note arpeggio', () => {
  const whole = phrase([
    note(0, BEAT * 4, 60),
    note(BEAT * 4, BEAT * 4, 62),
    note(BEAT * 8, BEAT * 4, 64),
    note(BEAT * 12, BEAT * 4, 65),
  ]);
  const sixteenth = BEAT / 4;
  const arpNotes = [];
  const arpPitches = [60, 67, 63, 72, 58, 70, 61, 75]; // wide leaps, fast, off-key
  for (let i = 0; i < arpPitches.length; i++) {
    arpNotes.push(note(i * sixteenth, sixteenth, arpPitches[i]));
  }
  const arpeggio = phrase(arpNotes);

  const w = phraseDifficulty(whole, { beatTicks: BEAT, key: C_MAJOR });
  const s = phraseDifficulty(arpeggio, { beatTicks: BEAT, key: C_MAJOR });
  assert.ok(w.score < s.score, 'whole-note scale (' + w.score + ') did not score below the arpeggio (' + s.score + ')');
});

// ---- stable ordering ----

test('orderByDifficulty is a stable ascending sort that keeps the original index', () => {
  const easy = phrase([note(0, BEAT * 4, 60)]);
  const hardA = phrase([note(0, 60, 60), note(60, 60, 90), note(120, 60, 30)]);
  const hardB = phrase([note(0, 60, 62), note(60, 60, 92), note(120, 60, 32)]);
  const phrases = [hardA, easy, hardB]; // two equally-hard entries, one easy

  const ordered = orderByDifficulty(phrases, { beatTicks: BEAT, key: C_MAJOR });

  assert.equal(ordered.length, 3);
  assert.equal(ordered[0].index, 1); // easy sorts first
  assert.equal(ordered[0].phrase, easy);
  // hardA (index 0) and hardB (index 2) tie or are close; whichever order,
  // each entry must carry its ORIGINAL index and the original phrase object.
  const remaining = ordered.slice(1).map(o => o.index).sort((a, b) => a - b);
  assert.deepEqual(remaining, [0, 2]);
  ordered.forEach(o => assert.equal(o.phrase, phrases[o.index]));
  // scores are non-decreasing
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(ordered[i].difficulty.score >= ordered[i - 1].difficulty.score);
  }
});

test('orderByDifficulty keeps original array order for exact ties', () => {
  const p1 = phrase([note(0, BEAT, 60)]);
  const p2 = phrase([note(0, BEAT, 60)]);
  const p3 = phrase([note(0, BEAT, 60)]);
  const ordered = orderByDifficulty([p1, p2, p3], { beatTicks: BEAT, key: C_MAJOR });
  assert.deepEqual(ordered.map(o => o.index), [0, 1, 2]);
});

// ---- every starter song's segment() output ----

test('every starter song phrase scores a finite number in 0..1', () => {
  for (const song of starterSongs) {
    const beatTicks = song.ticksPerQuarter * (4 / song.metre.den);
    for (const part of song.parts) {
      const phrases = segment(song, part.id);
      for (const p of phrases) {
        const { score, parts } = phraseDifficulty(p, { beatTicks, key: song.key });
        assert.ok(Number.isFinite(score), song.id + '/' + part.id + ' produced a non-finite score');
        assert.ok(score >= 0 && score <= 1, song.id + '/' + part.id + ' score out of bounds: ' + score);
        for (const [name, v] of Object.entries(parts)) {
          assert.ok(Number.isFinite(v), song.id + '/' + part.id + ' part ' + name + ' non-finite');
        }
      }
    }
  }
});
