// itemIdForMidi('harp', ...) used to match a heard pitch class against a
// fixed C-harmonica table regardless of prefs.harpKey, which is wrong for
// any other key: transposing the whole harp shifts every hole's pitch class
// too, so a D harp's hole 4 blow (D5, pc 2) would miss the fixed C table's
// hole 4 entry (C5, pc 0) and get credited to whichever OTHER hole happens
// to share pc 2 in the C table, crediting the wrong hole's mastery item.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemIdForMidi } from '../../src/ui/songs/mastery.js';
import { layoutFor } from '../../src/instruments/how/harmonica.js';

test('harp: default (no harpKey pref) behaves exactly as the old C-only table', () => {
  assert.equal(itemIdForMidi('harp', 60, {}), 'hb4');
  assert.equal(itemIdForMidi('harp', 62, {}), 'hd4');
  assert.equal(itemIdForMidi('harp', 67, {}), 'hb6');
});

test('harp: a D harp (harpKey 2) credits hole 4 blow for a heard D, any octave', () => {
  const layout = layoutFor(2);
  const hole4BlowMidi = layout[3].blow; // D5
  assert.equal(itemIdForMidi('harp', hole4BlowMidi, { harpKey: 2 }), 'hb4');
  // An octave away (pitch-class match) still credits the same hole.
  assert.equal(itemIdForMidi('harp', hole4BlowMidi + 12, { harpKey: 2 }), 'hb4');
  assert.equal(itemIdForMidi('harp', hole4BlowMidi - 12, { harpKey: 2 }), 'hb4');
});

test('harp: the same heard pitch class credits a DIFFERENT hole depending on the key', () => {
  // hole 4 blow in D (harpKey 2) is D5 (midi 74, pc 2). In C (harpKey 0),
  // pc 2 belongs to hole 4 draw (D5, midi 74) via the hole-search order
  // (4 is searched before any other hole sharing pc 2), not hole 4 blow.
  const dLayout = layoutFor(2);
  const midiD = dLayout[3].blow;
  assert.equal(itemIdForMidi('harp', midiD, { harpKey: 2 }), 'hb4');
  assert.equal(itemIdForMidi('harp', midiD, { harpKey: 0 }), 'hd4');
});

test('harp: an out-of-range harpKey pref falls back to key 0 (C), never throws', () => {
  assert.equal(itemIdForMidi('harp', 60, { harpKey: 99 }), itemIdForMidi('harp', 60, {}));
  assert.equal(itemIdForMidi('harp', 60, { harpKey: -1 }), itemIdForMidi('harp', 60, {}));
  assert.equal(itemIdForMidi('harp', 60, { harpKey: 1.5 }), itemIdForMidi('harp', 60, {}));
});

test('harp: every one of the 12 keys still maps at least one note to every hole (no key breaks the search)', () => {
  for (let key = 0; key <= 11; key++) {
    const layout = layoutFor(key);
    for (let hole = 1; hole <= 10; hole++) {
      const blowId = itemIdForMidi('harp', layout[hole - 1].blow, { harpKey: key });
      assert.ok(blowId, `key ${key} hole ${hole} blow mapped to null`);
    }
  }
});
