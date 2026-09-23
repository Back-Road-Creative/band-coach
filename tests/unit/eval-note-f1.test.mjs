import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreNotes } from '../../src/song/eval/note-f1.js';

test('identical reference and estimate score a perfect 1.0', () => {
  const notes = [
    { onset: 0.0, midi: 60 },
    { onset: 0.5, midi: 62 },
    { onset: 1.0, midi: 64 },
  ];
  const result = scoreNotes(notes, notes.map((n) => ({ ...n })));
  assert.equal(result.precision, 1);
  assert.equal(result.recall, 1);
  assert.equal(result.f1, 1);
  assert.equal(result.matched, 3);
  assert.equal(result.ref, 3);
  assert.equal(result.est, 3);
});

test('a note shifted 40ms is still within the 50ms onset tolerance', () => {
  const ref = [{ onset: 1.0, midi: 60 }];
  const est = [{ onset: 1.04, midi: 60 }];
  const result = scoreNotes(ref, est);
  assert.equal(result.matched, 1);
  assert.equal(result.f1, 1);
});

test('a note shifted 60ms is outside the 50ms onset tolerance and misses', () => {
  const ref = [{ onset: 1.0, midi: 60 }];
  const est = [{ onset: 1.06, midi: 60 }];
  const result = scoreNotes(ref, est);
  assert.equal(result.matched, 0);
  assert.equal(result.precision, 0);
  assert.equal(result.recall, 0);
  assert.equal(result.f1, 0);
});

test('a matching onset with the wrong pitch does not match', () => {
  const ref = [{ onset: 1.0, midi: 60 }];
  const est = [{ onset: 1.0, midi: 61 }];
  const result = scoreNotes(ref, est);
  assert.equal(result.matched, 0);
  assert.equal(result.f1, 0);
});

test('a duplicate estimate cannot double-match one reference note', () => {
  const ref = [{ onset: 1.0, midi: 60 }];
  const est = [
    { onset: 1.0, midi: 60 },
    { onset: 1.01, midi: 60 },
  ];
  const result = scoreNotes(ref, est);
  assert.equal(result.matched, 1, 'only one of the two candidate estimates may claim the reference note');
  assert.equal(result.ref, 1);
  assert.equal(result.est, 2);
  assert.equal(result.precision, 0.5);
  assert.equal(result.recall, 1);
});

test('a duplicate reference note cannot be double-claimed by one estimate', () => {
  const ref = [
    { onset: 1.0, midi: 60 },
    { onset: 1.01, midi: 60 },
  ];
  const est = [{ onset: 1.0, midi: 60 }];
  const result = scoreNotes(ref, est);
  assert.equal(result.matched, 1);
  assert.equal(result.ref, 2);
  assert.equal(result.est, 1);
  assert.equal(result.recall, 0.5);
  assert.equal(result.precision, 1);
});

test('both inputs empty is defined as a perfect score, never NaN', () => {
  const result = scoreNotes([], []);
  assert.equal(result.precision, 1);
  assert.equal(result.recall, 1);
  assert.equal(result.f1, 1);
  assert.equal(result.matched, 0);
  assert.equal(result.ref, 0);
  assert.equal(result.est, 0);
});

test('reference notes with no estimate at all scores zero, never NaN', () => {
  const result = scoreNotes([{ onset: 0, midi: 60 }], []);
  assert.equal(result.precision, 0);
  assert.equal(result.recall, 0);
  assert.equal(result.f1, 0);
  assert.ok(Number.isFinite(result.precision));
  assert.ok(Number.isFinite(result.recall));
  assert.ok(Number.isFinite(result.f1));
});

test('estimate notes with no reference at all scores zero, never NaN', () => {
  const result = scoreNotes([], [{ onset: 0, midi: 60 }]);
  assert.equal(result.precision, 0);
  assert.equal(result.recall, 0);
  assert.equal(result.f1, 0);
});
