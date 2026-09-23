// learnSourceFor (src/ui/learn/source.js): the "one door" classifier the
// Learn-this panel (src/ui/learn.js) uses to tell a notation file (routed
// through src/ui/songs/import-route.js's routeImportFile -- midi/abc/
// musicxml/gp7) from an audio recording (audio/* MIME, or one of the common
// audio extensions) from anything else, so the panel itself never has to
// ask the learner which kind of thing they dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learnSourceFor } from '../../src/ui/learn/source.js';

test('notation extensions classify as notation', () => {
  assert.equal(learnSourceFor('tune.mid'), 'notation');
  assert.equal(learnSourceFor('tune.midi'), 'notation');
  assert.equal(learnSourceFor('tune.abc'), 'notation');
  assert.equal(learnSourceFor('tune.xml'), 'notation');
  assert.equal(learnSourceFor('tune.musicxml'), 'notation');
  assert.equal(learnSourceFor('tune.mxl'), 'notation');
  assert.equal(learnSourceFor('tune.gp'), 'notation');
});

test('common audio extensions classify as audio, with no MIME type given', () => {
  ['wav', 'mp3', 'ogg', 'm4a', 'flac', 'webm'].forEach((ext) => {
    assert.equal(learnSourceFor('recording.' + ext, ''), 'audio', ext);
  });
});

test('an audio/* MIME type classifies as audio even with an unrecognised extension', () => {
  assert.equal(learnSourceFor('blob', 'audio/wav'), 'audio');
  assert.equal(learnSourceFor('capture.dat', 'audio/webm;codecs=opus'), 'audio');
});

test('a band pack, a challenge and a plain zip are not learn sources', () => {
  assert.equal(learnSourceFor('set.bandpack'), 'unknown');
  assert.equal(learnSourceFor('challenge.json'), 'unknown');
  assert.equal(learnSourceFor('archive.zip'), 'unknown');
});

test('an unrecognised file with no useful MIME type is unknown', () => {
  assert.equal(learnSourceFor('notes.txt', ''), 'unknown');
  assert.equal(learnSourceFor('notes.txt', 'text/plain'), 'unknown');
  assert.equal(learnSourceFor(''), 'unknown');
});
