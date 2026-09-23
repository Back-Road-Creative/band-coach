// Band packs: a whole set of songs (plus, optionally, who in the band plays
// which part of each) handed around as ONE zip file -- plan decision D6: no
// network, no server, no account, file exchange only, same as the teacher
// challenge lists in src/song/challenge.js. Where a challenge is one JSON
// file, a band pack is a small zip: a `band-pack.json` manifest plus one
// `songs/<n>.json` per song, so a pack full of songs never becomes one
// unwieldy JSON blob and each song stays independently readable.
//
// writeBandPack({ name, songs, parts? }) -> Uint8Array
//   Builds the zip. `songs` are already-valid Song objects (e.g. straight
//   out of src/song/library.js, its "stored form"). `parts`, if given, is
//   an array parallel to `songs`: parts[i] is either an assignment object
//   { memberName: partIndex, ... } for songs[i], or null/undefined for "no
//   assignment yet". The zip's entries are STORED (no compression) -- a
//   band pack is text, so there is nothing to gain from deflate, and it
//   keeps the writer a CRC-32 table plus some byte pushing, no encoder.
// readBandPack(bytes) -> { name, songs, parts }
//   Reads bytes untrusted -- a file handed over by another user -- via
//   unzip-lite, and never throws anything but a plain-English Error naming
//   what is wrong with the file.
//
// Pure: no DOM, no FileReader, no clock reads -- see src/ui/songs.js for
// the import-route wiring and the export button.

import { validateSong, normalizeSong } from './model.js';
import { readZipEntries, readZipEntryData } from './unzip-lite.js';

export const BAND_PACK_FORMAT = 'band-pack';
export const BAND_PACK_VERSION = '1.0';
const BAND_PACK_MAJOR = 1;
const MANIFEST_NAME = 'band-pack.json';

function isPlainObject(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function isNonEmptyString(x) { return typeof x === 'string' && x.length > 0; }
function isInt(x) { return typeof x === 'number' && Number.isFinite(x) && Math.floor(x) === x; }
function messageOf(e) { return e && e.message ? e.message : String(e); }

// ---- own minimal zip writer (stored entries only) ----------------------

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pushU16(arr, v) { arr.push(v & 0xff, (v >>> 8) & 0xff); }
function pushU32(arr, v) { arr.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); }
function pushBytes(arr, bytes) { for (let i = 0; i < bytes.length; i += 1) arr.push(bytes[i]); }

// Builds a zip from `[{ name, data: Uint8Array }, ...]`, all entries
// stored (uncompressed). Readable by src/song/unzip-lite.js and by any
// standard zip tool.
function writeZip(entries) {
  const encoder = new TextEncoder();
  const out = [];
  const central = [];
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const localOffset = out.length;
    pushU32(out, LOCAL_SIG);
    pushU16(out, 20); // version needed to extract
    pushU16(out, 0); // general purpose bit flag
    pushU16(out, 0); // compression method: stored
    pushU16(out, 0); // last mod file time
    pushU16(out, 0); // last mod file date
    pushU32(out, crc);
    pushU32(out, data.length); // compressed size
    pushU32(out, data.length); // uncompressed size
    pushU16(out, nameBytes.length);
    pushU16(out, 0); // extra field length
    pushBytes(out, nameBytes);
    pushBytes(out, data);
    central.push({ nameBytes, crc, size: data.length, localOffset });
  }
  const cdStart = out.length;
  for (const rec of central) {
    pushU32(out, CENTRAL_SIG);
    pushU16(out, 20); // version made by
    pushU16(out, 20); // version needed to extract
    pushU16(out, 0); // general purpose bit flag
    pushU16(out, 0); // compression method: stored
    pushU16(out, 0); // last mod file time
    pushU16(out, 0); // last mod file date
    pushU32(out, rec.crc);
    pushU32(out, rec.size);
    pushU32(out, rec.size);
    pushU16(out, rec.nameBytes.length);
    pushU16(out, 0); // extra field length
    pushU16(out, 0); // file comment length
    pushU16(out, 0); // disk number start
    pushU16(out, 0); // internal file attributes
    pushU32(out, 0); // external file attributes
    pushU32(out, rec.localOffset);
    pushBytes(out, rec.nameBytes);
  }
  const cdSize = out.length - cdStart;
  pushU32(out, EOCD_SIG);
  pushU16(out, 0); // number of this disk
  pushU16(out, 0); // disk where central directory starts
  pushU16(out, entries.length); // records on this disk
  pushU16(out, entries.length); // total records
  pushU32(out, cdSize);
  pushU32(out, cdStart);
  pushU16(out, 0); // comment length
  return Uint8Array.from(out);
}

// ---- band pack ----------------------------------------------------------

