// classifyAddFile (src/ui/songs/add-source.js): the single classifier for
// Songs' one "Add a song" file input (plan P3-4). Builds on
// src/ui/songs/import-route.js's routeImportFile (which importer/how to
// read) and src/ui/learn/source.js's LEARN_AUDIO_EXTENSIONS (recordings a
// browser's MIME sniffing can miss), so Add a song never has to ask the
// learner what kind of thing they picked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAddFile,
  ADD_ACCEPT,
  ADD_HELP_LINE,
  UNSUPPORTED_MESSAGE,
} from '../../src/ui/songs/add-source.js';

test('a score file is notation', () => {
  ['tune.mid', 'tune.midi', 'tune.abc', 'tune.xml', 'tune.musicxml', 'tune.mxl', 'tune.gp', 'tune.gp5'].forEach((name) => {
    assert.equal(classifyAddFile(name, '').kind, 'notation', name);
  });
});

test('a recording is audio', () => {
  ['take.wav', 'take.mp3', 'take.ogg', 'take.m4a', 'take.flac', 'take.webm'].forEach((name) => {
    assert.equal(classifyAddFile(name, '').kind, 'audio', name);
  });
});

test('an audio/* MIME type classifies as audio even with an unrecognised extension', () => {
  assert.equal(classifyAddFile('blob', 'audio/wav').kind, 'audio');
});

test('a band pack and a challenge are recognised', () => {
  assert.equal(classifyAddFile('ourset.bandpack', '').kind, 'band-pack');
  assert.equal(classifyAddFile('term1.json', '').kind, 'challenge');
});

test('anything else is unknown', () => {
  assert.equal(classifyAddFile('notes.txt', '').kind, 'unknown');
  assert.equal(classifyAddFile('archive.zip', '').kind, 'unknown');
  assert.equal(classifyAddFile('no-extension-at-all', '').kind, 'unknown');
});

test('a notation file carries its routeImportFile route along', () => {
  const result = classifyAddFile('tune.mid', '');
  assert.deepEqual(result.route, { kind: 'midi', readAs: 'bytes' });
});

test('the accept list and help line name every format', () => {
  const extensions = ['mid', 'midi', 'abc', 'xml', 'musicxml', 'mxl', 'gp', 'gp5', 'wav', 'mp3', 'ogg', 'm4a', 'flac', 'webm', 'bandpack', 'json'];
  extensions.forEach((ext) => {
    assert.ok(ADD_ACCEPT.includes('.' + ext), 'ADD_ACCEPT should name .' + ext);
    assert.ok(ADD_HELP_LINE.includes('.' + ext), 'ADD_HELP_LINE should name .' + ext);
  });
});

test('the unsupported message is plain', () => {
  assert.ok(!UNSUPPORTED_MESSAGE.includes('undefined'));
  assert.ok(UNSUPPORTED_MESSAGE.toLowerCase().includes('recording'));
  assert.ok(UNSUPPORTED_MESSAGE.includes('.mid'));
});
