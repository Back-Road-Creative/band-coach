// Guitar Pro 5 (.gp5) binary reader -- pure module, no DOM, no Node
// built-ins, no network, no third-party code or runtime dependency.
//
// Wiring-pass API:
//   import { importGp5 } from './import-gp5.js';
//   const { song, warnings } = importGp5(uint8Array, { fileName: 'tune.gp5' });
//
// PROVENANCE: the byte layout below was reverse-engineered against real
// Guitar Pro 5.1-authored .gp5 files (tests/fixtures/gp5/, sourced from the
// alphaTab and PyGuitarPro open-source projects -- see that directory's
// README for exact sources), cross-checked field-by-field against the
// PyGuitarPro project's independent GP3/GP4/GP5 reader implementation
// (github.com/Perlence/PyGuitarPro, LGPL-3.0; read for reference only,
// nothing from it is copied here). An earlier version of this module was
// written from memory with no real file or reference reader available and
// got the song header, measure header, track header and note layout wrong
// in more than a dozen places -- most importantly, it assumed one voice per
// measure per track where the real format always writes two, and it read
// entirely different bit positions for the note/beat status and string
// flags than the ones Guitar Pro actually writes.
//
// The container is: version header, score info, lyrics, RSE master effect,
// page setup, tempo/key/octave, a fixed 64-slot MIDI channel table,
// direction markers, master reverb, then measure headers, then per-track
// headers, then the measures themselves laid out measure-by-measure,
// track-by-track, voice-by-voice (always exactly two voices per
// measure/track), beat-by-beat.
//
// Effects (bends, slides, grace notes, harmonics, trills, chord diagrams,
// mix-table changes, beat/note display flags, RSE instrument blocks, ...)
// are walked field-by-field and discarded -- Band Coach has no use for
// them, but unlike a flat "opaque length-prefixed block" (which is what an
// earlier version of this file assumed), none of these structures actually
// carry a length prefix in the real format, so skipping them wrong
// desynchronises every byte read after them. Only the *second* voice of
// each measure is walked and discarded this way -- Band Coach's Song shape
// has one flat note list per string, so this importer surfaces voice one
// (the primary voice) and parses-but-drops voice two to stay aligned.
//
// Only Guitar Pro 5.x (".gp5") version headers are accepted; GP3/GP4
// (different container layout entirely) and GPX/GP6+ (a zipped XML
// format) are rejected with a plain-English error rather than silently
// misread. Both GP5.0 ("v5.00") and GP5.1+ ("v5.10") sub-layouts are
// handled -- 5.1 added a chunk of RSE (Realistic Sound Engine) fields that
// 5.0 files don't have.

import { songIdentity } from './ident.js';

