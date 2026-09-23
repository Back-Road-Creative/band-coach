// Which importer a file's extension routes to, and how the panel should
// read it (as raw bytes for a binary format, as text for a text format).
// Pure: takes only a file name string, does no I/O itself — the caller
// (src/ui/songs.js) does the actual FileReader read and calls the matching
// importer (src/song/import-midi.js importMidi, src/song/import-abc.js
// importAbc, src/song/import-musicxml.js importMusicXml, src/song/challenge.js
// parseChallenge for a teacher-authored .json challenge file).
//
// Compressed .mxl (zipped MusicXML) is a DELIBERATE non-goal (see
// src/song/import-musicxml.js's own header): reported as
// { kind: 'unsupported-mxl' } so the panel can say so in plain words,
// rather than trying to read it and hitting the importer's thrown error.

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
  if (ext === 'mxl') return { kind: 'unsupported-mxl', readAs: null };
  if (ext === 'json') return { kind: 'challenge', readAs: 'text' };
  return { kind: 'unknown', readAs: null };
}
