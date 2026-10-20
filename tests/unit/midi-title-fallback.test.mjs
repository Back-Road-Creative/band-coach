import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { importMidi } from '../../src/song/import-midi.js';

// A .mid whose only title is the generic track name "untitled" is named after its file,
// the way record-door names a recording (titleFromFileName).
const bytes = new Uint8Array(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'midi', 'beat.mid')));

test('an untitled MIDI file is named after its file', () => {
  assert.equal(importMidi(bytes, { fileName: 'beat.mid' }).song.title, 'beat');
  assert.equal(importMidi(bytes, { fileName: 'My Groove.MID' }).song.title, 'My Groove');
});

test('with no file name either, the generic fallback stays', () => {
  assert.equal(importMidi(bytes).song.title, 'Untitled MIDI Import');
});
