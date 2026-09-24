import { test } from 'node:test';
import assert from 'node:assert/strict';

import { writtenMidi, writtenKeyName, writtenNote } from '../../src/song/arrange/transposing.js';
import clarinetBb from '../../src/instruments/clarinet-bb.js';
import saxTenorBb from '../../src/instruments/sax-tenor-bb.js';
import gtr from '../../src/instruments/gtr.js';
import doubleBass from '../../src/instruments/double-bass.js';
import tinWhistle from '../../src/instruments/tin-whistle.js';
import kbd from '../../src/instruments/kbd.js';

const cMajor = { tonic: 0, mode: 'major' };

test('clarinet reads a tone above sounding', () => {
  assert.equal(writtenMidi(clarinetBb, 60), 62);
});

test('tenor sax reads a ninth above', () => {
  assert.equal(writtenMidi(saxTenorBb, 60), 74);
});

test('guitar reads an octave above', () => {
  assert.equal(writtenMidi(gtr, 60), 72);
});

test('double bass reads an octave above', () => {
  assert.equal(writtenMidi(doubleBass, 60), 72);
});

test('tin whistle reads an octave below', () => {
  assert.equal(writtenMidi(tinWhistle, 60), 48);
});

test('keyboard is unchanged', () => {
  assert.equal(writtenMidi(kbd, 60), 60);
});

test('a C-major song on clarinet is written in D', () => {
  assert.equal(writtenKeyName(clarinetBb, cMajor), 'D');
});

// "the note says which way and how far", for each of the above.
test('the note says which way and how far: clarinet', () => {
  assert.equal(writtenNote(clarinetBb), 'Written a tone higher than it sounds');
});

test('the note says which way and how far: tenor sax', () => {
  assert.equal(writtenNote(saxTenorBb), 'Written a ninth higher than it sounds');
});

test('the note says which way and how far: guitar', () => {
  assert.equal(writtenNote(gtr), 'Written an octave higher than it sounds');
});

test('the note says which way and how far: double bass', () => {
  assert.equal(writtenNote(doubleBass), 'Written an octave higher than it sounds');
});

test('the note says which way and how far: tin whistle', () => {
  assert.equal(writtenNote(tinWhistle), 'Written an octave lower than it sounds');
});

test('the note says which way and how far: keyboard has no written-pitch note', () => {
  assert.equal(writtenNote(kbd), null);
});
