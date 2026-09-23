import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeImportFile } from '../../src/ui/songs/import-route.js';

test('routes .mid and .midi to the midi importer, reading bytes', () => {
  assert.deepEqual(routeImportFile('tune.mid'), { kind: 'midi', readAs: 'bytes' });
  assert.deepEqual(routeImportFile('Tune.MIDI'), { kind: 'midi', readAs: 'bytes' });
});

test('routes .abc to the abc importer, reading text', () => {
  assert.deepEqual(routeImportFile('session.abc'), { kind: 'abc', readAs: 'text' });
});

test('routes .xml and .musicxml to the musicxml importer, reading text', () => {
  assert.deepEqual(routeImportFile('score.xml'), { kind: 'musicxml', readAs: 'text' });
  assert.deepEqual(routeImportFile('score.musicxml'), { kind: 'musicxml', readAs: 'text' });
});

test('routes .json to the challenge importer, reading text', () => {
  assert.deepEqual(routeImportFile('term1.json'), { kind: 'challenge', readAs: 'text' });
  assert.deepEqual(routeImportFile('Term1.JSON'), { kind: 'challenge', readAs: 'text' });
});

test('a compressed .mxl file is a plain-words unsupported case, not a crash', () => {
  assert.deepEqual(routeImportFile('score.mxl'), { kind: 'unsupported-mxl', readAs: null });
});

test('an unrecognised extension is reported, not guessed at', () => {
  assert.deepEqual(routeImportFile('notes.txt'), { kind: 'unknown', readAs: null });
  assert.deepEqual(routeImportFile('no-extension-at-all'), { kind: 'unknown', readAs: null });
});
