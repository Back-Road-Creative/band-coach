import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchForUpdate } from '../../src/core/update-watch.js';

function fakeContainer(controller) {
  const listeners = [];
  return {
    controller,
    addEventListener(type, fn) { if (type === 'controllerchange') listeners.push(fn); },
    change() { listeners.forEach((fn) => fn()); },
  };
}

test('a page already run by a service worker hears when a new one takes over', () => {
  const sw = fakeContainer({});
  let calls = 0;
  assert.equal(watchForUpdate(sw, () => { calls++; }), true);
  sw.change();
  assert.equal(calls, 1);
});

test('the update is announced once, however many times control changes', () => {
  const sw = fakeContainer({});
  let calls = 0;
  watchForUpdate(sw, () => { calls++; });
  sw.change();
  sw.change();
  assert.equal(calls, 1);
});

test('the first install is not an update: no controller at start means no notice', () => {
  const sw = fakeContainer(null);
  let calls = 0;
  assert.equal(watchForUpdate(sw, () => { calls++; }), false);
  sw.change();
  assert.equal(calls, 0);
});

test('no service worker support (file://, old browsers) is a quiet no-op', () => {
  assert.equal(watchForUpdate(undefined, () => { throw new Error('never'); }), false);
  assert.equal(watchForUpdate(null, () => { throw new Error('never'); }), false);
});
