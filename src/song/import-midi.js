// Standard MIDI File (SMF) reader — pure module, no DOM, no Node built-ins.
//
// Wiring-pass API:
//   import { importMidi } from './import-midi.js';
//   const { song, warnings } = importMidi(uint8Array, { fileName: 'tune.mid' });
//
// `importMidi(bytes, { fileName })` accepts a Uint8Array (or anything array-like
// that `new Uint8Array(...)` accepts) holding the raw bytes of a .mid file and
// returns `{ song, warnings }`.
//
// `song` matches the shared Song shape documented in the Band Coach author
// brief (schema 'song/1', ticksPerQuarter always 480 regardless of the
// source file's own PPQ — this module rescales). `warnings` is an array of
// plain-English strings describing anything lossy or ambiguous about the
// import (currently: ignored tempo changes after the first).
//
// Supports SMF format 0 and format 1. Format 2 (independent multi-song
// files) and SMPTE-based time division are rejected with a thrown Error
// carrying a plain-English message, as is any file too short/corrupt to
// parse — this module never loops forever or reads out of bounds no matter
// how a file is truncated.
//
// One `part` is produced per (track, channel) pair that has at least one
// note. Channel 10 (0-based index 9), the General MIDI percussion channel,
// is marked in the part name.

const MTHD = [0x4d, 0x54, 0x68, 0x64]; // "MThd"
const MTRK = [0x4d, 0x54, 0x72, 0x6b]; // "MTrk"

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

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
      throw new Error('Unexpected end of MIDI file');
    }
  }

  u8() {
    this.ensure(1);
    return this.bytes[this.pos++];
  }

  u16() {
    this.ensure(2);
    const value = (this.bytes[this.pos] << 8) | this.bytes[this.pos + 1];
    this.pos += 2;
    return value;
  }

  u32() {
    this.ensure(4);
    const value =
      this.bytes[this.pos] * 0x1000000 +
      (this.bytes[this.pos + 1] << 16) +
      (this.bytes[this.pos + 2] << 8) +
      this.bytes[this.pos + 3];
    this.pos += 4;
    return value >>> 0;
  }

  bytesN(n) {
    this.ensure(n);
    const slice = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }

  // Variable-length quantity: up to 4 bytes, top bit = "more follows".
  vlq() {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      value = (value << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) return value >>> 0;
    }
    throw new Error('Malformed MIDI file: variable-length quantity longer than 4 bytes');
  }
}

function parseHeader(reader) {
  const chunkType = reader.bytesN(4);
  if (!bytesEqual(chunkType, MTHD)) {
    throw new Error('Not a MIDI file: missing MThd header chunk');
  }
  const length = reader.u32();
  if (length < 6) {
    throw new Error('Malformed MIDI file: header chunk shorter than 6 bytes');
  }
  const headerStart = reader.pos;
  const format = reader.u16();
  const ntrks = reader.u16();
  const division = reader.u16();
  // Skip any extra header bytes some writers include.
  reader.pos = headerStart + length;
  if (reader.pos > reader.length) {
    throw new Error('Unexpected end of MIDI file');
  }

  if (format === 2) {
    throw new Error('Format 2 MIDI files (independent song list) are not supported');
  }
  if (format !== 0 && format !== 1) {
    throw new Error(`Unsupported MIDI file format ${format}`);
  }
  if ((division & 0x8000) !== 0) {
    throw new Error('SMPTE-based time division is not supported');
  }
  const ppq = division;
  if (ppq === 0) {
    throw new Error('Malformed MIDI file: ticks-per-quarter-note is zero');
  }
  return { format, ntrks, ppq };
}

function signedByte(b) {
  return b > 127 ? b - 256 : b;
}

// Circle-of-fifths: each sharp in the key signature moves the major tonic
// up a fifth (7 semitones); each flat moves it up a fourth (5 semitones,
// i.e. -7 mod 12). A minor key's tonic is a minor third below its relative
// major's, i.e. +9 semitones mod 12 (both computed, never looked up).
function keyFromSignature(sf, mi) {
  const majorTonic = (((7 * sf) % 12) + 12) % 12;
  const tonic = mi === 1 ? (majorTonic + 9) % 12 : majorTonic;
  return { tonic, mode: mi === 1 ? 'minor' : 'major' };
}

