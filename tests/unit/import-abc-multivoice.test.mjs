import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importAbc } from '../../src/song/import-abc.js';

const TPQ = 480;
const EIGHTH = TPQ / 2;

test('a single-voice tune (no V: fields) still imports as one part, unchanged', () => {
  const abc = `X:1\nT:Scale\nM:4/4\nL:1/8\nK:C\nCDEF|\n`;
  const { song } = importAbc(abc);
  assert.equal(song.parts.length, 1);
  assert.equal(song.parts[0].id, 'abc-1');
  assert.equal(song.parts[0].name, 'Scale');
  assert.deepEqual(song.parts[0].notes.map((n) => n.midi), [60, 62, 64, 65]);
});

test('header-declared V: voices, switched by body V: lines, become separate parts', () => {
  const abc = `X:1\nT:Two Voices\nM:4/4\nL:1/8\nK:C\nV:1 name="Melody"\nV:2 name="Harmony"\nV:1\nCDEF|\nV:2\nEFGA|\n`;
  const { song } = importAbc(abc);
  assert.equal(song.parts.length, 2);
  assert.equal(song.parts[0].name, 'Melody');
  assert.equal(song.parts[1].name, 'Harmony');
  assert.deepEqual(song.parts[0].notes.map((n) => n.midi), [60, 62, 64, 65]);
  assert.deepEqual(song.parts[0].notes.map((n) => n.start), [0, EIGHTH, EIGHTH * 2, EIGHTH * 3]);
  assert.deepEqual(song.parts[1].notes.map((n) => n.midi), [64, 65, 67, 69]);
  // voice 2 has its own time cursor, starting at 0 independently of voice 1.
  assert.deepEqual(song.parts[1].notes.map((n) => n.start), [0, EIGHTH, EIGHTH * 2, EIGHTH * 3]);
});

test('inline [V:id] switches voice mid-line', () => {
  const abc = `X:1\nT:Inline\nM:4/4\nL:1/8\nK:C\n[V:1]CD[V:2]EF\n`;
  const { song } = importAbc(abc);
  assert.equal(song.parts.length, 2);
  assert.deepEqual(song.parts[0].notes.map((n) => n.midi), [60, 62]);
  assert.deepEqual(song.parts[1].notes.map((n) => n.midi), [64, 65]);
  assert.deepEqual(song.parts[1].notes.map((n) => n.start), [0, EIGHTH]);
});

test('bar-scoped accidentals in one voice do not leak into another voice', () => {
  // K:D has F# in its signature. Voice 1 naturalises F for its bar; voice 2's
  // F in its own (different) bar must still come out sharp from the key sig.
  const abc = `X:1\nT:Accidentals\nM:4/4\nL:1/8\nK:D\nV:1\n=FF|\nV:2\nFF|\n`;
  const { song } = importAbc(abc);
  assert.deepEqual(song.parts[0].notes.map((n) => n.midi), [65, 65]); // F natural, both notes
  assert.deepEqual(song.parts[1].notes.map((n) => n.midi), [66, 66]); // F# from key sig, unaffected by voice 1
});

test('a rest-only bar in one voice keeps that voice aligned, independent of other voices', () => {
  const abc = `X:1\nT:RestBar\nM:4/4\nL:1/8\nK:C\nV:1\nCD|EF|\nV:2\nz2 z2|GA|\n`;
  const { song } = importAbc(abc);
  assert.deepEqual(song.parts[0].notes.map((n) => n.start), [0, EIGHTH, EIGHTH * 2, EIGHTH * 3]);
  // voice 2: two half-note-length rests (z2 each = 2 eighths = 480 ticks) then G,A.
  const restTicks = EIGHTH * 2 * 2;
  assert.deepEqual(song.parts[1].notes.map((n) => n.midi), [67, 69]);
  assert.deepEqual(song.parts[1].notes.map((n) => n.start), [restTicks, restTicks + EIGHTH]);
});
