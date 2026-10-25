// F10: the browser may clear site data when space runs low unless the page
// asks it to keep it. requestKeep asks (once already kept, it does not ask
// again); readKeep reports whether it is kept and roughly how much is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestKeep, readKeep } from '../../src/core/storage-keep.js';

function manager({ persisted = false, grant = true, usage = 50000 } = {}) {
  const calls = { persist: 0 };
  return {
    calls,
    persisted: async () => persisted,
    persist: async () => { calls.persist++; persisted = grant; return grant; },
    estimate: async () => ({ usage, quota: 1e9 }),
  };
}

test('asks the browser to keep progress, and reports what it said', async () => {
  const sm = manager();
  assert.equal(await requestKeep(sm), true);
  assert.equal(sm.calls.persist, 1);
  const refused = manager({ grant: false });
  assert.equal(await requestKeep(refused), false);
});

test('does not ask again once progress is already kept', async () => {
  const sm = manager({ persisted: true });
  assert.equal(await requestKeep(sm), true);
  assert.equal(sm.calls.persist, 0);
});

test('reports kept and the space used in KB, rounded', async () => {
  assert.deepEqual(await readKeep(manager({ persisted: true, usage: 50000 })), { kept: true, kb: 49 });
  assert.deepEqual(await readKeep(manager({ persisted: false, usage: 0 })), { kept: false, kb: 0 });
});

test('a browser without the storage API is a quiet null, never a throw', async () => {
  assert.equal(await requestKeep(undefined), null);
  assert.equal(await readKeep(undefined), null);
  assert.equal(await requestKeep({}), null);
  const broken = { persisted: async () => { throw new Error('no'); }, persist: async () => { throw new Error('no'); }, estimate: async () => { throw new Error('no'); } };
  assert.equal(await requestKeep(broken), null);
  assert.equal(await readKeep(broken), null);
});

test('an estimate with no usage figure still reports kept, with kb null', async () => {
  const sm = { persisted: async () => true, estimate: async () => ({}) };
  assert.deepEqual(await readKeep(sm), { kept: true, kb: null });
});
