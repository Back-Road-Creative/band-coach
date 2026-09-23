// Guitar Pro 5 (.gp5) binary reader -- pure module, no DOM, no Node
// built-ins, no network, no third-party code or runtime dependency.
//
// Wiring-pass API:
//   import { importGp5 } from './import-gp5.js';
//   const { song, warnings } = importGp5(uint8Array, { fileName: 'tune.gp5' });
//
// The public .gp5 container is a length-prefixed binary stream: a version
// header, song info strings, a tempo/key block, a fixed 64-slot MIDI
// channel table, then measure headers followed by per-track data laid out
// measure-by-measure, track-by-track, beat-by-beat. This module reads that
// shape from the author's own understanding of the format (there is no
// spec file or network access available while writing it), and every
// field this parser does not need for the Song shape (effect envelopes,
// mix-table changes, beat text, markers' RGB colour, ...) is still read
// and discarded so the byte stream never drifts out of alignment.
//
// HONESTY NOTE: no real Guitar Pro-authored .gp5 file was available to
// test against while writing this (network access is unavailable and no
// binary fixture may be added from the internet). Every automated test for
// this module builds its own minimal GP5-shaped stream with a byte-writer
// helper local to the test file. That proves this parser is internally
// self-consistent; it does NOT prove byte-for-byte compatibility with
// files written by the real Guitar Pro application, whose exact bit-flag
// layout for note/beat effects in particular could plausibly differ from
// this module's best-effort reconstruction. A future change that adds a
// real .gp5 fixture (once one can be legitimately sourced) should be
// treated as the first real verification of this module.
//
// Effects (bends, slides, grace notes, ...) are read as opaque
// length-prefixed blocks and discarded -- Band Coach has no use for them
// yet, but skipping them without breaking alignment matters more than
// modelling them.
//
// Only Guitar Pro 5.x (".gp5") version headers are accepted; GP3/GP4
// (different container layout entirely) and GPX/GP6+ (a zipped XML
// format) are rejected with a plain-English error rather than silently
// misread.

import { songIdentity } from './ident.js';

const TICKS_PER_QUARTER = 480;
const CHANNEL_COUNT = 64;

class ByteReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
  }

  get length() {
    return this.bytes.length;
  }

  ensure(n) {
    if (this.pos + n > this.bytes.length) {
      throw new Error('Unexpected end of Guitar Pro file');
    }
  }

  u8() {
    this.ensure(1);
    return this.bytes[this.pos++];
  }

  i8() {
    const b = this.u8();
    return b > 127 ? b - 256 : b;
  }

  i32() {
    this.ensure(4);
    const b0 = this.bytes[this.pos];
    const b1 = this.bytes[this.pos + 1];
    const b2 = this.bytes[this.pos + 2];
    const b3 = this.bytes[this.pos + 3];
    this.pos += 4;
    const value = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    return value | 0;
  }

  bytesN(n) {
    this.ensure(n);
    const slice = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }

  skip(n) {
    this.ensure(n);
    this.pos += n;
  }
}

const textDecoder = new TextDecoder('utf-8', { fatal: false });
function decodeText(bytes) {
  return textDecoder.decode(bytes);
}

// Fixed-size "Delphi-style" string block: one length byte followed by
// `size` bytes of storage, only the first `length` of which are the text.
function readFixedString(reader, size) {
  const len = reader.u8();
  const block = reader.bytesN(size);
  return decodeText(block.subarray(0, Math.min(len, size)));
}

// GP "info" string: a 4-byte block-size prefix (string length + 1),
// followed by one length byte, followed by that many bytes of text.
function readInfoString(reader) {
  const blockLen = reader.i32();
  const len = reader.u8();
  const n = Math.max(0, Math.min(len, blockLen - 1));
  const bytes = reader.bytesN(n);
  return decodeText(bytes);
}

function readVersion(reader) {
  const text = readFixedString(reader, 30);
  const m = /^FICHIER GUITAR PRO v(\d+)\.(\d+)/.exec(text.trim());
  if (!m) {
    throw new Error(`Not a Guitar Pro 5 file: unrecognised version header "${text.trim()}"`);
  }
  const major = Number(m[1]);
  if (major !== 5) {
    throw new Error(`Unsupported Guitar Pro version ${major}.${m[2]}; only Guitar Pro 5.x (.gp5) files are supported`);
  }
  return { major, minor: Number(m[2]) };
}

