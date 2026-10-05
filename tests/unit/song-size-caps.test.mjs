// Hardening unit H1: a song that is far too long to open, or a file far too
// big to read, is refused up front with a plain-English reason. Before this a
// 54-byte MIDI passed validateSong and was saved, and opening it then built
// millions of bar boundaries every time (barsOf), while a multi-hundred-MB
// file was read whole into memory before any importer could say no.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as model from '../../src/song/model.js';
import { importMidi } from '../../src/song/import-midi.js';
import { importAbc } from '../../src/song/import-abc.js';
import { importMusicXml } from '../../src/song/import-musicxml.js';
import { createLibrary, memoryStore } from '../../src/song/library.js';
import * as route from '../../src/ui/songs/import-route.js';
import { MAX_IMPORT_BYTES } from '../../src/core/progress-file.js';

const { validateSong, normalizeSong, barsOf, songBarCount, SCHEMA, TICKS_PER_QUARTER } = model;
const fixture = (name) => new URL('../fixtures/hostile/' + name, import.meta.url);
const MB = 1024 * 1024;

function song(notes, extra = {}) {
  return {
    schema: SCHEMA, id: 's', title: 'T', composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 120, ticksPerQuarter: TICKS_PER_QUARTER,
    parts: [{ id: 'p', name: 'P', notes }], chords: [], ...extra
  };
}
const barTicks = 4 * TICKS_PER_QUARTER;
const manyNotes = (n) => Array.from({ length: n }, (_, i) => ({ start: i, dur: 1, midi: 60 }));

const hostile = [
  ['a crafted 54-byte MIDI with four 0x0FFFFFFF gaps', () => importMidi(new Uint8Array(readFileSync(fixture('huge-ticks.mid'))), { fileName: 'huge-ticks.mid' }).song],
  ['an ABC file with thousands of repeats', () => importAbc(readFileSync(fixture('repeat-explosion.abc'), 'utf8'), { fileName: 'repeat-explosion.abc' }).song],
  ['a MusicXML file with a 99999999999-division note', () => importMusicXml(readFileSync(fixture('huge-duration.xml'), 'utf8'), { fileName: 'huge-duration.xml' }).song],
];

for (const [label, make] of hostile) {
  test('refuses ' + label + ' cleanly and quickly', async () => {
    const t0 = Date.now();
    const s = make();
    const check = validateSong(s);
    assert.equal(check.ok, false, 'validateSong must refuse it');
    assert.ok(check.errors.length >= 1 && check.errors.length <= 5, 'a short list of reasons, not one line per note');
    assert.match(check.errors.join(' '), /too long|too large/i);
    assert.throws(() => normalizeSong(s), /too long|too large/i);
    const lib = createLibrary(memoryStore());
    await assert.rejects(() => lib.add(s, { now: 1 }), /too long|too large/i);
    assert.deepEqual(await lib.list(), [], 'nothing was saved');
    assert.ok(Date.now() - t0 < 1000, 'import + refusal took ' + (Date.now() - t0) + ' ms');
  });
}

test('the song-size ceilings are exported numbers', () => {
  assert.equal(typeof model.MAX_SONG_BARS, 'number');
  assert.equal(typeof model.MAX_NOTES_PER_PART, 'number');
});

test('a long but real piece (3000 bars, 30000 notes in one part) is still accepted', () => {
  const notes = Array.from({ length: 30000 }, (_, i) => ({ start: i * 10, dur: 10, midi: 60 }));
  const s = song([...notes, { start: 3000 * barTicks - 10, dur: 10, midi: 60 }]);
  assert.equal(validateSong(s).ok, true);
  assert.equal(normalizeSong(s).parts[0].notes.length, 30001);
});

test('a part with 60000 notes is refused, named and counted', () => {
  const s = song(manyNotes(60000));
  const { ok, errors } = validateSong(s);
  assert.equal(ok, false);
  assert.match(errors.join(' '), /60000 notes/);
  // normalizeSong stops at the part itself (an early exit, before it normalizes 60000 notes one by one), so its own message comes through unwrapped.
  assert.throws(() => normalizeSong(s), /^Error: parts\[0\] is too large to open: it has 60000 notes/);
});

test('the bar ceiling is measured in bars of the song\'s own metre', () => {
  const at = (num, den, bars) => song([{ start: 0, dur: Math.round(bars * num * (4 / den) * TICKS_PER_QUARTER), midi: 60 }], { metre: { num, den } });
  assert.equal(validateSong(at(4, 4, 3000)).ok, true);
  assert.equal(validateSong(at(6, 8, 3000)).ok, true);
  assert.equal(validateSong(at(4, 4, 50000)).ok, false);
  assert.equal(validateSong(at(6, 8, 50000)).ok, false);
  // The same tick length is many more bars in 1/8 than in 4/4.
  const ticks = 8000 * barTicks;
  assert.equal(validateSong(song([{ start: 0, dur: ticks, midi: 60 }])).ok, false);
});

