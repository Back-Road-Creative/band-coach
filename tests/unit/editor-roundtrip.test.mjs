// Characterization (BC-08 D3): the editor's whole load -> edit -> save
// sequence without a DOM. src/ui/editor.js's loadSong()/saveSong() are
// closures inside mountEditor (no DOM-free export), so this drives the same
// decision each step actually makes, using the pieces that ARE exported and
// pure: chooseSaveTarget (src/ui/editor.js), repitch (src/song/edit.js),
// validateSong (src/song/model.js) and createLibrary/memoryStore
// (src/song/library.js). This is the sequence "Fix it up" -> edit a note ->
// "Save to my songs" runs: library.add() (as "Learn this" originally saved
// it) -> library.get(id) (as loadSong() reads it, setting loadedId = id) ->
// repitch() (an editing tool) -> chooseSaveTarget({ loadedId, asCopy }) ->
// library.update()/add() (as saveSong() does) -- the whole BC-08 round trip
// asserted end to end instead of at each seam individually.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chooseSaveTarget } from '../../src/ui/editor.js';
import { repitch } from '../../src/song/edit.js';
import { validateSong, SCHEMA, TICKS_PER_QUARTER } from '../../src/song/model.js';
import { createLibrary, memoryStore } from '../../src/song/library.js';

function song(id, overrides = {}) {
  return {
    schema: SCHEMA, id, title: overrides.title || 'Song ' + id, composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 120, ticksPerQuarter: TICKS_PER_QUARTER,
    parts: [{ id: 'p', name: 'P', notes: [{ start: 0, dur: 480, midi: 60 }, { start: 480, dur: 480, midi: 62 }] }],
    chords: [],
    ...overrides
  };
}

// Mirrors saveSong()'s own shape (src/ui/editor.js:648-671): validate, then
// chooseSaveTarget, then update-in-place or add.
async function saveLikeEditor(library, { song: edited, loadedId, asCopy }) {
  const { ok, errors } = validateSong(edited);
  assert.ok(ok, 'fixture must stay valid across the edit: ' + (errors || []).join('; '));
  const target = chooseSaveTarget({ loadedId, asCopy: !!asCopy });
  if (target.mode === 'update') {
    await library.update(target.id, edited, { now: Date.now() });
    return loadedId;
  }
  const id = await library.add(edited, { now: Date.now() });
  return id;
}

test('load -> edit -> save (plain "Save") keeps exactly ONE library entry, in place', async () => {
  const library = createLibrary(memoryStore());
  // "Learn this" originally saves a freshly transcribed song.
  const id = await library.add(song('hot-cross-buns'), { now: 1000 });

  // "Fix it up" opens it -- loadSong() sets loadedId = loadedSong.id.
  const loaded = await library.get(id);
  const loadedId = loaded.id;
  assert.equal(loadedId, id);

  // An editing tool changes one note (repitch is a pure, immutable op that
  // returns { song, changed }, same as every op in src/song/edit.js).
  const edited = repitch(loaded, 0, 0, { set: 67 }).song;
  assert.equal(edited.parts[0].notes[0].midi, 67, 'repitch must have actually changed the note');

  // Plain "Save to my songs" -- asCopy is false.
  const savedId = await saveLikeEditor(library, { song: edited, loadedId, asCopy: false });
  assert.equal(savedId, loadedId, 'a plain save corrects the loaded entry, not a new one');

  const list = await library.list();
  assert.equal(list.length, 1, 'a corrective save must not leave a second entry behind');
  assert.equal(list[0].id, id, 'the id is unchanged');
  assert.equal(list[0].addedAt, 1000, 'addedAt is kept from the original add');
  assert.ok(list[0].updatedAt >= 1000, 'updatedAt is set by the save');

  const stored = await library.get(id);
  assert.equal(stored.parts[0].notes[0].midi, 67, 'the edited note is what is actually stored');
});

test('load -> edit -> "Save a copy" keeps the original untouched and adds a second entry', async () => {
  const library = createLibrary(memoryStore());
  const id = await library.add(song('hot-cross-buns'), { now: 1000 });

  const loaded = await library.get(id);
  const loadedId = loaded.id;
  const edited = repitch(loaded, 0, 0, { set: 67 }).song;

  const savedId = await saveLikeEditor(library, { song: edited, loadedId, asCopy: true });
  assert.notEqual(savedId, loadedId, '"Save a copy" must create a new id, not overwrite the loaded one');

  const list = await library.list();
  assert.equal(list.length, 2, 'the original plus the copy');

  const original = await library.get(loadedId);
  assert.equal(original.parts[0].notes[0].midi, 60, 'the original entry must be untouched by "Save a copy"');

  const copy = await library.get(savedId);
  assert.equal(copy.parts[0].notes[0].midi, 67, 'the copy carries the edit');
});

test('load -> edit -> save, save again: still exactly ONE entry (no accumulating copies)', async () => {
  const library = createLibrary(memoryStore());
  const id = await library.add(song('hot-cross-buns'), { now: 1000 });

  let loaded = await library.get(id);
  let loadedId = loaded.id;
  let edited = repitch(loaded, 0, 0, { set: 67 }).song;
  await saveLikeEditor(library, { song: edited, loadedId, asCopy: false });

  // A second correction, same panel session (loadedId unchanged since the
  // first save was an update, not an add -- saveSong() only reassigns
  // loadedId after an add, src/ui/editor.js:664).
  loaded = await library.get(loadedId);
  edited = repitch(loaded, 0, 1, { set: 69 }).song;
  await saveLikeEditor(library, { song: edited, loadedId, asCopy: false });

  const list = await library.list();
  assert.equal(list.length, 1, 'two plain saves in a row must still be exactly one entry');
  const stored = await library.get(loadedId);
  assert.equal(stored.parts[0].notes[0].midi, 67, 'the first edit stuck');
  assert.equal(stored.parts[0].notes[1].midi, 69, 'the second edit stuck');
});
