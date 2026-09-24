// Pure classifier for Songs' single "Add a song" file input (plan P3-4,
// replacing the three-panel ADD_SONG_PANELS row and #songsFileInput in
// src/ui/songs.js). Tells whether a dropped/picked file is a notation file
// (one of the kinds src/ui/songs/import-route.js's routeImportFile already
// routes to an importer: midi/abc/musicxml/gp7/gp5), an audio recording (the
// same audio/* MIME + extension rule as src/ui/learn/source.js's
// learnSourceFor), a band pack, a challenge, or unknown -- so Add a song
// never has to ask the learner what kind of thing they picked.
//
// No DOM, no File object, no I/O: takes only the two strings a browser File
// already exposes (`file.name`, `file.type`).
import { routeImportFile } from './import-route.js';
import { LEARN_AUDIO_EXTENSIONS } from '../learn/source.js';

const NOTATION_ROUTE_KINDS = new Set(['midi', 'abc', 'musicxml', 'gp7', 'gp5']);

function extensionOf(fileName) {
  const name = String(fileName || '');
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

// classifyAddFile(fileName, mimeType) -> { kind, route }. `route` is
// routeImportFile's own result (kind/readAs), carried along so a caller that
// already knows how to dispatch a routed kind (songs.js's existing
// importerFor wiring) does not have to route the file a second time. For
// audio, `route` is null -- routeImportFile has no notion of a recording.
export function classifyAddFile(fileName, mimeType) {
  const route = routeImportFile(fileName);
  if (NOTATION_ROUTE_KINDS.has(route.kind)) return { kind: 'notation', route };
  if (route.kind === 'challenge') return { kind: 'challenge', route };
  if (route.kind === 'band-pack') return { kind: 'band-pack', route };
  const mime = String(mimeType || '').toLowerCase();
  const ext = extensionOf(fileName);
  if (mime.startsWith('audio/') || LEARN_AUDIO_EXTENSIONS.includes(ext)) return { kind: 'audio', route: null };
  return { kind: 'unknown', route };
}

// The <input accept> value and the plain-language help line next to it --
// kept as one list by hand so a new extension added to routeImportFile or
// LEARN_AUDIO_EXTENSIONS is easy to add here too (there is no automatic way
// to derive an <input accept> string from those modules' internal branches).
export const ADD_ACCEPT = '.mid,.midi,.abc,.xml,.musicxml,.mxl,.gp,.gp5,.bandpack,.json,.wav,.mp3,.ogg,.m4a,.flac,.webm';

export const ADD_HELP_LINE = 'Add a score (.mid, .midi, .abc, .xml, .musicxml, .mxl, .gp, .gp5), a recording (.wav, .mp3, .ogg, .m4a, .flac, .webm), a band pack (.bandpack) or a challenge (.json).';

// Shown when classifyAddFile returns 'unknown' -- names the two most common
// things a learner is likely trying to add (a recording, a score file) so
// the message reads as help, not a dead end.
export const UNSUPPORTED_MESSAGE = 'That file type is not supported yet. Try a recording (like .wav or .mp3) or a score file (like .mid or .musicxml) instead.';
