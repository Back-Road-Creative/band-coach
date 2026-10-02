// DevtoolsClient is the browser-level connection of the test driver. The page
// session shares its WebSocket and counts request ids on its own, so a
// page-session reply {id: N, sessionId} can carry the same id as a pending
// browser request. The browser client must never settle a request from, or
// hand a listener, a message that belongs to a session. No browser starts
// here: a fake WebSocket stands in for the socket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DevtoolsClient } from '../helpers/browser.mjs';

function fakeWs() {
  const ws = new EventTarget();
  ws.frames = [];
  ws.send = (json) => ws.frames.push(JSON.parse(json));
  ws.deliver = (obj) => ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(obj) }));
  return ws;
}

const PENDING = Symbol('pending');
// Resolves to the promise's outcome, or PENDING when it has not settled by the
// next turn of the event loop. Rejections are returned as { rejected }.
function settled(promise) {
  return Promise.race([
    promise.then((value) => ({ value }), (error) => ({ rejected: error })),
    new Promise((resolve) => setImmediate(() => resolve(PENDING))),
  ]);
}

test('a page-session reply does not answer a browser request with the same id', { timeout: 5000 }, async () => {
  const ws = fakeWs();
  const client = new DevtoolsClient(ws);
  const request = client.send('Target.createTarget');
  assert.equal(ws.frames[0].id, 1);
  ws.deliver({ id: 1, sessionId: 'S1', result: { wrong: true } });
  assert.equal(await settled(request), PENDING, 'a session-tagged reply settled the browser request');
  ws.deliver({ id: 1, result: { targetId: 'T' } });
  assert.deepEqual(await settled(request), { value: { targetId: 'T' } });
});

test('a page-session error with the same id does not reject a browser request', { timeout: 5000 }, async () => {
  const ws = fakeWs();
  const client = new DevtoolsClient(ws);
  const request = client.send('Target.createTarget');
  ws.deliver({ id: 1, sessionId: 'S1', error: { message: 'page boom' } });
  assert.equal(await settled(request), PENDING, 'a session-tagged error rejected the browser request');
  ws.deliver({ id: 1, result: { targetId: 'T' } });
  assert.deepEqual(await settled(request), { value: { targetId: 'T' } });
});

test('a session-tagged event never reaches browser-level listeners', { timeout: 5000 }, () => {
  const ws = fakeWs();
  const client = new DevtoolsClient(ws);
  const calls = [];
  client.on((msg) => calls.push(msg));
  ws.deliver({ method: 'Runtime.consoleAPICalled', sessionId: 'S1', params: {} });
  assert.equal(calls.length, 0, 'a page event reached the browser listener');
  ws.deliver({ method: 'Target.targetCreated', params: {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'Target.targetCreated');
});

test('control: ordinary replies, errors and strays behave as before', { timeout: 5000 }, async () => {
  const ws = fakeWs();
  const client = new DevtoolsClient(ws);
  const first = client.send('A');
  const second = client.send('B');
  const third = client.send('C');
  assert.deepEqual(ws.frames.map((f) => f.id), [1, 2, 3]);
  ws.deliver({ id: 2, result: { b: 2 } });
  ws.deliver({ id: 1, result: { a: 1 } });
  ws.deliver({ id: 3, error: { message: 'nope' } });
  assert.deepEqual(await settled(first), { value: { a: 1 } });
  assert.deepEqual(await settled(second), { value: { b: 2 } });
  const failure = await settled(third);
  assert.equal(failure.rejected && failure.rejected.message, 'nope');
  // An unknown id, and a parseable object that is neither reply nor event.
  assert.doesNotThrow(() => ws.deliver({ id: 99, result: {} }));
  assert.doesNotThrow(() => ws.deliver({ nothing: 'useful' }));
  assert.doesNotThrow(() => ws.deliver({}));
});
