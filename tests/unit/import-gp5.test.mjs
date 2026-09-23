import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importGp5 } from '../../src/song/import-gp5.js';
import { validateSong } from '../../src/song/model.js';

// --- tiny GP5 byte-writer helper, local to this test file (no binary fixtures) ---
//
// This writer emits the real Guitar Pro 5.1 ("v5.10") container layout that
// `import-gp5.js` reads, verified against real .gp5 files in
// tests/fixtures/gp5/ (see import-gp5-real.test.mjs) and against the
// PyGuitarPro project's independent reader. It only ever fills in the
// fields this parser actually looks at; every other field (page setup,
// RSE master effect, lyrics, ...) is written as zero bytes, which is a
// valid empty encoding the parser skips over unconditionally.

function u8(n) {
  return [n & 0xff];
}
function i16(n) {
  const v = n < 0 ? n + 0x10000 : n;
  return [v & 0xff, (v >>> 8) & 0xff];
}
function i32(n) {
  const v = n < 0 ? n + 0x100000000 : n;
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}
function zeros(n) {
  return new Array(n).fill(0);
}
function bytesOf(str) {
  return [...str].map((c) => c.charCodeAt(0));
}
function fixedBlock(str, size) {
  const b = bytesOf(str);
  const out = new Array(size).fill(0);
  for (let i = 0; i < b.length && i < size; i++) out[i] = b[i];
  return [u8(b.length)[0], ...out];
}
function infoString(str = '') {
  const b = bytesOf(str);
  return [...i32(b.length + 1), ...u8(b.length), ...b];
}

function versionHeader(version = 'FICHIER GUITAR PRO v5.10') {
  return fixedBlock(version, 30);
}

function infoBlock({ title = '', subtitle = '', artist = '', album = '', words = '', music = '', copyright = '', tab = '', instructions = '', notices = [] } = {}) {
  return [
    ...infoString(title),
    ...infoString(subtitle),
    ...infoString(artist),
    ...infoString(album),
    ...infoString(words),
    ...infoString(music),
    ...infoString(copyright),
    ...infoString(tab),
    ...infoString(instructions),
    ...i32(notices.length),
    ...notices.flatMap(infoString),
  ];
}

function lyricsBlock() {
  return [...i32(0), ...zeros(5 * (4 + 4))]; // bound track + 5 x (starting measure + empty int-size-string)
}

function rseMasterEffectBlock() {
  return zeros(4 + 4 + 11); // volume, reserved, 11-knob equalizer
}

function pageSetupBlock() {
  const out = [...zeros(6 * 4), ...i32(100), ...i16(0)];
  for (let i = 0; i < 10; i++) out.push(...infoString(''));
  return out;
}

function tempoKeyBlock({ tempoName = '', tempo = 120, keySf = 0 } = {}) {
  return [...infoString(tempoName), ...i32(tempo), u8(0)[0], ...u8(keySf < 0 ? keySf + 256 : keySf), ...i32(0)];
}

function channelTable(overrides = {}) {
  const bytes = [];
  for (let i = 0; i < 64; i++) {
    const instrument = overrides[i] ?? 24;
    bytes.push(...i32(instrument), ...zeros(8));
  }
  return bytes;
}

// flags: 0x01 numerator, 0x02 denominator, 0x08 repeat close, 0x10 alt ending,
// 0x20 marker, 0x40 key change.
function measureHeader({ num, den, marker, keyChange, repeatClose, altEnding } = {}, isFirst) {
  let flags = 0;
  if (num !== undefined) flags |= 0x01;
  if (den !== undefined) flags |= 0x02;
  if (repeatClose !== undefined) flags |= 0x08;
  if (altEnding !== undefined) flags |= 0x10;
  if (marker !== undefined) flags |= 0x20;
  if (keyChange !== undefined) flags |= 0x40;
  const out = [];
  if (!isFirst) out.push(0); // separator before every header but the first
  out.push(flags);
  if (num !== undefined) out.push(u8(num)[0]);
  if (den !== undefined) out.push(u8(den)[0]);
  if (repeatClose !== undefined) out.push(u8(repeatClose)[0]);
  if (marker !== undefined) out.push(...infoString(marker), 0, 0, 0, 0);
  if (keyChange !== undefined) out.push(u8(keyChange.sf < 0 ? keyChange.sf + 256 : keyChange.sf)[0], u8(keyChange.mode)[0]);
  if (altEnding !== undefined) out.push(u8(altEnding)[0]);
  if (num !== undefined || den !== undefined) out.push(0, 0, 0, 0); // beam grouping
  if (altEnding === undefined) out.push(0); // separator when there's no alt-ending block
  out.push(0); // triplet feel byte
  return out;
}

