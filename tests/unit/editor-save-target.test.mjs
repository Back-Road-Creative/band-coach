// chooseSaveTarget (src/ui/editor.js) is the pure decision behind saveSong():
// whether "Save to my songs" writes over the song this panel loaded (BC-08's
// editor half -- "Fix it up" used to always create a new suffixed copy
// instead of correcting the one the learner opened) or creates a brand new
// entry. It has no DOM in it, so it is tested directly without a browser,
// the same way src/ui/editor/record.js's pure pieces are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseSaveTarget } from '../../src/ui/editor.js';

test('chooseSaveTarget: a freshly transcribed song (nothing loaded) always adds', () => {
  assert.deepEqual(chooseSaveTarget({ loadedId: null, asCopy: false }), { mode: 'add' });
  assert.deepEqual(chooseSaveTarget({ loadedId: null, asCopy: true }), { mode: 'add' });
});

test('chooseSaveTarget: a loaded song saves in place unless "Save a copy" was asked for', () => {
  assert.deepEqual(chooseSaveTarget({ loadedId: 'hot-cross-buns', asCopy: false }), { mode: 'update', id: 'hot-cross-buns' });
});

test('chooseSaveTarget: "Save a copy" always adds, even with a song loaded', () => {
  assert.deepEqual(chooseSaveTarget({ loadedId: 'hot-cross-buns', asCopy: true }), { mode: 'add' });
});
