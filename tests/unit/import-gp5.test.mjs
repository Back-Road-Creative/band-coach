import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importGp5 } from '../../src/song/import-gp5.js';
import { validateSong } from '../../src/song/model.js';

// --- tiny GP5 byte-writer helper, local to this test file (no binary fixtures) ---
//
// This writer emits the same self-authored binary layout `import-gp5.js`
// reads (see the comment block at the top of that file). It is NOT a real
// Guitar Pro 5 file writer -- these fixtures exist only to exercise the
// parser's own format, so parity with real .gp5 files produced by the
// actual application is unverified.

function u8(n) {
  return [n & 0xff];
}
function i32(n) {
  const v = n < 0 ? n + 0x100000000 : n;
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
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
function infoString(str) {
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

function tempoKeyBlock({ tempoName = '', tempo = 120, keySf = 0, keyMode = 0 } = {}) {
  return [...infoString(tempoName), ...i32(tempo), ...u8(keySf < 0 ? keySf + 256 : keySf), ...u8(keyMode)];
}

function channelTable(overrides = {}) {
  const bytes = [];
  for (let i = 0; i < 64; i++) {
    const instrument = overrides[i] ?? 24;
    bytes.push(...i32(instrument), ...u8(0), ...u8(0), ...u8(0), ...u8(0), ...u8(0), ...u8(0), ...u8(0), ...u8(0));
  }
  return bytes;
}

// flags: 0x01 numerator present, 0x02 denominator present, 0x20 marker present, 0x40 key change present
function measureHeader({ num, den, marker, keyChange } = {}) {
  let flags = 0;
  if (num !== undefined) flags |= 0x01;
  if (den !== undefined) flags |= 0x02;
  if (marker !== undefined) flags |= 0x20;
  if (keyChange !== undefined) flags |= 0x40;
  const out = [u8(flags)[0]];
  if (num !== undefined) out.push(u8(num)[0]);
  if (den !== undefined) out.push(u8(den)[0]);
  if (marker !== undefined) out.push(...infoString(marker), 0, 0, 0, 0);
  if (keyChange !== undefined) out.push(u8(keyChange.sf < 0 ? keyChange.sf + 256 : keyChange.sf)[0], u8(keyChange.mode)[0]);
  if (num !== undefined || den !== undefined) out.push(0, 0, 0, 0);
  out.push(0); // triplet feel byte
  return out;
}

function trackHeader({ name, tuning, channelIndex = 0 }) {
  return [
    ...fixedBlock(name, 40),
    ...i32(tuning.length),
    ...tuning.flatMap((t) => i32(t)),
    ...i32(channelIndex),
    ...i32(0), // effects channel
    ...i32(24), // fret count
    ...i32(0), // capo
    0, 0, 0, 0, // color
  ];
}

// duration values: -2 whole, -1 half, 0 quarter, 1 eighth, 2 sixteenth
function note({ string, fret, tie = false, dead = false, velocity }) {
  let flags = 0;
  if (tie) flags |= 0x01;
  if (dead) flags |= 0x02;
  if (velocity !== undefined) flags |= 0x04;
  flags |= 0x08; // has fret
  const out = [string, u8(flags)[0]];
  if (velocity !== undefined) out.push(u8(velocity)[0]);
  out.push(u8(fret < 0 ? fret + 256 : fret)[0]);
  return out;
}

function beat({ duration = 0, dotted = false, tuplet, rest = false, notes = [] }) {
  let flags = 0;
  if (dotted) flags |= 0x01;
  if (tuplet) flags |= 0x20;
  flags |= 0x40; // beat status present
  const out = [u8(flags)[0], u8(rest ? 1 : 0)[0], u8(duration < 0 ? duration + 256 : duration)[0]];
  if (tuplet) out.push(...i32(tuplet));
  if (!rest) {
    let stringMask = 0;
    for (const n of notes) stringMask |= 1 << (n.string - 1);
    out.push(u8(stringMask)[0]);
    for (const n of notes) out.push(...note(n));
  }
  return out;
}

function measureTrack(beats) {
  return [...i32(beats.length), ...beats.flat()];
}

function gp5File({ version, info, tempoKey, channels, measures, tracks, measureTracks }) {
  return new Uint8Array([
    ...versionHeader(version),
    ...infoBlock(info),
    ...tempoKeyBlock(tempoKey),
    ...(channels || channelTable()),
    ...i32(measures.length),
    ...i32(tracks.length),
    ...measures.flatMap(measureHeader),
    ...tracks.flatMap(trackHeader),
    ...measureTracks.flat(2),
  ]);
}

const STANDARD_TUNING = [64, 59, 55, 50, 45, 40]; // high E to low E

test('one track, one measure, a few notes: parses name, tuning-derived pitch, ticks', () => {
  const bytes = gp5File({
    info: { title: 'Simple Riff' },
    tempoKey: { tempo: 140, keySf: 0, keyMode: 0 },
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

  for (const len of [0, 1, 5, 20, 40, bytes.length - 3, bytes.length - 1]) {
    assert.throws(() => importGp5(bytes.subarray(0, len)), /guitar pro file|end of/i);
  }
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
