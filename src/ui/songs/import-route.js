// Which importer a file's extension routes to, and how the panel should
// read it (as raw bytes for a binary format, as text for a text format).
// Pure: takes only a file name string, does no I/O itself — the caller
// (src/ui/songs.js) does the actual FileReader read and calls the matching
// importer (src/song/import-midi.js importMidi, src/song/import-abc.js
// importAbc, src/song/import-musicxml.js importMusicXml, src/song/challenge.js
// parseChallenge for a teacher-authored .json challenge file).
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
  if (ext === 'json') return { kind: 'challenge', readAs: 'text' };
  return { kind: 'unknown', readAs: null };
}
