import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EAR_EXERCISES, makeQuestion, checkAnswer } from '../../src/core/ear/index.js';

const EXPECTED_IDS = [
  'degrees',
  'melodic-dictation',
  'rhythm-dictation',
  'progressions',
  'scales-modes',
  'inversions',
  'intonation',
  'sing-back',
];

test('registry has every exercise the plan lists', () => {
  for (const id of EXPECTED_IDS) {
    assert.ok(EAR_EXERCISES[id], `missing exercise ${id}`);
  }
});

test('every entry has a positive level count and matching level names, plus a label', () => {
  for (const [id, entry] of Object.entries(EAR_EXERCISES)) {
    assert.ok(entry.levels > 0, id);
    assert.equal(entry.levelNames.length, entry.levels, id);
    assert.equal(typeof entry.label, 'string', id);
    assert.ok(entry.label.length > 0, id);
  }
});

test('makeQuestion/checkAnswer route to the right module for every exercise', () => {
  for (const id of EXPECTED_IDS) {
    const q = makeQuestion(id, 1, 0);
    assert.equal(typeof q.prompt, 'string', id);
    assert.ok(Array.isArray(q.play), id);
    const result = checkAnswer(id, q, q.answer);
    assert.equal(result.ok, true, `${id}: correct answer should check ok`);
  }
});

test('makeQuestion is deterministic through the registry', () => {
  for (const id of EXPECTED_IDS) {
    assert.deepEqual(makeQuestion(id, 2, 5), makeQuestion(id, 2, 5), id);
  }
});
