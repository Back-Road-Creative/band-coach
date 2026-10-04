import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writtenMidi } from '../../src/core/wrong-note.js';

// A transposing item carries `written` (what the page shows) and `midi` (what sounds). A wrong
// note must be named in the written key, or a trumpeter told "Play C4" hears "the note is B flat".
test('trumpet (B flat): sounding F4 heard against written C4 reads as written G4', () => {
  const info = { written: 60, midi: 58 };
  assert.equal(writtenMidi(info, 65), 67);
  assert.equal(writtenMidi(info, info.midi), info.written);
});
test('French horn (F): sounding A3 against written G3 reads as written E4', () => {
  const info = { written: 55, midi: 48 };
  assert.equal(writtenMidi(info, 57), 64);
});
test('concert-pitch and bass-clef items (no offset) are unchanged', () => {
  assert.equal(writtenMidi({ midi: 60 }, 65), 65);
  assert.equal(writtenMidi({ written: 50, midi: 50 }, 52), 52);
});
