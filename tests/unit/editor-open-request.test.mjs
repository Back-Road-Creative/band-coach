// requestOpenInEditor (src/ui/editor.js): the cross-panel hand-over "Fix it
// up" (src/ui/learn.js) uses to send a song to the editor panel. It now
// optionally carries the transcription's needsCheck list along with the
// song id, so the editor can show the learner the SAME check list instead
// of losing it on hand-over. A fake api.store() records exactly the
// request shape a real panel would receive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestOpenInEditor } from '../../src/ui/editor.js';

function fakeApi() {
  const stores = {};
  return {
    store(id) {
      return {
        set(v) { stores[id] = v; },
        get() { return stores[id]; },
      };
    },
    _stores: stores,
  };
}

test('requestOpenInEditor: with no needsCheck, request carries just the songId (unchanged behaviour)', () => {
  const api = fakeApi();
  requestOpenInEditor(api, 'song-1');
  assert.deepEqual(api._stores['editor-open-request'], { songId: 'song-1', needsCheck: [] });
});

test('requestOpenInEditor: needsCheck, when given, rides along in the same request', () => {
  const api = fakeApi();
  requestOpenInEditor(api, 'song-1', ['Bar 2 beat 3 note unclear']);
  assert.deepEqual(api._stores['editor-open-request'], { songId: 'song-1', needsCheck: ['Bar 2 beat 3 note unclear'] });
});

// P3-10: "Edit notes" on a starter tune (no library id of its own) hands the
// starter's id along under its own key instead, so checkOpenRequest can
// resolve it through starterSongs rather than the shared library.
test('requestOpenInEditor: starterId, when given, rides along', () => {
  const api = fakeApi();
  requestOpenInEditor(api, null, [], { starterId: 'hot-cross-buns' });
  assert.deepEqual(api._stores['editor-open-request'], { songId: null, needsCheck: [], starterId: 'hot-cross-buns' });
});
