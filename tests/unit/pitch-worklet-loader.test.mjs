// createPitchNode() hands the worklet source to addModule() as a URL. The
// hosted copy runs under a strict hash-based CSP whose script-src allows
// `blob:` but never `data:` (a data: entry would let an injected
// <script src="data:..."> run), so the loader tries a blob: URL first and only
// falls back to the data: URL when addModule rejects it. The downloaded
// file:// copy keeps loading the data: URL first, exactly as it always did.
// Fake audio context only: no browser, no real worklet.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { PITCH_WORKLET_SOURCE, createPitchNode } from '../../src/audio/pitch-worklet.js';

class FakeNode {
  constructor(actx, name, opts) {
    this.actx = actx;
    this.name = name;
    this.opts = opts;
  }
}
globalThis.AudioWorkletNode = FakeNode;

// `reject(url, n)` decides, per call, whether addModule rejects that URL.
function fakeCtx(reject = () => false) {
  const urls = [];
  return {
    urls,
    audioWorklet: {
      addModule(url) {
        urls.push(url);
        return reject(url, urls.length) ? Promise.reject(new Error('blocked')) : Promise.resolve();
      },
    },
  };
}

const realLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
afterEach(() => {
  if (realLocation) Object.defineProperty(globalThis, 'location', realLocation);
  else delete globalThis.location;
});

test('the blob: URL is tried first, carries the worklet source, and is revoked once addModule settles', async () => {
  const ctx = fakeCtx();
  const node = await createPitchNode(ctx);
  assert.ok(node instanceof FakeNode, 'resolves to the AudioWorkletNode');
  assert.equal(ctx.urls.length, 1, 'one addModule call when the blob: URL loads');
  assert.match(ctx.urls[0], /^blob:/, 'the first URL tried must be a blob: URL, not data:');
  assert.equal(resolveObjectURL(ctx.urls[0]), undefined, 'the blob URL is revoked after addModule settles');
});

test('the blob: URL holds exactly PITCH_WORKLET_SOURCE', async () => {
  let seen = null;
  const ctx = fakeCtx((url) => {
    seen = resolveObjectURL(url);
    return false;
  });
  await createPitchNode(ctx);
  assert.ok(seen, 'the blob URL resolved while addModule was running');
  assert.equal(seen.type, 'application/javascript');
  assert.equal(await seen.text(), PITCH_WORKLET_SOURCE);
});

test('when addModule rejects the blob: URL, the data: URL is tried and the node still comes back', async () => {
  const ctx = fakeCtx((url) => url.startsWith('blob:'));
  const node = await createPitchNode(ctx);
  assert.ok(node instanceof FakeNode);
  assert.equal(ctx.urls.length, 2);
  assert.match(ctx.urls[0], /^blob:/);
  assert.match(ctx.urls[1], /^data:application\/javascript;base64,/);
  const decoded = Buffer.from(ctx.urls[1].split('base64,')[1], 'base64').toString('utf8');
  assert.equal(decoded, PITCH_WORKLET_SOURCE, 'the fallback URL carries the same source');
  assert.equal(resolveObjectURL(ctx.urls[0]), undefined, 'the rejected blob URL is revoked too');
});

test('when both URLs are rejected, createPitchNode rejects (the app then takes its setInterval listener)', async () => {
  const ctx = fakeCtx(() => true);
  await assert.rejects(() => createPitchNode(ctx), /blocked/);
  assert.equal(ctx.urls.length, 2);
});

test('on a file:// page the data: URL is still tried first and alone, as before', async () => {
  Object.defineProperty(globalThis, 'location', { value: { protocol: 'file:' }, configurable: true, writable: true });
  const ctx = fakeCtx();
  await createPitchNode(ctx);
  assert.equal(ctx.urls.length, 1);
  assert.match(ctx.urls[0], /^data:application\/javascript;base64,/);
});