// Builds a band pack zip out of already-valid Song objects. Never coerces a
// bad song -- an invalid one here is a bug in the caller (e.g. a corrupted
// library entry), so it is rejected rather than guessed at.
export function writeBandPack({ name, songs, parts } = {}) {
  if (!isNonEmptyString(name)) {
    throw new Error('a band pack needs a non-empty name');
  }
  if (!Array.isArray(songs) || songs.length === 0) {
    throw new Error('a band pack needs at least one song');
  }
  if (parts !== undefined && parts !== null && !Array.isArray(parts)) {
    throw new Error('parts must be an array parallel to songs, or omitted');
  }
  songs.forEach((song, i) => {
    const { ok, errors } = validateSong(song);
    if (!ok) throw new Error('song ' + (i + 1) + ' (' + (song && song.title) + ') is not a valid song: ' + errors.join('; '));
  });
  const manifestSongs = songs.map((song, i) => {
    const assignment = Array.isArray(parts) ? parts[i] : undefined;
    if (assignment !== undefined && assignment !== null) {
      if (!isPlainObject(assignment)) {
        throw new Error('the part assignment for song ' + (i + 1) + ' (' + song.title + ') must be an object of { member: partIndex }');
      }
      for (const [member, partIndex] of Object.entries(assignment)) {
        if (!isNonEmptyString(member)) {
          throw new Error('the part assignment for song ' + (i + 1) + ' (' + song.title + ') has a blank member name');
        }
        if (!isInt(partIndex) || partIndex < 0 || partIndex >= song.parts.length) {
          throw new Error('the part assignment for song ' + (i + 1) + ' (' + song.title + '): "' + member + '" points at part ' + JSON.stringify(partIndex) + ', which is not one of this song\'s ' + song.parts.length + ' part(s)');
        }
      }
    }
    return {
      title: song.title,
      file: 'songs/' + i + '.json',
      parts: (assignment !== undefined && assignment !== null) ? assignment : undefined,
    };
  });
  const manifest = {
    format: BAND_PACK_FORMAT,
    version: BAND_PACK_VERSION,
    name,
    songs: manifestSongs,
  };
  const encoder = new TextEncoder();
  const entries = [{ name: MANIFEST_NAME, data: encoder.encode(JSON.stringify(manifest, null, 2)) }];
  songs.forEach((song, i) => {
    entries.push({ name: 'songs/' + i + '.json', data: encoder.encode(JSON.stringify(song)) });
  });
  return writeZip(entries);
}

// Reads and validates a band pack from untrusted zip bytes -- a file handed
// over by another band member. Never throws anything but a plain-English
// Error naming what is wrong with the file; never returns a partially-broken
// pack.
export function readBandPack(bytes) {
  const entries = readZipEntries(bytes);
  const byName = new Map(entries.map((e) => [e.name, e]));

  const manifestEntry = byName.get(MANIFEST_NAME);
  if (!manifestEntry) {
    throw new Error('this file has no ' + MANIFEST_NAME + ' manifest -- it does not look like a band pack');
  }
  const decoder = new TextDecoder('utf-8');
  let manifest;
  try {
    manifest = JSON.parse(decoder.decode(readZipEntryData(bytes, manifestEntry)));
  } catch (e) {
    throw new Error('the band pack manifest is not valid JSON: ' + messageOf(e));
  }
  if (!isPlainObject(manifest)) {
    throw new Error('the band pack manifest must contain a JSON object');
  }
  if (manifest.format !== BAND_PACK_FORMAT) {
    throw new Error('that file is not a band pack (expected format ' + JSON.stringify(BAND_PACK_FORMAT) + ', got ' + JSON.stringify(manifest.format) + ')');
  }
  const major = parseInt(String(manifest.version).split('.')[0], 10);
  if (!Number.isFinite(major) || major > BAND_PACK_MAJOR) {
    throw new Error('this band pack was made by a newer version of Band Coach (version ' + JSON.stringify(manifest.version) + ') and can\'t be opened here -- ask whoever sent it to export an older-format pack, or update Band Coach');
  }
  if (!isNonEmptyString(manifest.name)) {
    throw new Error('a band pack needs a non-empty name');
  }
  if (!Array.isArray(manifest.songs) || manifest.songs.length === 0) {
    throw new Error('a band pack needs at least one song');
  }

  const songs = [];
  const parts = [];
  manifest.songs.forEach((songEntry, i) => {
    if (!isPlainObject(songEntry) || !isNonEmptyString(songEntry.file)) {
      throw new Error('song ' + (i + 1) + ' of the band pack has no file listed in the manifest');
    }
    const zipEntry = byName.get(songEntry.file);
    if (!zipEntry) {
      throw new Error('song ' + (i + 1) + ' of the band pack (' + JSON.stringify(songEntry.title) + ') is missing its file (' + songEntry.file + ')');
    }
    let raw;
    try {
      raw = JSON.parse(decoder.decode(readZipEntryData(bytes, zipEntry)));
    } catch (e) {
      throw new Error('song ' + (i + 1) + ' of the band pack could not be read: ' + messageOf(e));
    }
    let song;
    try {
      song = normalizeSong(raw);
    } catch (e) {
      throw new Error('song ' + (i + 1) + ' of the band pack could not be read: ' + messageOf(e));
    }
    songs.push(song);
    parts.push(isPlainObject(songEntry.parts) ? songEntry.parts : null);
  });

  return { name: manifest.name, songs, parts };
}
