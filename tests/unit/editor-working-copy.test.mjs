// stashWorking/restoreWorking (src/ui/editor/working-copy.js): the pure
// shape behind the editor panel's unsaved-work stash (P3-10) -- no DOM, no
// api.store here, so it is tested directly without a browser, the same way
// src/ui/editor.js's chooseSaveTarget/loadReport already are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stashWorking, restoreWorking } from '../../src/ui/editor/working-copy.js';
import { PANEL_DATA_MAX } from '../../src/ui/panels.js';
import { starterSongs } from '../../src/song/starter/index.js';

const VALID_SONG = starterSongs[0];

test('a working copy round-trips', () => {
  const meta = { loadedId: 'hot-cross-buns', needsCheck: ['Bar 2 beat 3 note unclear'], acknowledged: false };
  const stashed = stashWorking(VALID_SONG, meta);
  assert.ok(stashed, 'a valid song stashes something');
  const restored = restoreWorking(stashed);
  assert.deepEqual(restored, { song: VALID_SONG, meta });
});

test('a working copy over the panel limit is not stored, not half-stored', () => {
  // Enough repeated notes to push JSON.stringify well past PANEL_DATA_MAX.
  const bigNotes = [];
  for (let i = 0; i < 20000; i++) bigNotes.push({ start: i * 10, dur: 10, midi: 60 });
  const bigSong = { ...VALID_SONG, parts: [{ ...VALID_SONG.parts[0], notes: bigNotes }] };
  assert.ok(JSON.stringify(bigSong).length > PANEL_DATA_MAX, 'the fixture really is over the limit');
  assert.equal(stashWorking(bigSong, { loadedId: null, needsCheck: [], acknowledged: true }), null);
});

test('junk is ignored', () => {
  assert.equal(restoreWorking('x'), null);
  assert.equal(restoreWorking({}), null);
  assert.equal(restoreWorking({ song: 1 }), null);
});