function trackHeader({ name, tuning, channelIndex = 0 }, isFirst) {
  const out = [];
  if (isFirst) out.push(0); // separator byte
  out.push(0); // track flags
  out.push(...fixedBlock(name, 40));
  out.push(...i32(tuning.length));
  for (let i = 0; i < 7; i++) out.push(...i32(i < tuning.length ? tuning[i] : 0));
  out.push(...i32(0)); // MIDI port
  out.push(...i32(channelIndex + 1)); // channel is 1-based on disk
  out.push(...i32(0)); // effects channel
  out.push(...i32(24)); // fret count
  out.push(...i32(0)); // capo
  out.push(...zeros(4)); // colour
  out.push(...i16(0)); // notation display flags
  out.push(...zeros(3)); // auto-accentuation, MIDI bank, humanize
  out.push(...i32(0), ...i32(0), ...i32(0)); // clef transpose x2, unknown
  out.push(...zeros(12)); // unknown
  out.push(...i32(0), ...i32(0), ...i32(0)); // RSE instrument/unknown/sound bank
  out.push(...i32(0)); // RSE effect number
  out.push(...zeros(4)); // 3-band equalizer
  out.push(...infoString(''), ...infoString('')); // RSE effect name/category
  return out;
}

// duration values: -2 whole, -1 half, 0 quarter, 1 eighth, 2 sixteenth
function note({ string, fret, tie = false, dead = false }) {
  const type = dead ? 3 : tie ? 2 : 1;
  return [0x20, u8(type)[0], u8(fret < 0 ? fret + 256 : fret)[0], 0]; // flags, type, fret, flags2
}

function beat({ duration = 0, dotted = false, tuplet, rest = false, empty = false, notes = [] }) {
  let flags = 0;
  if (dotted) flags |= 0x01;
  if (tuplet) flags |= 0x20;
  flags |= 0x40; // beat status present
  const status = empty ? 0 : rest ? 2 : 1;
  const out = [u8(flags)[0], u8(status)[0], u8(duration < 0 ? duration + 256 : duration)[0]];
  if (tuplet) out.push(...i32(tuplet));
  let stringMask = 0;
  for (const n of notes) stringMask |= 1 << (7 - n.string);
  out.push(u8(stringMask)[0]); // played-strings byte -- present even on a rest/empty beat
  if (status === 1) {
    for (const n of notes) out.push(...note(n));
  }
  out.push(...i16(0)); // beat display flags, always present
  return out;
}

function voice(beats) {
  return [...i32(beats.length), ...beats.flat()];
}

const EMPTY_VOICE = [beat({ empty: true })];

function measureTrack(voice0Beats, voice1Beats = EMPTY_VOICE) {
  return [...voice(voice0Beats), ...voice(voice1Beats), 0]; // 0 = line break byte
}

function gp5File({ version, info, tempoKey, channels, measures, tracks, measureTracks }) {
  return new Uint8Array([
    ...versionHeader(version),
    ...infoBlock(info),
    ...lyricsBlock(),
    ...rseMasterEffectBlock(),
    ...pageSetupBlock(),
    ...tempoKeyBlock(tempoKey),
    ...(channels || channelTable()),
    ...zeros(38), // directions
    ...i32(0), // master reverb
    ...i32(measures.length),
    ...i32(tracks.length),
    ...measures.flatMap((m, i) => measureHeader(m, i === 0)),
    ...tracks.flatMap((t, i) => trackHeader(t, i === 0)),
    0, // separator after all track headers
    ...measureTracks.flat(2),
  ]);
}

const STANDARD_TUNING = [64, 59, 55, 50, 45, 40]; // high E to low E

test('one track, one measure, a few notes: parses name, tuning-derived pitch, ticks', () => {
  const bytes = gp5File({
    info: { title: 'Simple Riff' },
    tempoKey: { tempo: 140, keySf: 0 },
    measures: [{ num: 4, den: 4 }],
    tracks: [{ name: 'Guitar', tuning: STANDARD_TUNING, channelIndex: 0 }],
    measureTracks: [
      [
        measureTrack([
          beat({ duration: 0, notes: [{ string: 1, fret: 0 }] }), // quarter note, open high E = 64
          beat({ duration: 0, notes: [{ string: 1, fret: 3 }] }), // quarter, fret 3 = 67
          beat({ duration: 0, rest: true }),
          beat({ duration: 0, notes: [{ string: 6, fret: 2 }] }), // low E string fret 2 = 42
        ]),
      ],
    ],
  });

  const { song, warnings } = importGp5(bytes);
  assert.equal(song.title, 'Simple Riff');
  assert.equal(song.bpm, 140);
  assert.equal(song.metre.num, 4);
  assert.equal(song.metre.den, 4);

  const highE = song.parts.find((p) => p.name.includes('string 1'));
  const lowE = song.parts.find((p) => p.name.includes('string 6'));
  assert.ok(highE);
  assert.ok(lowE);
  assert.deepEqual(highE.notes.map((n) => n.midi), [64, 67]);
  assert.equal(highE.notes[0].start, 0);
  assert.equal(highE.notes[0].dur, 480);
  assert.equal(highE.notes[1].start, 480);
  assert.equal(lowE.notes[0].midi, 42);
  assert.equal(lowE.notes[0].start, 1440); // after 3 quarter-note beats (incl. the rest)

  const { ok, errors } = validateSong(song);
  assert.deepEqual(errors, []);
  assert.ok(ok);
  assert.deepEqual(warnings, []);
});