const TICKS_PER_QUARTER = 480;
const CHANNEL_COUNT = 64;
// Mirrors model.js's VALID_DENOMINATORS -- this importer validates the
// metre itself (see the measure-header loop below) rather than trusting a
// hostile byte stream, matching keyFromSignature's "each importer keeps its
// own tiny copy" pattern above.
const VALID_DENOMINATORS = [1, 2, 4, 8, 16, 32, 64];
// An n-tuplet packs `n` notes into the time of TUPLET_TIMES[n] notes of the
// nominal duration (e.g. a triplet, n=3, packs 3 notes into the time of 2).
// Values Guitar Pro doesn't recognise here are written to the file but
// have no timing effect when read back.
const TUPLET_TIMES = { 3: 2, 5: 4, 6: 4, 7: 4, 9: 8, 10: 8, 11: 8, 12: 8, 13: 8 };

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

  // Like u8(), but returns `fallback` instead of throwing when the file
  // ends exactly here. Guitar Pro itself is happy to omit the very last
  // measure's trailing line-break byte (the writer's `readU8(default=0)`
  // equivalent) -- a real file's very last measure/track pair may simply
  // stop right there, and that's not truncation.
  u8OrDefault(fallback) {
    if (this.pos >= this.bytes.length) return fallback;
    return this.u8();
  }

  u8() {
    this.ensure(1);
    return this.bytes[this.pos++];
  }

  i8() {
    const b = this.u8();
    return b > 127 ? b - 256 : b;
  }

  i16() {
    this.ensure(2);
    const b0 = this.bytes[this.pos];
    const b1 = this.bytes[this.pos + 1];
    this.pos += 2;
    const value = b0 | (b1 << 8);
    return value > 0x7fff ? value - 0x10000 : value;
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

// GP "info" string ("int-byte-size-string"): a 4-byte block-size prefix
// (string length + 1), followed by one length byte, followed by
// (blockSize - 1) bytes of storage -- the writer always sets blockSize to
// length+1, so in a well-formed file that storage is exactly the text, but
// a hostile/truncated file could disagree with the length byte, so the
// storage region (not the length byte) is what decides how many bytes this
// consumes.
function readInfoString(reader) {
  const blockLen = reader.i32();
  const len = reader.u8();
  const n = Math.max(0, blockLen - 1);
  const bytes = reader.bytesN(n);
  return decodeText(bytes.subarray(0, Math.min(len, n)));
}

// Lyrics line string ("int-size-string"): a 4-byte length prefix followed
// by that many raw bytes, with no separate length byte (unlike an info
// string).
function readIntSizeString(reader) {
  const n = Math.max(0, reader.i32());
  return decodeText(reader.bytesN(n));
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

// Lyrics: a track index the lyrics are bound to, then 5 fixed lyric lines
// (starting-measure + text). Band Coach doesn't model lyrics.
function skipLyrics(reader) {
  reader.i32(); // bound track index
  for (let i = 0; i < 5; i++) {
    reader.i32(); // starting measure
    readIntSizeString(reader); // line text
  }
}

// RSE (Realistic Sound Engine) master effect, GP5.1+ only: master volume,
// a reserved int, and an 11-knob equalizer (10 bands + gain, one signed
// byte each).
function skipRSEMasterEffect(reader, minor) {
  if (minor === 0) return;
  reader.i32(); // volume
  reader.i32(); // reserved
  reader.skip(11); // equalizer knobs
}

// Page/print layout: page size and margins, a size proportion, a
// header/footer bitmask, then 10 placeholder strings (title, subtitle,
// artist, album, words, music, wordsAndMusic, two copyright lines, page
// number) used to build the printed header/footer text.
function skipPageSetup(reader) {
  reader.skip(6 * 4); // page size (2 ints) + margins (4 ints)
  reader.i32(); // score size proportion
  reader.i16(); // header/footer element bitmask
  for (let i = 0; i < 10; i++) readInfoString(reader);
}

// RSE instrument block: MIDI instrument, an unknown int, a sound bank, and
// an effect number -- stored as a 32-bit int in GP5.1+, or a 16-bit int
// plus a blank byte in GP5.0.
function skipRSEInstrument(reader, minor) {
  reader.i32(); // instrument
  reader.i32(); // unknown
  reader.i32(); // sound bank
  if (minor === 0) {
    reader.i16();
    reader.skip(1);
  } else {
    reader.i32();
  }
}

// GP5.1+ only: an effect name and category, each an info string.
function skipRSEInstrumentEffect(reader, minor) {
  if (minor === 0) return;
  readInfoString(reader);
  readInfoString(reader);
}

// Bend/tremolo-bar effect: a type byte, a value, a point count, then that
// many (position, value, vibrato-flag) points.
function skipBend(reader) {
  reader.i8(); // type
  reader.i32(); // value
  const pointCount = reader.i32();
  reader.skip(pointCount * 9); // position(i32) + value(i32) + vibrato(bool)
}

// Harmonic effect: a type byte, plus 3 more bytes if artificial (pitch
// class, accidental, octave) or 1 more if tapped (fret).
function skipHarmonic(reader) {
  const type = reader.i8();
  if (type === 2) reader.skip(3);
  else if (type === 3) reader.skip(1);
}

// Note-level effects (bend/hammer/slide/let-ring/grace/tremolo-picking/
// harmonic/trill), gated by two flag bytes.
function skipNoteEffects(reader) {
  const flags1 = reader.u8();
  const flags2 = reader.u8();
  if (flags1 & 0x01) skipBend(reader);
  if (flags1 & 0x10) reader.skip(5); // grace note: fret, velocity, transition, duration, flags
  if (flags2 & 0x04) reader.u8(); // tremolo picking speed
  if (flags2 & 0x08) reader.u8(); // slide type bitmask
  if (flags2 & 0x10) skipHarmonic(reader);
  if (flags2 & 0x20) reader.skip(2); // trill: fret + period
}

// Beat-level effects (slap, tremolo bar, stroke, pick direction), gated by
// two flag bytes.
function skipBeatEffects(reader) {
  const flags1 = reader.u8();
  const flags2 = reader.u8();
  if (flags1 & 0x20) reader.u8(); // slap effect
  if (flags2 & 0x04) skipBend(reader); // tremolo bar reuses the bend shape
  if (flags1 & 0x40) reader.skip(2); // stroke down/up speed
  if (flags2 & 0x02) reader.u8(); // pick stroke direction
}

// Chord diagram: an old-format (GP3) or new-format (GP4/5) shape depending
// on a leading bool.
function skipChord(reader) {
  const newFormat = reader.u8() !== 0;
  if (!newFormat) {
    readInfoString(reader); // name
    const firstFret = reader.i32();
    if (firstFret) reader.skip(6 * 4); // 6 string frets
    return;
  }
  reader.skip(1 + 3); // sharp bool + blank
  reader.skip(1 + 1 + 1); // root, type, extension
  reader.skip(4 + 4); // bass + tonality
  reader.u8(); // add
  reader.skip(1 + 22); // name (byte-size-string, 22)
  reader.skip(1 + 1 + 1); // fifth, ninth, eleventh
  reader.i32(); // first fret
  reader.skip(7 * 4); // 7 string frets
  reader.u8(); // barre count
  reader.skip(5 + 5 + 5); // barre frets/starts/ends
  reader.skip(7); // omissions
  reader.skip(1); // blank
  reader.skip(7); // fingerings
  reader.u8(); // show
}

// Mix-table change: instrument + RSE instrument, then per-channel
// volume/balance/chorus/reverb/phaser/tremolo bytes and a tempo change,
// each followed by a duration byte -- but only for the fields that were
// actually set (>= 0), which is why the values have to be tracked.
function skipMixTableChange(reader, minor) {
  reader.i8(); // instrument
  skipRSEInstrument(reader, minor);
  if (minor === 0) reader.skip(1);
  const values = [];
  for (let i = 0; i < 6; i++) values.push(reader.i8()); // volume,balance,chorus,reverb,phaser,tremolo
  readInfoString(reader); // tempo name
  const tempo = reader.i32();
  for (const v of values) if (v >= 0) reader.i8(); // duration
  if (tempo >= 0) {
    reader.i8(); // tempo duration
    if (minor > 0) reader.u8(); // hide-tempo bool
  }
  reader.i8(); // mix-table change flags
  reader.i8(); // wah value
  skipRSEInstrumentEffect(reader, minor);
}

// Circle-of-fifths: each sharp in the key signature moves the major tonic
// up a fifth (7 semitones); each flat moves it up a fourth (-7 mod 12). A
// minor key's tonic sits a minor third below its relative major's (+9 mod
// 12). Mirrors the same maths in import-midi.js (each importer keeps its
// own tiny copy rather than sharing one, matching this codebase's existing
// pattern). The song-level key in a real .gp5 file never carries a
// minor/major bit -- only per-measure key *changes* do, and this importer
// doesn't model those -- so `mode` here is always major (0) for the song.
function keyFromSignature(sf, mode) {
  const majorTonic = (((7 * sf) % 12) + 12) % 12;
  const tonic = mode === 1 ? (majorTonic + 9) % 12 : majorTonic;
  return { tonic, mode: mode === 1 ? 'minor' : 'major' };
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
// do, and a real .gp5 file always does too). Every measure header after
// the first is preceded by a single always-zero separator byte, and every
// one ends with either an alternate-ending byte or (if that flag isn't
// set) a different always-zero separator byte before the triplet-feel
// byte -- both easy to miss reconstructing this from memory, and both
// verified against real files here.
function readMeasureHeader(reader, carry, isFirst) {
  if (!isFirst) reader.u8(); // separator before every header but the first
  const flags = reader.u8();
  let num = carry.num;
  let den = carry.den;
  if (flags & 0x01) num = reader.i8();
  if (flags & 0x02) den = reader.i8();
  if (flags & 0x08) reader.i8(); // repeat close count
  if (flags & 0x20) {
    readInfoString(reader); // marker name
    reader.skip(4); // marker colour (RGB + blank)
  }
  if (flags & 0x40) {
    reader.i8(); // key-change sharps/flats -- not modelled per-measure
    reader.i8(); // key-change mode
  }
  if (flags & 0x10) reader.u8(); // repeat alternate-ending bitmask
  if (flags & 0x03) reader.skip(4); // beam grouping, only present when the metre changed
  if (!(flags & 0x10)) reader.u8(); // separator when there's no alternate-ending block
  reader.u8(); // triplet-feel byte
  return { num, den };
}

// One track header. Real .gp5 tracks always reserve 7 tuning slots
// (regardless of how many strings are actually used), and carry a large
// amount of RSE (Realistic Sound Engine) display/instrument data that an
// earlier version of this parser didn't know existed at all -- skipping
// past it at the wrong offset is what made every track after the first
// unreadable.
function readTrackHeader(reader, isFirst, minor) {
  if (isFirst || minor === 0) reader.u8(); // separator byte
  reader.u8(); // track flags: percussion/12-string/banjo/visible/solo/mute/RSE/tuning-visible
  const name = readFixedString(reader, 40);
  const stringCount = reader.i32();
  if (stringCount < 1 || stringCount > 7) {
    throw new Error(`Malformed Guitar Pro file: track "${name}" declares ${stringCount} strings`);
  }
  const tuning = [];
  for (let i = 0; i < 7; i++) {
    const t = reader.i32();
    if (i < stringCount) tuning.push(t);
  }
  reader.i32(); // MIDI port
  const channelIndex = reader.i32() - 1; // 1-based on disk
  reader.i32(); // effects channel (1-based, discarded)
  reader.i32(); // fret count
  reader.i32(); // capo
  reader.skip(4); // colour
  reader.i16(); // notation display flags
  reader.u8(); // auto-accentuation
  reader.u8(); // MIDI bank
  reader.u8(); // humanize
  reader.i32(); // clef transpose
  reader.i32(); // clef transpose (secondary staff)
  reader.i32(); // unknown, typically -1 or 100
  reader.skip(12); // unknown
  skipRSEInstrument(reader, minor);
  if (minor > 0) {
    reader.skip(4); // 3-band equalizer (3 knobs + gain)
    skipRSEInstrumentEffect(reader, minor);
  }
  return { name, tuning, channelIndex };
}

// Beat duration byte -> quarter notes: -2 whole, -1 half, 0 quarter,
// 1 eighth, 2 sixteenth, 3 thirty-second, 4 sixty-fourth.
function quartersFromDurationByte(value) {
  return 2 ** -value;
}

function readNote(reader, string) {
  const flags = reader.u8();
  let type = 1; // normal
  if (flags & 0x20) type = reader.u8(); // 1 normal, 2 tied, 3 dead
  if (flags & 0x10) reader.i8(); // dynamics -- not modelled
  let fret = 0;
  if (flags & 0x20) fret = reader.i8();
  if (flags & 0x80) reader.skip(2); // left/right-hand fingering
  if (flags & 0x01) reader.skip(8); // duration-percent (float64)
  reader.u8(); // swap-accidentals flags
  if (flags & 0x08) skipNoteEffects(reader);
  return { string, tie: type === 2, dead: type === 3, fret };
}

// Reads one beat and returns { ticks, notes } where `notes` is a list of
// { string, tie, dead, fret } for strings actually played this beat (empty
// for a rest or an empty beat). String bit order runs from the highest
// string (string 1, bit 0x40) down to string 7 (bit 0x01) -- an earlier
// version of this parser had this backwards (and starting from bit 0x01),
// which silently attached every note to the wrong string on any file with
// more than one string played per beat.
function readBeat(reader, minor) {
  const flags = reader.u8();
  let status = 1; // 0 empty, 1 normal, 2 rest
  if (flags & 0x40) status = reader.u8();
  const rest = status === 2;
  const empty = status === 0;
  const durationByte = reader.i8();
  let quarters = quartersFromDurationByte(durationByte);
  if (flags & 0x01) quarters *= 1.5; // dotted
  if (flags & 0x20) {
    const tupletN = reader.i32();
    const times = TUPLET_TIMES[tupletN];
    if (times) quarters = (quarters * times) / tupletN;
  }
  if (flags & 0x02) skipChord(reader);
  if (flags & 0x04) readInfoString(reader); // beat text -- discarded
  if (flags & 0x08) skipBeatEffects(reader);
  if (flags & 0x10) skipMixTableChange(reader, minor);
  const ticks = Math.max(1, Math.round(quarters * TICKS_PER_QUARTER));
  // The played-strings byte is present unconditionally -- even a rest or an
  // empty beat still writes one (it just reads back as 0, no bits set). An
  // earlier version of this parser skipped reading it for rest/empty beats,
  // which desynchronised every byte read after the first such beat in a
  // real file (real files write an empty second voice on almost every
  // measure, so this bug corrupted nearly every real .gp5 file's second
  // beat onward).
  const stringMask = reader.u8();
  const notes = [];
  if (!rest && !empty) {
    for (let s = 1; s <= 7; s++) {
      if (stringMask & (1 << (7 - s))) notes.push(readNote(reader, s));
    }
  }
  const displayFlags = reader.i16(); // beam/octave/tuplet-bracket display, always present
  if (displayFlags & 0x0800) reader.u8(); // "break secondary beams" amount
  return { ticks, notes };
}

// Reads one voice (a beat count followed by that many beats) and returns
// the list of { ticks, notes }.
function readVoice(reader, minor) {
  const beatCount = reader.i32();
  const beats = [];
  for (let b = 0; b < beatCount; b++) beats.push(readBeat(reader, minor));
  return beats;
}

export function importGp5(bytes, options = {}) {
  const { fileName = null } = options;
  const warnings = [];
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const reader = new ByteReader(arr);

  const { minor } = readVersion(reader);
  const info = readInfoBlock(reader);
  skipLyrics(reader);
  skipRSEMasterEffect(reader, minor);
  skipPageSetup(reader);
  readInfoString(reader); // tempo name -- decorative only
  const tempo = reader.i32();
  if (minor > 0) reader.u8(); // hide-tempo bool
  const sf = reader.i8();
  reader.i32(); // octave -- reserved, not modelled
  const key = keyFromSignature(sf, 0);
  const channels = readChannelTable(reader);
  reader.skip(38); // directions: 19 coda/segno/fine pointers, 2 bytes each
  reader.i32(); // master reverb

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
    const m = readMeasureHeader(reader, carry, i === 0);
    if (!Number.isInteger(m.num) || m.num < 1 || !VALID_DENOMINATORS.includes(m.den)) {
      throw new Error(`Malformed Guitar Pro file: measure ${i + 1} has an invalid time signature ${m.num}/${m.den}`);
    }
    if (i === 0 || m.num !== carry.num || m.den !== carry.den) {
      metreChanges.push({ tick: songTick, num: m.num, den: m.den });
    }
    carry = m;
    measures.push(m);
    if (i === 0) metre = { num: m.num, den: m.den };
    songTick += Math.round(m.num * (4 / m.den) * TICKS_PER_QUARTER);
  }

  const tracks = [];
  for (let i = 0; i < trackCount; i++) tracks.push(readTrackHeader(reader, i === 0, minor));
  reader.skip(minor === 0 ? 2 : 1); // separator after all track headers

  // notesByTrackString[trackIndex] -> Map(stringIndex -> [{start, dur, midi}])
  const notesByTrackString = tracks.map(() => new Map());
  const trackTick = tracks.map(() => 0);

  for (let mi = 0; mi < measureCount; mi++) {
    for (let ti = 0; ti < trackCount; ti++) {
      const track = tracks[ti];
      const map = notesByTrackString[ti];
      const voice1 = readVoice(reader, minor); // primary voice -- surfaced in the Song
      readVoice(reader, minor); // secondary voice -- parsed to stay aligned, then dropped
      reader.u8OrDefault(0); // line-break byte -- may be omitted after the very last measure/track
      for (const { ticks, notes } of voice1) {
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
