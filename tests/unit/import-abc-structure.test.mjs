// Three shapes found in real-world ABC collections (the Nottingham Music
// Database, 2026-09-23) that the importer misread. The texts below are
// hand-written minimal reproductions of those shapes, not copies of the
// collection, whose licence is not stated anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importAbc } from '../../src/song/import-abc.js';

test('a %comment line in the tune header is not read as notes', () => {
  // "Database" holds note letters (a, b, e); read as body text they would
  // become notes ahead of the real first note.
  const text = 'X:1\nT:Comment Test\n% A Database header\nM:4/4\nL:1/4\nK:C\nc d e f|\n';
  const { song } = importAbc(text);
  assert.deepEqual(song.parts[0].notes.map((n) => n.midi), [72, 74, 76, 77]);
});

test('a file with two tunes imports only the first, and says so', () => {
  const text = [
    'X:1', 'T:First', 'M:4/4', 'L:1/4', 'K:C', 'c d e f|',
    '', 'X:2', 'T:Second', 'M:3/4', 'L:1/4', 'K:G', 'B A G|',
  ].join('\n');
  const { song, warnings } = importAbc(text);
  assert.equal(song.title, 'First');
  assert.deepEqual(song.parts[0].notes.map((n) => n.midi), [72, 74, 76, 77]);
  assert.ok(warnings.some((w) => /more than one tune/.test(w)), `warnings: ${JSON.stringify(warnings)}`);
});

test('a bare mid-tune K: line changes the key and M: is consumed, not read as notes or an ending', () => {
  // K:A sharps G; after the bare K:D line G is natural again. The "D" in
  // "K:D" and the "6" in "M:6/8" must not become a note or a [6 ending.
  const text = 'X:1\nT:Key Change\nM:2/4\nL:1/8\nK:A\ng2 a2|\nM:6/8\nK:D\ng2 a2|\n';
  const { song, warnings } = importAbc(text);
  assert.deepEqual(song.key, { tonic: 9, mode: 'major' }); // opening key only
  assert.deepEqual(song.parts[0].notes.map((n) => n.midi), [80, 81, 79, 81]);
  assert.ok(warnings.some((w) => /mid-tune M:/.test(w)), `warnings: ${JSON.stringify(warnings)}`);
});
