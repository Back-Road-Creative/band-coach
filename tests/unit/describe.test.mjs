import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeTask } from '../../src/ui/describe.js';

function el(info, extra) {
  return Object.assign({ id: 'x', info, failed: false, t0: 0, rt: 0, reveal: false }, extra);
}

test('describeTask: no task gives a neutral prompt', () => {
  assert.equal(describeTask(null, {}), 'Pick an instrument, then press Start.');
});

test('describeTask: staff note, unrevealed, describes position not the name', () => {
  // E4 on a treble staff: written E4 -> step = oct*7+letter = 4*7+2 = 30, bottomStep(treble)=30, diff=0 -> bottom line.
  // Use a note two steps up (F4-ish letter F index 3) to land on "second line": diff should be 2.
  const info = { kind: 'note', clef: 'treble', written: 65, label: 'G4', short: 'G4' };
  const task = { kind: 'one', idx: 0, els: [el(info, { reveal: false })] };
  const sentence = describeTask(task, { revealed: false });
  assert.equal(sentence, 'Treble staff. Find and play this note: second line.');
});

test('describeTask: staff note, revealed, names the note', () => {
  const info = { kind: 'note', clef: 'treble', written: 65, label: 'G4', short: 'G4' };
  const task = { kind: 'one', idx: 0, els: [el(info, { reveal: true })] };
  const sentence = describeTask(task, { revealed: true });
  assert.equal(sentence, 'Treble staff. Play this note: G4 — second line.');
});

test('describeTask: bass staff note position', () => {
  const info = { kind: 'note', clef: 'bass', written: 43, label: 'G2', short: 'G2' };
  const task = { kind: 'one', idx: 0, els: [el(info, { reveal: false })] };
  const sentence = describeTask(task, { revealed: false });
  assert.match(sentence, /^Bass staff\. Find and play this note: /);
});

test('describeTask: rhythm bar mirrors the cell sequence', () => {
  const task = {
    kind: 'bar',
    idx: 0,
    els: [
      el({ kind: 'cell', label: 'quarter note', short: 'quarter note' }),
      el({ kind: 'cell', label: 'two eighths', short: 'two eighths' }),
      el({ kind: 'cell', label: 'quarter note', short: 'quarter note' }),
      el({ kind: 'cell', label: 'quarter note', short: 'quarter note' }),
    ],
  };
  const sentence = describeTask(task, { revealed: true });
  assert.equal(sentence, 'Rhythm: quarter note, two eighths, quarter note, quarter note. Tap along after the count-in.');
});

test('describeTask: keyboard note, unrevealed, does not leak the name', () => {
  const info = { kind: 'note', midi: 60, label: 'C4', short: 'C4' };
  const task = { kind: 'one', idx: 0, els: [el(info, { reveal: false })] };
  const sentence = describeTask(task, { revealed: false });
  assert.equal(sentence, 'Piano keyboard. Find and play this note.');
  assert.ok(!sentence.includes('C4'));
});

test('describeTask: keyboard note, revealed, names it', () => {
  const info = { kind: 'note', midi: 60, label: 'C4', short: 'C4' };
  const task = { kind: 'one', idx: 0, els: [el(info, { reveal: true })] };
  const sentence = describeTask(task, { revealed: true });
  assert.equal(sentence, 'Piano keyboard. Play this note: C4.');
});

test('describeTask: fretted string note hides string/fret and name until revealed', () => {
  const info = { kind: 'note', midi: 40, string: 6, fret: 0, label: 'E2: string 6, open', short: 'E2 (string 6)' };
  const task = { kind: 'one', idx: 0, els: [el(info, { reveal: false })] };
  const sentence = describeTask(task, { revealed: false });
  assert.equal(sentence, 'Fretboard. Find and play this note.');
});

test('describeTask: fretted string note reveals string and fret', () => {
  const info = { kind: 'note', midi: 40, string: 6, fret: 0, label: 'E2: string 6, open', short: 'E2 (string 6)' };
  const task = { kind: 'one', idx: 0, els: [el(info, { reveal: true })] };
  const sentence = describeTask(task, { revealed: true });
  assert.equal(sentence, 'Fretboard. Play this note: E2 — string 6, open.');
});

