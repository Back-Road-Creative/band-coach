import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeImportFile, importerFor } from '../../src/ui/songs/import-route.js';
import { importMidi } from '../../src/song/import-midi.js';
import { importAbc } from '../../src/song/import-abc.js';
import { importMusicXml } from '../../src/song/import-musicxml.js';

// A tiny stored-only zip writer, self-contained here so this file's
// importerFor tests stand alone (same minimal-zip pattern as
// tests/unit/import-gp7.test.mjs and tests/unit/import-mxl.test.mjs).
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }
function buildZip(files) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const stored = f.data;
    const localHeader = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(stored.length), u32(f.data.length),
      u16(nameBuf.length), u16(0),
      nameBuf,
    ]);
    const localOffset = offset;
    localChunks.push(localHeader, stored);
    offset += localHeader.length + stored.length;
    const centralHeader = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(stored.length), u32(f.data.length),
      u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(localOffset),
      nameBuf,
    ]);
    centralChunks.push(centralHeader);
  }
  const centralStart = offset;
  const central = Buffer.concat(centralChunks);
  offset += central.length;
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(central.length), u32(centralStart), u16(0),
  ]);
  return new Uint8Array(Buffer.concat([...localChunks, central, eocd]));
}

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

test('routes .mxl (compressed MusicXML) to the musicxml importer, reading bytes so it can be unzipped', () => {
  assert.deepEqual(routeImportFile('score.mxl'), { kind: 'musicxml', readAs: 'bytes' });
});

test('routes .gp (Guitar Pro 7/8) to its own importer, reading bytes so it can be unzipped', () => {
  assert.deepEqual(routeImportFile('song.gp'), { kind: 'gp7', readAs: 'bytes' });
  assert.deepEqual(routeImportFile('Song.GP'), { kind: 'gp7', readAs: 'bytes' });
});

test('routes .bandpack to the band pack importer, reading bytes so the zip can be unpacked', () => {
  assert.deepEqual(routeImportFile('ourset.bandpack'), { kind: 'band-pack', readAs: 'bytes' });
  assert.deepEqual(routeImportFile('OurSet.BANDPACK'), { kind: 'band-pack', readAs: 'bytes' });
});

test('a plain .zip stays unknown -- only .bandpack is treated as a band pack, so a random zip is not mistaken for one', () => {
  assert.deepEqual(routeImportFile('archive.zip'), { kind: 'unknown', readAs: null });
});

test('an unrecognised extension is reported, not guessed at', () => {
  assert.deepEqual(routeImportFile('notes.txt'), { kind: 'unknown', readAs: null });
  assert.deepEqual(routeImportFile('no-extension-at-all'), { kind: 'unknown', readAs: null });
});

test('importerFor maps each song kind to its own importer, not a shared fallback', () => {
  assert.equal(importerFor('abc'), importAbc);
  assert.equal(importerFor('musicxml'), importMusicXml);
  assert.notEqual(importerFor('gp7'), importMusicXml, 'a .gp file must not be handed to the MusicXML importer');
  assert.notEqual(importerFor('midi'), importMusicXml);
  assert.equal(importerFor('challenge'), null);
  assert.equal(importerFor('band-pack'), null, 'a band pack, like a challenge, holds several songs and is unpacked by songs.js itself, not a single-song importer');
  assert.equal(importerFor('unknown'), null);
});

test('importerFor("gp7") actually reaches importGp7, not importMusicXml, on a real .gp file', () => {
  const gpif = '<?xml version="1.0" encoding="UTF-8"?><GPIF><Score><Title>Test Tune</Title></Score></GPIF>';
  const gpZipBytes = buildZip([{ name: 'Content/score.gpif', data: Buffer.from(gpif, 'utf8') }]);
  const { song, warnings } = importerFor('gp7')(gpZipBytes, { fileName: 'tune.gp' });
  assert.equal(song.title, 'Test Tune');
  assert.ok(Array.isArray(warnings));
  // The same bytes at the musicxml importer (what the pre-fix dispatch did
  // for every non-midi/abc kind) fail to read as a .mxl, since score.gpif
  // is not a MusicXML root entry -- proof the two importers are not
  // interchangeable on this file.
  assert.throws(() => importMusicXml(gpZipBytes, { fileName: 'tune.gp' }));
});

test('importerFor("midi") wraps the FileReader ArrayBuffer, not a bare pass-through', () => {
  assert.notEqual(importerFor('midi'), importMidi, 'must wrap the raw ArrayBuffer in a Uint8Array, not hand it straight to importMidi');
});
