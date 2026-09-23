// Pure classifier for the "Learn this" panel (src/ui/learn.js, plan
// §11.5.7): tells whether a dropped/picked file is a notation file (one of
// the kinds src/ui/songs/import-route.js's routeImportFile already routes
// to an importer: midi/abc/musicxml/gp7/gp5), an audio recording, or neither --
// so the panel never has to ask the learner "what kind of thing is this?"
// (the plan's "any source, one door" acceptance).
//
// A band pack (.bandpack), a teacher challenge (.json) and any other zip
// are deliberately NOT a learn source here: both hold more than one song
// and have their own import flow already (src/ui/songs.js's file input), so
// this panel reports them 'unknown' rather than guessing which song inside
// one the learner meant.
//
// No DOM, no File object, no I/O: takes only the two strings a browser File
// already exposes (`file.name`, `file.type`) so it is trivially unit
// testable and so the panel's own file/drop handling stays the only place
// that touches an actual File.
import { routeImportFile } from '../songs/import-route.js';

const NOTATION_KINDS = new Set(['midi', 'abc', 'musicxml', 'gp7', 'gp5']);

// Extensions a browser's audio/video MIME sniffing can miss or leave blank
// (e.g. a `Blob` built from a MediaRecorder chunk, or a file dragged in from
// a tool that never set a MIME type) -- kept in sync by hand with what real
// mic/DAW exports produce, same spirit as import-route.js's own extension
// list.
export const LEARN_AUDIO_EXTENSIONS = ['wav', 'mp3', 'ogg', 'm4a', 'flac', 'webm'];

function extensionOf(fileName) {
  const name = String(fileName || '');
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function learnSourceFor(fileName, mimeType) {
  const route = routeImportFile(fileName);
  if (NOTATION_KINDS.has(route.kind)) return 'notation';
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('audio/')) return 'audio';
  if (LEARN_AUDIO_EXTENSIONS.includes(extensionOf(fileName))) return 'audio';
  return 'unknown';
}