test('a metre change to very short bars counts toward the ceiling', () => {
  const s = song([{ start: 0, dur: 60 * barTicks, midi: 60 }], { metreChanges: [{ tick: 0, num: 1, den: 64 }] });
  // 60 4/4 bars of ticks is 3840 bars of 1/64, still fine; 600 4/4 bars is not.
  assert.equal(validateSong(s).ok, true);
  assert.equal(validateSong({ ...s, parts: [{ id: 'p', name: 'P', notes: [{ start: 0, dur: 600 * barTicks, midi: 60 }] }] }).ok, false);
});

test('one very short metre-change bar does not shrink the allowance for the whole piece', () => {
  // 4/4 for 1000 bars, one 1/8 bar, then 3/4: refused only once the real bar count passes 4000.
  const atEnd = (n34) => song([{ start: 0, dur: 1000 * barTicks + 240 + n34 * 3 * TICKS_PER_QUARTER, midi: 60 }], { metreChanges: [{ tick: 1000 * barTicks, num: 1, den: 8 }, { tick: 1000 * barTicks + 240, num: 3, den: 4 }] });
  assert.equal(validateSong(atEnd(2999)).ok, true, '1000 + 1 + 2999 = 4000 bars opens');
  assert.equal(normalizeSong(atEnd(2999)).parts[0].notes.length, 1);
  const over = validateSong(atEnd(3000));
  assert.equal(over.ok, false, '4001 bars is refused');
  assert.match(over.errors.join(' '), /about 4001 bars/);
  // The same piece with no short bar at all is plainly fine: 2000 bars of 4/4 and one 1/8 bar.
  const s = song([{ start: 0, dur: 2000 * barTicks, midi: 60 }], { metreChanges: [{ tick: 1000 * barTicks, num: 1, den: 8 }, { tick: 1000 * barTicks + 240, num: 4, den: 4 }] });
  assert.equal(validateSong(s).ok, true);
});

test('songBarCount counts exactly the bars barsOf lays out, with no allocation', () => {
  assert.equal(typeof songBarCount, 'function');
  const cases = [
    song([]),
    song([{ start: 0, dur: 1, midi: 60 }]),
    song([{ start: 0, dur: 7 * barTicks + 5, midi: 60 }]),
    song([{ start: 0, dur: 10 * barTicks, midi: 60 }], { metre: { num: 6, den: 8 } }),
    song([{ start: 0, dur: 10 * barTicks, midi: 60 }], { metreChanges: [{ tick: 0, num: 3, den: 4 }] }),
    song([{ start: 0, dur: 10 * barTicks, midi: 60 }], { metreChanges: [{ tick: 3 * barTicks + 100, num: 7, den: 8 }, { tick: 6 * barTicks, num: 2, den: 4 }] }),
    song([{ start: 0, dur: 2 * barTicks, midi: 60 }], { metreChanges: [{ tick: 50 * barTicks, num: 1, den: 4 }] }),
  ];
  for (const c of cases) assert.equal(songBarCount(c), barsOf(c).length - 1, JSON.stringify(c.metreChanges || c.metre) + ' / ' + c.parts[0].notes.length);
  assert.ok(songBarCount(song([{ start: 0, dur: 5368709100, midi: 60 }])) > 1000000, 'a hostile song is measured without being built');
});

test('barsOf stops at a bound instead of building millions of boundaries', () => {
  const hostileSong = song([{ start: 0, dur: 5368709100, midi: 60 }]);
  const t0 = Date.now();
  assert.throws(() => barsOf(hostileSong), /too long/i);
  assert.ok(Date.now() - t0 < 1000, 'barsOf refused in ' + (Date.now() - t0) + ' ms');
});

test('checkFileSize refuses an oversized file by its size alone and says what to do', () => {
  assert.equal(typeof route.checkFileSize, 'function');
  const f = (size) => ({ name: 'x', size });
  const msg = route.checkFileSize(f(40 * MB), 'midi');
  assert.equal(typeof msg, 'string');
  assert.match(msg, /40 MB/);
  assert.match(msg, /smaller/i);
  assert.equal(route.checkFileSize(f(1 * MB), 'midi'), null);
  for (const kind of ['abc', 'musicxml', 'gp7', 'gp5']) assert.equal(typeof route.checkFileSize(f(40 * MB), kind), 'string', kind);
  // A band pack and a challenge list carry several songs, so they get more room.
  assert.equal(route.checkFileSize(f(18 * MB), 'band-pack'), null);
  assert.equal(typeof route.checkFileSize(f(25 * MB), 'band-pack'), 'string');
  // A challenge file is one song list, and parseChallenge itself refuses anything over 5 MB, so it is turned away at 5 MB.
  assert.equal(route.checkFileSize(f(4 * MB), 'challenge'), null);
  const refused = route.checkFileSize(f(6 * MB), 'challenge');
  assert.equal(typeof refused, 'string', 'a 6 MB challenge file is refused');
  assert.match(refused, /6 MB.*limit is 5 MB/);
  assert.equal(route.checkFileSize(f(30 * MB), 'backup'), null);
  assert.equal(typeof route.checkFileSize(f(MAX_IMPORT_BYTES + 1), 'backup'), 'string');
});

test('checkFileSize never blocks a file whose size it cannot read', () => {
  assert.equal(typeof route.checkFileSize, 'function');
  assert.equal(route.checkFileSize({ name: 'x' }, 'midi'), null);
  assert.equal(route.checkFileSize(null, 'midi'), null);
});
