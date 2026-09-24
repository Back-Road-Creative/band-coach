import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportAbc } from '../../src/song/export-abc.js';
import { importAbc } from '../../src/song/import-abc.js';
import { starterSongs } from '../../src/song/starter/index.js';

function melodyOf(song) {
  return song.parts.find((p) => p.id === 'melody') ?? song.parts[0];
}

function noteTuples(notes) {
  return notes.map((n) => ({ midi: n.midi, start: n.start, dur: n.dur }));
}

test('every starter song round-trips melody notes, bpm, key and metre through ABC', () => {
  for (const song of starterSongs) {
    const abc = exportAbc(song);
    assert.equal(typeof abc, 'string', `${song.id}: exportAbc must return a string`);
    const { song: reimported } = importAbc(abc);
    const before = noteTuples(melodyOf(song).notes);
    const after = noteTuples(melodyOf(reimported).notes);
    assert.deepEqual(after, before, `${song.id}: melody notes must round-trip exactly`);
    assert.equal(reimported.bpm, song.bpm, `${song.id}: bpm must round-trip`);
    assert.deepEqual(reimported.key, song.key, `${song.id}: key must round-trip`);
    assert.deepEqual(reimported.metre, song.metre, `${song.id}: metre must round-trip`);
  }
});

test('exportAbc is deterministic: exporting the same song twice yields identical text', () => {
  const song = starterSongs[0];
  assert.equal(exportAbc(song), exportAbc(song));
});

test('exportAbc emits the standard ABC header fields', () => {
  const song = starterSongs.find((s) => s.id === 'hot-cross-buns');
  const abc = exportAbc(song);
  assert.match(abc, /^X:1\n/);
  assert.match(abc, /\nT:Hot Cross Buns\n/);
  assert.match(abc, /\nM:4\/4\n/);
  assert.match(abc, /\nL:\d+\/\d+\n/);
  assert.match(abc, /\nQ:100\n/);
  assert.match(abc, /\nK:C major\n/);
});

test('a note that deviates from the key signature gets an explicit accidental, reused implicitly within the bar', () => {
  // London Bridge is in G major (F# in the key signature) but its melody
  // uses natural F -- an explicit accidental is required every time the bar
  // resets, and must not repeat needlessly within one bar.
  const song = starterSongs.find((s) => s.id === 'london-bridge');
  const abc = exportAbc(song);
  assert.match(abc, /=F/, 'expected an explicit natural on F somewhere in the tune');
});