function readInfoBlock(reader) {
  const title = readInfoString(reader);
  const subtitle = readInfoString(reader);
  const artist = readInfoString(reader);
  const album = readInfoString(reader);
  readInfoString(reader); // words -- not modelled in the Song shape
  readInfoString(reader); // music
  const copyright = readInfoString(reader);
  readInfoString(reader); // tab
  readInfoString(reader); // instructions
  const noticeCount = reader.i32();
  for (let i = 0; i < noticeCount; i++) readInfoString(reader);
  return { title, subtitle, artist, album, copyright };
}

// Circle-of-fifths: each sharp in the key signature moves the major tonic
// up a fifth (7 semitones); each flat moves it up a fourth (-7 mod 12). A
// minor key's tonic sits a minor third below its relative major's (+9 mod
// 12). Mirrors the same maths in import-midi.js (each importer keeps its
// own tiny copy rather than sharing one, matching this codebase's existing
// pattern).
function keyFromSignature(sf, mode) {
  const majorTonic = (((7 * sf) % 12) + 12) % 12;
  const tonic = mode === 1 ? (majorTonic + 9) % 12 : majorTonic;
  return { tonic, mode: mode === 1 ? 'minor' : 'major' };
}

function readTempoKeyBlock(reader) {
  readInfoString(reader); // tempo name -- decorative only
  const tempo = reader.i32();
  const sf = reader.i8();
  const mode = reader.u8();
  return { tempo, key: keyFromSignature(sf, mode) };
}

function readChannelTable(reader) {
  const channels = [];
  for (let i = 0; i < CHANNEL_COUNT; i++) {
    const instrument = reader.i32();
    reader.skip(8); // volume, balance, chorus, reverb, phaser, tremolo, 2 blank bytes
    channels.push({ instrument });
  }
  return channels;
}

// One measure header. `carry` is the { num, den } from the previous
// measure (time signature carries forward when a measure doesn't restate
// it); the very first measure must set both bits (the test fixtures always
// do, and a real .gp5 file always does too).
function readMeasureHeader(reader, carry) {
  const flags = reader.u8();
  let num = carry.num;
  let den = carry.den;
  if (flags & 0x01) num = reader.u8();
  if (flags & 0x02) den = reader.u8();
  if (flags & 0x08) reader.u8(); // repeat close count
  if (flags & 0x10) reader.u8(); // alternate ending
  if (flags & 0x20) {
    readInfoString(reader); // marker name
    reader.skip(4); // marker colour (RGBA)
  }
  if (flags & 0x40) {
    reader.i8(); // key-change sharps/flats -- not modelled per-measure
    reader.u8(); // key-change mode
  }
  if (flags & 0x01 || flags & 0x02) reader.skip(4); // beam grouping
  reader.u8(); // triplet-feel byte
  return { num, den };
}

function readTrackHeader(reader) {
  const name = readFixedString(reader, 40);
  const stringCount = reader.i32();
  if (stringCount < 1 || stringCount > 8) {
    throw new Error(`Malformed Guitar Pro file: track "${name}" declares ${stringCount} strings`);
  }
  const tuning = [];
  for (let i = 0; i < stringCount; i++) tuning.push(reader.i32());
  const channelIndex = reader.i32();
  reader.i32(); // effects channel
  reader.i32(); // fret count
  reader.i32(); // capo
  reader.skip(4); // colour
  return { name, tuning, channelIndex };
}

// Beat duration byte -> quarter notes: -2 whole, -1 half, 0 quarter,
// 1 eighth, 2 sixteenth, 3 thirty-second, 4 sixty-fourth.
function quartersFromDurationByte(value) {
  return 2 ** -value;
}

function readNote(reader) {
  const string = reader.u8();
  const flags = reader.u8();
  const tie = (flags & 0x01) !== 0;
  const dead = (flags & 0x02) !== 0;
  if (flags & 0x04) reader.u8(); // velocity -- not modelled
  let fret = 0;
  if (flags & 0x08) fret = reader.i8();
  if (flags & 0x10) {
    const len = reader.u8();
    reader.skip(len); // bends, slides, grace notes, ... opaque and discarded
  }
  return { string, tie, dead, fret };
}

// Reads one beat and returns { ticks, notes } where `notes` is a list of
// { string, tie, dead, fret } for strings actually played this beat (empty
// for a rest).
function readBeat(reader) {
  const flags = reader.u8();
  let rest = false;
  let empty = false;
  if (flags & 0x40) {
    const status = reader.u8();
    rest = status === 1;
    empty = status === 2;
  }
  const durationByte = reader.i8();
  let quarters = quartersFromDurationByte(durationByte);
  if (flags & 0x01) quarters *= 1.5; // dotted
  if (flags & 0x20) {
    const tupletN = reader.i32();
    if (tupletN > 0) quarters = (quarters * 2) / tupletN;
  }
  if (flags & 0x04) {
    const len = reader.i32();
    reader.skip(len); // beat text
  }
  if (flags & 0x08) {
    const len = reader.u8();
    reader.skip(len); // beat effects
  }
  if (flags & 0x10) {
    const len = reader.u8();
    reader.skip(len); // mix-table change
  }
  const ticks = Math.max(1, Math.round(quarters * TICKS_PER_QUARTER));
  const notes = [];
  if (!rest && !empty) {
    const stringMask = reader.u8();
    for (let s = 1; s <= 8; s++) {
      if (stringMask & (1 << (s - 1))) notes.push(readNote(reader));
    }
  }
  return { ticks, notes };
}