const textDecoder = new TextDecoder('utf-8', { fatal: false });

function decodeText(bytes) {
  return textDecoder.decode(bytes);
}

function handleMeta(metaType, data, absTick, ctx, warnings) {
  if (metaType === 0x51 && data.length >= 3) {
    const microsPerQuarter = (data[0] << 16) | (data[1] << 8) | data[2];
    const bpm = microsPerQuarter > 0 ? 60000000 / microsPerQuarter : 120;
    if (!ctx.tempoSet) {
      ctx.bpm = bpm;
      ctx.tempoSet = true;
    } else if (Math.abs(bpm - ctx.bpm) > 1e-9) {
      warnings.push(
        `Tempo change to ${Math.round(bpm * 100) / 100} bpm at tick ${absTick} was ignored; using the first tempo (${Math.round(ctx.bpm * 100) / 100} bpm) for the whole song.`
      );
    }
  } else if (metaType === 0x58 && data.length >= 2 && !ctx.metreSet) {
    const num = data[0];
    const den = 2 ** data[1];
    ctx.metre = { num, den };
    ctx.metreSet = true;
  } else if (metaType === 0x59 && data.length >= 2 && !ctx.keySet) {
    const sf = signedByte(data[0]);
    const mi = data[1];
    ctx.key = keyFromSignature(sf, mi);
    ctx.keySet = true;
  }
  // Other meta types (instrument name, lyric, marker, cue point, SMPTE
  // offset, sequencer-specific, ...) carry no data this Song shape needs
  // and are safely ignored — the length-prefixed read already consumed
  // exactly their bytes.
}

function parseTrack(trackReader, trackIndex, ctx, warnings) {
  let runningStatus = null;
  let absTick = 0;
  let ended = false;
  let name = null;
  let sawName = false;
  const openNotes = new Map(); // "channel:pitch" -> [{start}, ...] (FIFO for overlaps)
  const notesByChannel = new Map(); // channel -> [{start, dur, midi}, ...]

  function pushNote(channel, pitch, start, end) {
    if (!notesByChannel.has(channel)) notesByChannel.set(channel, []);
    notesByChannel.get(channel).push({ start, dur: Math.max(1, end - start), midi: pitch });
  }

  function noteOn(channel, pitch, tick) {
    const key = `${channel}:${pitch}`;
    if (!openNotes.has(key)) openNotes.set(key, []);
    openNotes.get(key).push(tick);
  }

  function noteOff(channel, pitch, tick) {
    const key = `${channel}:${pitch}`;
    const queue = openNotes.get(key);
    if (queue && queue.length > 0) {
      const start = queue.shift();
      pushNote(channel, pitch, start, tick);
    }
    // A note-off with no matching note-on is out-of-spec but harmless to ignore.
  }

  while (!ended) {
    if (trackReader.pos >= trackReader.length) {
      throw new Error(`Unexpected end of MIDI file: track ${trackIndex} has no end-of-track marker`);
    }
    const delta = trackReader.vlq();
    absTick += delta;
    let statusByte = trackReader.u8();
    if (statusByte < 0x80) {
      if (runningStatus === null) {
        throw new Error(`Malformed MIDI file: track ${trackIndex} uses running status before any status byte`);
      }
      trackReader.pos -= 1; // this byte is really the first data byte
      statusByte = runningStatus;
    } else if (statusByte !== 0xff && statusByte !== 0xf0 && statusByte !== 0xf7) {
      runningStatus = statusByte;
    }

    const hi = statusByte & 0xf0;
    if (statusByte === 0xff) {
      const metaType = trackReader.u8();
      const len = trackReader.vlq();
      const data = trackReader.bytesN(len);
      if (metaType === 0x03 && !sawName) {
        name = decodeText(data);
        sawName = true;
      }
      handleMeta(metaType, data, absTick, ctx, warnings);
      if (metaType === 0x2f) ended = true;
    } else if (statusByte === 0xf0 || statusByte === 0xf7) {
      // Sysex: length-prefixed, safe to skip entirely regardless of contents.
      const len = trackReader.vlq();
      trackReader.bytesN(len);
      runningStatus = null;
    } else if (hi === 0x80 || hi === 0x90 || hi === 0xa0 || hi === 0xb0 || hi === 0xe0) {
      const channel = statusByte & 0x0f;
      const d1 = trackReader.u8();
      const d2 = trackReader.u8();
      if (hi === 0x80 || (hi === 0x90 && d2 === 0)) {
        noteOff(channel, d1, absTick);
      } else if (hi === 0x90) {
        noteOn(channel, d1, absTick);
      }
      // 0xA0 poly aftertouch, 0xB0 control change, 0xE0 pitch bend: no
      // effect on this Song shape, but their bytes are already consumed.
    } else if (hi === 0xc0 || hi === 0xd0) {
      trackReader.u8(); // program change / channel pressure: one data byte
    } else {
      throw new Error(
        `Unsupported MIDI status byte 0x${statusByte.toString(16)} in track ${trackIndex} at tick ${absTick}`
      );
    }
  }

  // Any note that never received a matching note-off is closed at the
  // end of the track rather than dropped.
  for (const [key, queue] of openNotes) {
    const [channelStr, pitchStr] = key.split(':');
    const channel = Number(channelStr);
    const pitch = Number(pitchStr);
    for (const start of queue) {
      pushNote(channel, pitch, start, Math.max(start + 1, absTick));
    }
  }

  return { name, notesByChannel };
}