test('a repeated accidental within the same bar is written once; a new bar restates it if needed', () => {
  const song = {
    schema: 'song/1',
    id: 'acc-test',
    title: 'Accidental Test',
    composer: null,
    licence: null,
    source: null,
    key: { tonic: 0, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 120,
    ticksPerQuarter: 480,
    parts: [
      {
        id: 'melody',
        name: 'Melody',
        notes: [
          // Bar 1: C# C# C# C# (sharp explicit once, then implicit reuse).
          { start: 0, dur: 480, midi: 61 },
          { start: 480, dur: 480, midi: 61 },
          { start: 960, dur: 480, midi: 61 },
          { start: 1440, dur: 480, midi: 61 },
          // Bar 2: C natural (accidental state must reset at the barline).
          { start: 1920, dur: 480, midi: 60 },
          { start: 2400, dur: 480, midi: 60 },
          { start: 2880, dur: 480, midi: 60 },
          { start: 3360, dur: 480, midi: 60 },
        ],
      },
    ],
    chords: [],
  };
  const abc = exportAbc(song);
  const bars = abc
    .split('\n')
    .filter((l) => !/^[A-Za-z]:/.test(l) && l.trim() !== '')
    .join(' ')
    .split('|')
    .map((b) => b.trim())
    .filter(Boolean);
  assert.equal((bars[0].match(/\^C/g) || []).length, 1, 'only the first C# in the bar should carry an explicit sharp');
  assert.ok(!/[\^_=]C/.test(bars[1]), 'bar 2 (C natural) needs no explicit accidental in C major');

  const { song: reimported } = importAbc(abc);
  const midis = reimported.parts[0].notes.map((n) => n.midi);
  assert.deepEqual(midis, [61, 61, 61, 61, 60, 60, 60, 60]);
});

test('a tie across a barline is written with "-" and round-trips as two tied notes', () => {
  const song = {
    schema: 'song/1',
    id: 'tie-test',
    title: 'Tie Test',
    composer: null,
    licence: null,
    source: null,
    key: { tonic: 0, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 100,
    ticksPerQuarter: 480,
    parts: [
      {
        id: 'melody',
        name: 'Melody',
        notes: [
          // A half note starting one bar before the end (start 960) tied
          // across the barline (at 1920) into a half note in bar 2.
          { start: 0, dur: 960, midi: 62 },
          { start: 960, dur: 960, midi: 67 },
          { start: 1920, dur: 960, midi: 67, tieFromPrev: true },
          { start: 2880, dur: 960, midi: 64 },
        ],
      },
    ],
    chords: [],
  };
  const abc = exportAbc(song);
  assert.match(abc, /-/, 'expected a tie marker "-" in the exported ABC');

  const { song: reimported } = importAbc(abc);
  const notes = reimported.parts[0].notes;
  assert.deepEqual(
    notes.map((n) => ({ midi: n.midi, start: n.start, dur: n.dur, tie: n.tieFromPrev === true })),
    [
      { midi: 62, start: 0, dur: 960, tie: false },
      { midi: 67, start: 960, dur: 960, tie: false },
      { midi: 67, start: 1920, dur: 960, tie: true },
      { midi: 64, start: 2880, dur: 960, tie: false },
    ]
  );
});

test('a multi-part song emits one V: voice header per part with its name', () => {
  const song = {
    schema: 'song/1',
    id: 'two-voice',
    title: 'Two Voices',
    composer: null,
    licence: null,
    source: null,
    key: { tonic: 0, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 100,
    ticksPerQuarter: 480,
    parts: [
      { id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 1920, midi: 60 }] },
      { id: 'harmony', name: 'Harmony', notes: [{ start: 0, dur: 1920, midi: 55 }] },
    ],
    chords: [],
  };
  const abc = exportAbc(song);
  assert.match(abc, /\nV:melody name="Melody"\n/);
  assert.match(abc, /\nV:harmony name="Harmony"\n/);
});

test('a multi-part song round-trips through ABC: each part comes back as its own part with its notes and name', () => {
  const song = {
    schema: 'song/1', id: 'two-voice', title: 'Two Voices', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
    parts: [
      { id: 'melody', name: 'Melody', notes: [
        { start: 0, dur: 480, midi: 72 }, { start: 480, dur: 480, midi: 74 }, { start: 960, dur: 960, midi: 76 },
        { start: 1920, dur: 1920, midi: 77 },
      ] },
      { id: 'bass', name: 'Bass line', notes: [
        { start: 0, dur: 1920, midi: 48 }, { start: 1920, dur: 960, midi: 43 }, { start: 2880, dur: 960, midi: 45 },
      ] },
    ],
    chords: [],
  };
  const { song: back } = importAbc(exportAbc(song));
  assert.equal(back.parts.length, 2);
  assert.deepEqual(back.parts.map((p) => p.name), ['Melody', 'Bass line']);
  song.parts.forEach((part, i) => {
    assert.deepEqual(noteTuples(back.parts[i].notes), noteTuples(part.notes), `${part.id}: notes must round-trip`);
  });
});

// `%` starts an ABC comment, so a title, composer or part name holding one
// was cut short on the way back in ("100% Pure" came back as "100").
test('a % in the title, composer and part names survives the ABC round trip', () => {
  // Two parts, so the export writes a `V:` line carrying each part's name.
  const base = starterSongs[0];
  const lead = melodyOf(base);
  const song = {
    ...base,
    title: '100% Pure',
    composer: 'Trad. 50%',
    parts: [{ ...lead, name: 'Lead 1%' }, { ...lead, id: 'harmony', name: 'Harmony' }],
  };
  const { song: back } = importAbc(exportAbc(song));
  assert.equal(back.title, '100% Pure');
  assert.equal(back.composer, 'Trad. 50%');
  assert.equal(back.parts[0].name, 'Lead 1%');
});

test('importAbc reads \\% as a literal percent and still strips a real % comment', () => {
  const { song } = importAbc('X:1\nT:Half 50\\% off % a comment\nM:4/4\nL:1/4\nK:C\nCDEF|\n');
  assert.equal(song.title, 'Half 50% off');
  assert.equal(song.parts[0].notes.length, 4);
});
