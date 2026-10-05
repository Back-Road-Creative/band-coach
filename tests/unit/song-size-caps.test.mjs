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

const { validateSong, normalizeSong, barsOf, SCHEMA, TICKS_PER_QUARTER } = model;
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
  assert.throws(() => normalizeSong({ ...s, parts: [{ id: 'p', name: 'P', notes: manyNotes(60000) }] }), /too large/i);
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
  assert.equal(route.checkFileSize(f(18 * MB), 'challenge'), null);
  assert.equal(route.checkFileSize(f(30 * MB), 'backup'), null);
  assert.equal(typeof route.checkFileSize(f(MAX_IMPORT_BYTES + 1), 'backup'), 'string');
});

test('checkFileSize never blocks a file whose size it cannot read', () => {
  assert.equal(typeof route.checkFileSize, 'function');
  assert.equal(route.checkFileSize({ name: 'x' }, 'midi'), null);
  assert.equal(route.checkFileSize(null, 'midi'), null);
});