test('dotted note and a tuplet both scale duration correctly', () => {
  const bytes = gp5File({
    info: { title: 'Rhythm Test' },
    tempoKey: { tempo: 100 },
    measures: [{ num: 4, den: 4 }],
    tracks: [{ name: 'Bass', tuning: [40], channelIndex: 0 }],
    measureTracks: [
      [
        measureTrack([
          beat({ duration: 0, dotted: true, notes: [{ string: 1, fret: 0 }] }), // dotted quarter = 720 ticks
          beat({ duration: 0, tuplet: 3, notes: [{ string: 1, fret: 1 }] }), // triplet quarter = 320 ticks
        ]),
      ],
    ],
  });

  const { song } = importGp5(bytes);
  const part = song.parts[0];
  assert.equal(part.notes[0].dur, 720);
  assert.equal(part.notes[1].start, 720);
  assert.equal(part.notes[1].dur, 320);
});

test('a quintuplet scales duration by times/n, not a fixed 2/n', () => {
  const bytes = gp5File({
    info: { title: 'Quintuplet' },
    tempoKey: { tempo: 120 },
    measures: [{ num: 4, den: 4 }],
    tracks: [{ name: 'Guitar', tuning: [64], channelIndex: 0 }],
    measureTracks: [[measureTrack([beat({ duration: 0, tuplet: 5, notes: [{ string: 1, fret: 0 }] })])]],
  });

  const { song } = importGp5(bytes);
  assert.equal(song.parts[0].notes[0].dur, 384); // quarter * (4/5) * 480
});

test('a tie chains to the previous note on the same string', () => {
  const bytes = gp5File({
    info: { title: 'Tie Test' },
    tempoKey: { tempo: 120 },
    measures: [{ num: 4, den: 4 }],
    tracks: [{ name: 'Guitar', tuning: [64], channelIndex: 0 }],
    measureTracks: [
      [
        measureTrack([
          beat({ duration: 0, notes: [{ string: 1, fret: 0 }] }),
          beat({ duration: 0, notes: [{ string: 1, fret: 0, tie: true }] }),
        ]),
      ],
    ],
  });

  const { song } = importGp5(bytes);
  const part = song.parts[0];
  assert.equal(part.notes.length, 2);
  assert.equal(part.notes[1].tieFromPrev, true);
  const { ok } = validateSong(song);
  assert.ok(ok);
});

test('a mid-song time signature change is recorded in metreChanges', () => {
  const bytes = gp5File({
    info: { title: 'Metre Change' },
    tempoKey: { tempo: 120 },
    measures: [{ num: 4, den: 4 }, { num: 3, den: 4 }],
    tracks: [{ name: 'Guitar', tuning: [64], channelIndex: 0 }],
    measureTracks: [
      [
        measureTrack([beat({ duration: -2, notes: [{ string: 1, fret: 0 }] })]), // whole note fills bar 1
        measureTrack([beat({ duration: -1, notes: [{ string: 1, fret: 2 }] }), beat({ duration: 0, rest: true })]), // half + quarter rest fills 3/4 bar
      ],
    ],
  });

  const { song } = importGp5(bytes);
  assert.ok(Array.isArray(song.metreChanges));
  assert.deepEqual(song.metreChanges, [
    { tick: 0, num: 4, den: 4 },
    { tick: 1920, num: 3, den: 4 },
  ]);
});

test('two tracks each get their own MIDI-channel-derived instrument hint', () => {
  const bytes = gp5File({
    info: { title: 'Two Tracks' },
    tempoKey: { tempo: 120 },
    channels: channelTable({ 0: 29, 5: 33 }),
    measures: [{ num: 4, den: 4 }],
    tracks: [
      { name: 'Lead', tuning: [64], channelIndex: 0 },
      { name: 'Bass', tuning: [40], channelIndex: 5 },
    ],
    measureTracks: [
      [measureTrack([beat({ duration: -2, notes: [{ string: 1, fret: 0 }] })])],
      [measureTrack([beat({ duration: -2, notes: [{ string: 1, fret: 0 }] })])],
    ],
  });

  const { song } = importGp5(bytes);
  const lead = song.parts.find((p) => p.name.startsWith('Lead'));
  const bass = song.parts.find((p) => p.name.startsWith('Bass'));
  assert.match(lead.instrumentHint, /29/);
  assert.match(bass.instrumentHint, /33/);
});

