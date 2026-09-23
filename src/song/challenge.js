// Teacher challenge lists (plan §11.7 Wave I, unit I6): a teacher-authored
// set of songs handed to a student as one file -- plan decision D6: no
// network, no server, no account, file exchange only; D7: this only tracks
// a ledger of which songs are passed, never XP or leagues.
// A challenge file is JSON: { schema: 'challenge/1', title, from?, note?,
// songs: [song/1 objects] }.
// parseChallenge(text) turns hostile, untrusted file TEXT into a validated
// challenge or throws a plain-English Error -- JSON.parse only, never eval,
// and unknown top-level keys are dropped rather than kept.
// buildChallenge(title, songs, opts) is the export side: turns already-valid
// Song objects (e.g. straight out of src/song/library.js) into the JSON
// text a "Export as a challenge" button hands to a Blob download.
// Pure: no DOM, no FileReader, no clock reads -- see src/ui/songs.js for the
// import-route wiring and the export button.

import { validateSong, normalizeSong } from './model.js';

export const CHALLENGE_SCHEMA = 'challenge/1';
// A generous but bounded cap: a whole term's worth of tunes fits comfortably
// under 50, and it keeps a hostile or corrupted file from asking the
// library to store thousands of "songs" in one go.
export const MAX_CHALLENGE_SONGS = 50;
export const MAX_CHALLENGE_BYTES = 5 * 1024 * 1024;

function isPlainObject(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function isNonEmptyString(x) { return typeof x === 'string' && x.length > 0; }
function byteLength(str) { return new TextEncoder().encode(str).length; }
function messageOf(e) { return e && e.message ? e.message : String(e); }

// Parses and validates challenge file TEXT. Never throws anything but a
// plain-English Error naming what is wrong with the file; never returns a
// partially-broken challenge.
export function parseChallenge(text) {
  if (byteLength(String(text)) > MAX_CHALLENGE_BYTES) {
    throw new Error('that challenge file is too large to open (over 5 MB)');
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error('that file is not valid JSON: ' + messageOf(e));
  }
  if (!isPlainObject(raw)) {
    throw new Error('a challenge file must contain a JSON object');
  }
  if (raw.schema !== CHALLENGE_SCHEMA) {
    throw new Error('that file is not a challenge (expected schema ' + JSON.stringify(CHALLENGE_SCHEMA) + ', got ' + JSON.stringify(raw.schema) + ')');
  }
  if (!isNonEmptyString(raw.title)) {
    throw new Error('a challenge needs a non-empty title');
  }
  if (!Array.isArray(raw.songs) || raw.songs.length === 0) {
    throw new Error('a challenge needs at least one song');
  }
  if (raw.songs.length > MAX_CHALLENGE_SONGS) {
    throw new Error('a challenge can hold at most ' + MAX_CHALLENGE_SONGS + ' songs (this one has ' + raw.songs.length + ')');
  }
  const songs = raw.songs.map((s, i) => {
    try {
      return normalizeSong(s);
    } catch (e) {
      throw new Error('song ' + (i + 1) + ' of the challenge could not be read: ' + messageOf(e));
    }
  });
  // Only these known fields survive: a hostile or careless extra key (a
  // script, a huge blob, anything else) never rides along into app state.
  return {
    schema: CHALLENGE_SCHEMA,
    title: raw.title,
    from: typeof raw.from === 'string' ? raw.from : null,
    note: typeof raw.note === 'string' ? raw.note : null,
    songs,
  };
}

// Builds the JSON text for a challenge file out of already-valid Song
// objects. Never coerces a bad song -- an invalid one here is a bug in the
// caller (e.g. a corrupted library entry), so it is rejected rather than
// guessed at.
export function buildChallenge(title, songs, opts = {}) {
  if (!isNonEmptyString(title)) {
    throw new Error('a challenge needs a non-empty title');
  }
  if (!Array.isArray(songs) || songs.length === 0) {
    throw new Error('a challenge needs at least one song');
  }
  if (songs.length > MAX_CHALLENGE_SONGS) {
    throw new Error('a challenge can hold at most ' + MAX_CHALLENGE_SONGS + ' songs (got ' + songs.length + ')');
  }
  songs.forEach((song, i) => {
    const { ok, errors } = validateSong(song);
    if (!ok) throw new Error('song ' + (i + 1) + ' (' + (song && song.title) + ') is not a valid song: ' + errors.join('; '));
  });
  const challenge = {
    schema: CHALLENGE_SCHEMA,
    title,
    from: typeof opts.from === 'string' && opts.from.length ? opts.from : null,
    note: typeof opts.note === 'string' && opts.note.length ? opts.note : null,
    songs,
  };
  return JSON.stringify(challenge, null, 2);
}