export function importGp5(bytes, options = {}) {
  const { fileName = null } = options;
  const warnings = [];
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const reader = new ByteReader(arr);

  readVersion(reader);
  const info = readInfoBlock(reader);
  const { tempo, key } = readTempoKeyBlock(reader);
  const channels = readChannelTable(reader);

  const measureCount = reader.i32();
  const trackCount = reader.i32();
  if (measureCount < 0 || trackCount < 0) {
    throw new Error('Malformed Guitar Pro file: negative measure or track count');
  }

  const measures = [];
  let carry = { num: 4, den: 4 };
  let metre = null;
  const metreChanges = [];
  let songTick = 0;
  for (let i = 0; i < measureCount; i++) {
    const m = readMeasureHeader(reader, carry);
    if (i === 0 || m.num !== carry.num || m.den !== carry.den) {
      metreChanges.push({ tick: songTick, num: m.num, den: m.den });
    }
    carry = m;
    measures.push(m);
    if (i === 0) metre = { num: m.num, den: m.den };
    songTick += Math.round(m.num * (4 / m.den) * TICKS_PER_QUARTER);
  }

  const tracks = [];
  for (let i = 0; i < trackCount; i++) tracks.push(readTrackHeader(reader));

  // notesByTrackString[trackIndex] -> Map(stringIndex -> [{start, dur, midi}])
  const notesByTrackString = tracks.map(() => new Map());
  const trackTick = tracks.map(() => 0);

  for (let mi = 0; mi < measureCount; mi++) {
    for (let ti = 0; ti < trackCount; ti++) {
      const beatCount = reader.i32();
      const track = tracks[ti];
      const map = notesByTrackString[ti];
      for (let b = 0; b < beatCount; b++) {
        const { ticks, notes } = readBeat(reader);
        const start = trackTick[ti];
        for (const n of notes) {
          if (n.string < 1 || n.string > track.tuning.length) {
            throw new Error(`Malformed Guitar Pro file: track "${track.name}" has a note on non-existent string ${n.string}`);
          }
          if (n.dead) continue; // consumed correctly above; not a pitched note
          const midi = Math.max(0, Math.min(127, track.tuning[n.string - 1] + n.fret));
          if (!map.has(n.string)) map.set(n.string, []);
          const list = map.get(n.string);
          const prev = list[list.length - 1];
          let tieFromPrev;
          if (n.tie) {
            if (prev && prev.midi === midi && prev.start + prev.dur === start) {
              tieFromPrev = true;
            } else {
              warnings.push(`a tie on "${track.name}" string ${n.string} at tick ${start} had no matching previous note; ignored`);
            }
          }
          list.push(tieFromPrev ? { start, dur: ticks, midi, tieFromPrev: true } : { start, dur: ticks, midi });
        }
        trackTick[ti] += ticks;
      }
    }
  }

  const parts = [];
  tracks.forEach((track, ti) => {
    const instrument = channels[track.channelIndex] ? channels[track.channelIndex].instrument : 0;
    const strings = [...notesByTrackString[ti].keys()].sort((a, b) => a - b);
    for (const stringIndex of strings) {
      const notes = notesByTrackString[ti].get(stringIndex);
      if (notes.length === 0) continue;
      parts.push({
        id: `track-${ti + 1}-string-${stringIndex}`,
        name: `${track.name || `Track ${ti + 1}`} (string ${stringIndex})`,
        instrumentHint: `MIDI instrument ${instrument}`,
        notes,
      });
    }
  });

  const { id, title } = songIdentity({ title: info.title, fileName, fallback: 'Imported tab' });

  const song = {
    schema: 'song/1',
    id,
    title,
    composer: info.artist || null,
    licence: info.copyright || null,
    source: fileName ?? null,
    key,
    metre: metre ?? { num: 4, den: 4 },
    bpm: tempo > 0 ? tempo : 120,
    ticksPerQuarter: TICKS_PER_QUARTER,
    parts,
    chords: [],
    metreChanges,
  };

  return { song, warnings };
}
