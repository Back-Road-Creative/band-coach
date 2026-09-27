// createTeardown() (src/core/session-teardown.js): a pure ordered registry of
// "stop everything" callbacks. The learner-leaves case (tab hidden, pagehide)
// needs every audio resource released, not merely paused, and needs one
// stopper's own failure to never block the rest from running.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTeardown } from '../../src/core/session-teardown.js';

test('run() calls every registered stopper once, with the given reason', () => {
  const t = createTeardown();
  const calls = [];
  t.add('mic', (reason) => calls.push(['mic', reason]));
  t.add('audioContext', (reason) => calls.push(['audioContext', reason]));
  const ran = t.run('hidden');
  assert.deepEqual(calls, [['mic', 'hidden'], ['audioContext', 'hidden']]);
  assert.deepEqual(ran, ['mic', 'audioContext']);
});

test('count() reflects the number of registered stoppers', () => {
  const t = createTeardown();
  assert.equal(t.count(), 0);
  t.add('a', () => {});
  t.add('b', () => {});
  assert.equal(t.count(), 2);
});

test('add() returns a remove function that takes the stopper back out', () => {
  const t = createTeardown();
  const calls = [];
  const remove = t.add('a', () => calls.push('a'));
  t.add('b', () => calls.push('b'));
  remove();
  assert.equal(t.count(), 1);
  t.run('x');
  assert.deepEqual(calls, ['b']);
});

test('run() swallows one stopper throwing and still runs the rest', () => {
  const t = createTeardown();
  const calls = [];
  t.add('bad', () => { throw new Error('boom'); });
  t.add('good', () => calls.push('good'));
  let ran;
  assert.doesNotThrow(() => { ran = t.run('x'); });
  assert.deepEqual(calls, ['good']);
  assert.deepEqual(ran, ['bad', 'good']);
});

test('run() is idempotent -- calling it twice re-runs every stopper without duplicating registrations', () => {
  const t = createTeardown();
  const calls = [];
  t.add('mic', () => calls.push('mic'));
  t.run('hidden');
  t.run('pagehide');
  assert.deepEqual(calls, ['mic', 'mic']);
  assert.equal(t.count(), 1);
});

test('run() with no stoppers registered is a safe no-op', () => {
  const t = createTeardown();
  assert.deepEqual(t.run('hidden'), []);
});
