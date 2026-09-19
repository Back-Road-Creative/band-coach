import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EAR_EXERCISES, makeQuestion, checkAnswer } from '../../src/core/ear/index.js';

const EXPECTED_IDS = [
  'degrees', 'melodic-dictation', 'rhythm-dictation', 'progressions',
  'scales-modes', 'inversions', 'intonation', 'sing-back',
];

test('registry has every exercise, wires make/check correctly, and is deterministic', () => {
  for (const id of EXPECTED_IDS) {
    const entry = EAR_EXERCISES[id];
    assert.ok(entry, `missing exercise ${id}`);
    assert.ok(entry.levels > 0, id);
    assert.equal(entry.levelNames.length, entry.levels, id);
    assert.ok(typeof entry.label === 'string' && entry.label.length > 0, id);

    const q = makeQuestion(id, 1, 0);
    assert.equal(typeof q.prompt, 'string', id);
    assert.ok(Array.isArray(q.play), id);
    assert.equal(checkAnswer(id, q, q.answer).ok, true, `${id}: correct answer should check ok`);
    assert.deepEqual(makeQuestion(id, 2, 5), makeQuestion(id, 2, 5), id);
  }
});