test('a dead note is consumed correctly but not added as a pitched note', () => {
  const bytes = gp5File({
    info: { title: 'Dead Note' },
    tempoKey: { tempo: 120 },
    measures: [{ num: 4, den: 4 }],
    tracks: [{ name: 'Guitar', tuning: [64], channelIndex: 0 }],
    measureTracks: [
      [
        measureTrack([
          beat({ duration: 0, notes: [{ string: 1, fret: 5, dead: true }] }),
          beat({ duration: 0, notes: [{ string: 1, fret: 7 }] }),
        ]),
      ],
    ],
  });

  const { song } = importGp5(bytes);
  const part = song.parts[0];
  assert.deepEqual(part.notes.map((n) => n.midi), [71]);
  assert.equal(part.notes[0].start, 480);
});

test('a measure with a zero numerator is rejected rather than producing a zero-length bar', () => {
  const bytes = gp5File({
    info: { title: 'Bad Metre' },
    tempoKey: { tempo: 120 },
    measures: [{ num: 0, den: 4 }],
    tracks: [{ name: 'Guitar', tuning: [64], channelIndex: 0 }],
    measureTracks: [[measureTrack([beat({ duration: -2, rest: true })])]],
  });

  assert.throws(() => importGp5(bytes), /metre|time signature/i);
});

test('a measure with an unsupported denominator is rejected', () => {
  const bytes = gp5File({
    info: { title: 'Bad Denominator' },
    tempoKey: { tempo: 120 },
    measures: [{ num: 4, den: 3 }],
    tracks: [{ name: 'Guitar', tuning: [64], channelIndex: 0 }],
    measureTracks: [[measureTrack([beat({ duration: -2, rest: true })])]],
  });

  assert.throws(() => importGp5(bytes), /metre|time signature/i);
});

test('an unsupported version is rejected with a plain-English error', () => {
  const bytes = gp5File({
    version: 'FICHIER GUITAR PRO v4.06',
    info: {},
    tempoKey: {},
    measures: [{ num: 4, den: 4 }],
    tracks: [{ name: 'Guitar', tuning: [64], channelIndex: 0 }],
    measureTracks: [[measureTrack([beat({ duration: -2, rest: true })])]],
  });

  assert.throws(() => importGp5(bytes), /guitar pro 5/i);
});

test('a truncated file is rejected with a plain-English error, never a crash mid-read', () => {
  const bytes = gp5File({
    info: { title: 'Truncated' },
    tempoKey: { tempo: 120 },
    measures: [{ num: 4, den: 4 }],
    tracks: [{ name: 'Guitar', tuning: STANDARD_TUNING, channelIndex: 0 }],
    measureTracks: [
      [measureTrack([beat({ duration: 0, notes: [{ string: 1, fret: 0 }] }), beat({ duration: 0, notes: [{ string: 6, fret: 2 }] })])],
    ],
  });

  for (const len of [0, 1, 5, 20, 40, bytes.length - 3]) {
    assert.throws(() => importGp5(bytes.subarray(0, len)), /guitar pro file|end of/i);
  }

  // Real Guitar Pro 5 files can be missing exactly their very last byte (the
  // trailing line-break marker after the last measure/track) and are still
  // well-formed -- Guitar Pro itself treats that byte as optional at
  // end-of-file, so a one-byte-short file is a valid import, not truncation.
  assert.doesNotThrow(() => importGp5(bytes.subarray(0, bytes.length - 1)));
});

test('every prefix of a valid file either imports or throws a plain-English error, never anything else', () => {
  const bytes = gp5File({
    info: { title: 'Prefix Sweep' },
    tempoKey: { tempo: 120 },
    measures: [{ num: 4, den: 4 }],
    tracks: [{ name: 'Guitar', tuning: [64], channelIndex: 0 }],
    measureTracks: [[measureTrack([beat({ duration: -2, notes: [{ string: 1, fret: 0 }] })])]],
  });

  const lengths = new Set();
  for (let len = 0; len <= bytes.length; len += 3) lengths.add(len);
  lengths.add(bytes.length);

  let imported = 0;
  let thrown = 0;
  for (const len of lengths) {
    try {
      importGp5(bytes.subarray(0, len));
      imported++;
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.ok(err.message.length > 0);
      thrown++;
    }
  }
  assert.ok(imported >= 1);
  assert.ok(thrown >= 1);
});