test('describeTask: find-by-name (anywhere) item never gives the name away unrevealed', () => {
  const info = { kind: 'note', midi: 64, anywhere: true, label: 'E, anywhere', short: 'E by name' };
  const task = { kind: 'one', idx: 0, els: [el(info, { reveal: false })] };
  const sentence = describeTask(task, { revealed: false });
  assert.equal(sentence, 'Find and play this note by name, anywhere on the instrument.');
});

test('describeTask: chord is always named since the canvas always shows the symbol', () => {
  const info = { kind: 'chord', pcs: [0, 4, 7], label: 'C major', short: 'C major', sym: 'C' };
  const task = { kind: 'chord', idx: 0, els: [el(info, { reveal: false })] };
  const sentence = describeTask(task, { revealed: false });
  assert.equal(sentence, 'Play the chord: C major.');
});

test('describeTask: hold task adds the hold instruction', () => {
  const info = { kind: 'note', midi: 60, label: 'C4', short: 'C4' };
  const task = { kind: 'hold', idx: 0, els: [el(info, { reveal: true })] };
  const sentence = describeTask(task, { revealed: true });
  assert.equal(sentence, 'Piano keyboard. Play this note: C4. Hold it for two seconds.');
});

test('describeTask: voice degree from tonic, unrevealed', () => {
  const info = { kind: 'note', midi: 64, degree: 4, tonic: 60, label: 'Mi (E4)', short: 'Mi' };
  const task = { kind: 'one', idx: 0, els: [el(info, { reveal: false })], ref: 'tonic' };
  const sentence = describeTask(task, { revealed: false });
  assert.equal(sentence, 'Find this note by ear, counting up from Do.');
});

test('describeTask: voice degree matched against a target, unrevealed', () => {
  const info = { kind: 'note', midi: 64, degree: 4, tonic: 60, label: 'Mi (E4)', short: 'Mi' };
  const task = { kind: 'one', idx: 0, els: [el(info, { reveal: false })], ref: 'target' };
  const sentence = describeTask(task, { revealed: false });
  assert.equal(sentence, 'Sing back the note you just heard, in any octave.');
});

test('describeTask: sequence task counts the move', () => {
  const info1 = { kind: 'note', midi: 60, label: 'C4', short: 'C4' };
  const info2 = { kind: 'note', midi: 62, label: 'D4', short: 'D4' };
  const task = { kind: 'seq', idx: 1, els: [el(info1, { reveal: true }), el(info2, { reveal: true })] };
  const sentence = describeTask(task, { revealed: true });
  assert.equal(sentence, 'Move 2 of 2. Piano keyboard. Play this note: D4.');
});

test('describeTask: ear task before the answer is revealed names neither answer', () => {
  const info = { kind: 'interval', semi: 7, dir: 'a', label: 'Perfect fifth', short: 'Perfect fifth' };
  const task = { kind: 'ear', idx: 0, els: [el(info)], choices: ['i2a', 'i4a', 'i7a'], revealed: false };
  const sentence = describeTask(task, { revealed: false });
  assert.equal(sentence, 'Ear training: listen, then choose the interval you heard from 3 options.');
});

test('describeTask: ear task after answering names the interval', () => {
  const info = { kind: 'interval', semi: 7, dir: 'a', label: 'Perfect fifth', short: 'Perfect fifth' };
  const task = { kind: 'ear', idx: 0, els: [el(info)], choices: ['i2a', 'i4a', 'i7a'], revealed: true };
  const sentence = describeTask(task, { revealed: true });
  assert.equal(sentence, 'That was a Perfect fifth.');
});

test('describeTask: ear task for a chord quality', () => {
  const info = { kind: 'quality', pcs: [0, 4, 7], label: 'Major chord', short: 'Major chord' };
  const task = { kind: 'ear', idx: 0, els: [el(info)], choices: ['qmaj', 'qmin'], revealed: false };
  const sentence = describeTask(task, { revealed: false });
  assert.equal(sentence, 'Ear training: listen, then choose the chord you heard from 2 options.');
});