function rescaleNote(note, scale) {
  const start = Math.round(note.start * scale);
  let end = Math.round((note.start + note.dur) * scale);
  if (end <= start) end = start + 1;
  return { start, dur: end - start, midi: note.midi };
}

function slugify(fileName) {
  const withoutExt = fileName.replace(/\.[^./\\]+$/, '');
  const slug = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'imported-midi';
}

function stripExt(fileName) {
  return fileName.replace(/\.[^./\\]+$/, '');
}

export function importMidi(bytes, options = {}) {
  const { fileName = null } = options;
  const warnings = [];
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const reader = new ByteReader(arr);
  const { ntrks, ppq } = parseHeader(reader);

  const ctx = { bpm: null, tempoSet: false, metre: null, metreSet: false, key: null, keySet: false };
  const tracks = [];
  let tracksParsed = 0;

  while (tracksParsed < ntrks) {
    if (reader.pos >= reader.length) {
      throw new Error(
        `Unexpected end of MIDI file: header declares ${ntrks} track chunk(s), found ${tracksParsed}`
      );
    }
    const chunkType = reader.bytesN(4);
    const chunkLen = reader.u32();
    const chunkBytes = reader.bytesN(chunkLen);
    if (bytesEqual(chunkType, MTRK)) {
      const trackReader = new ByteReader(chunkBytes);
      const { name, notesByChannel } = parseTrack(trackReader, tracksParsed, ctx, warnings);
      tracks.push({ name, notesByChannel });
      tracksParsed++;
    }
    // Any other chunk type is unknown-but-well-formed (length-prefixed) and
    // is skipped safely by the bytesN(chunkLen) read above.
  }

  const scale = 480 / ppq;
  const parts = [];
  tracks.forEach((track, trackIndex) => {
    const multiChannel = track.notesByChannel.size > 1;
    for (const [channel, notes] of track.notesByChannel) {
      if (notes.length === 0) continue;
      const rescaled = notes.map((n) => rescaleNote(n, scale)).sort((a, b) => a.start - b.start);
      let name = track.name || `Track ${trackIndex + 1}`;
      if (multiChannel) name += ` (ch ${channel + 1})`;
      if (channel === 9) name += ' (percussion)';
      parts.push({ id: `part-${parts.length + 1}`, name, notes: rescaled });
    }
  });

  const bpm = ctx.bpm ?? 120;
  const metre = ctx.metre ?? { num: 4, den: 4 };
  const key = ctx.key ?? null;
  const title = (tracks[0] && tracks[0].name) || (fileName ? stripExt(fileName) : null) || 'Untitled MIDI Import';
  const id = fileName ? slugify(fileName) : 'imported-midi';

  const song = {
    schema: 'song/1',
    id,
    title,
    composer: null,
    licence: null,
    source: fileName ?? null,
    key,
    metre,
    bpm,
    ticksPerQuarter: 480,
    parts,
    chords: [],
  };

  return { song, warnings };
}
