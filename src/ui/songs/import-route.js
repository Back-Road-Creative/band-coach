// Which importer a file's extension routes to, and how the panel should
// read it (as raw bytes for a binary format, as text for a text format).
// routeImportFile is pure: takes only a file name string, does no I/O
// itself — the caller (src/ui/songs.js) does the actual FileReader read.
//
// importerFor(kind) below hands back the actual importer function for a
// song kind ('midi' | 'abc' | 'musicxml' | 'gp7'), so songs.js's dispatch
// from a routed kind to the right importer (src/song/import-midi.js
// importMidi, src/song/import-abc.js importAbc, src/song/import-musicxml.js
// importMusicXml, src/song/import-gp7.js importGp7) lives in one place and
// is unit-testable without a browser. 'challenge' (src/song/challenge.js
// parseChallenge, a teacher-authored .json) has a different return shape
// (a list of songs, not one song + warnings) and stays handled separately
// in songs.js.
//
// Compressed .mxl (zipped MusicXML) routes to the same 'musicxml' kind as
// plain .xml/.musicxml — importMusicXml itself now detects and unzips a
// .mxl's bytes (src/song/unzip-lite.js), so the only difference is how the
// panel should read the file: bytes (ArrayBuffer) for the zip, text for the
// plain XML. This kept src/ui/songs.js's generic 'musicxml' branch as the
// only wiring needed — no per-kind special case there.
//
// Guitar Pro `.gp` (GP7/8) is also a zip (of `Content/score.gpif`), but it
// has its own importer (src/song/import-gp7.js importGp7) rather than
// reusing the MusicXML one, so it gets its own 'gp7' kind read as bytes.
//
// A band pack (src/song/band-pack.js readBandPack/writeBandPack) is also a
// zip, holding several songs (plus, optionally, who plays which part) at
// once -- like 'challenge' above, it has a different return shape than a
// single-song importer and stays handled separately in songs.js. Its
// extension is `.bandpack`, not `.zip`: `.zip` is left 'unknown' on purpose,
// so a random zip a learner happens to pick is never mistaken for one.

import { importMidi } from '../../song/import-midi.js';
import { importAbc } from '../../song/import-abc.js';
import { importMusicXml } from '../../song/import-musicxml.js';
import { importGp7 } from '../../song/import-gp7.js';

function extensionOf(fileName) {
  const name = String(fileName || '');
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function routeImportFile(fileName) {
  const ext = extensionOf(fileName);
  if (ext === 'mid' || ext === 'midi') return { kind: 'midi', readAs: 'bytes' };
  if (ext === 'abc') return { kind: 'abc', readAs: 'text' };
  if (ext === 'xml' || ext === 'musicxml') return { kind: 'musicxml', readAs: 'text' };
  if (ext === 'mxl') return { kind: 'musicxml', readAs: 'bytes' };
  if (ext === 'gp') return { kind: 'gp7', readAs: 'bytes' };
  if (ext === 'bandpack') return { kind: 'band-pack', readAs: 'bytes' };
  if (ext === 'json') return { kind: 'challenge', readAs: 'text' };
  return { kind: 'unknown', readAs: null };
}

// Returns the (data, options) => { song, warnings } importer for a routed
// song `kind`, or null for a kind with no such importer ('challenge',
// 'band-pack', 'unknown'). 'midi' and 'gp7' are read as raw bytes (an ArrayBuffer from
// FileReader.readAsArrayBuffer) and need wrapping in a Uint8Array first;
// 'abc' and 'musicxml' take the FileReader result as-is (text for 'abc',
// and either text or bytes for 'musicxml' — importMusicXml itself detects
// which, see its own comment).
export function importerFor(kind) {
  if (kind === 'midi') return (data, options) => importMidi(new Uint8Array(data), options);
  if (kind === 'gp7') return (data, options) => importGp7(new Uint8Array(data), options);
  if (kind === 'abc') return importAbc;
  if (kind === 'musicxml') return importMusicXml;
  return null;
}
