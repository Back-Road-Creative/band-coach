import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BAND_PACK_FORMAT, BAND_PACK_VERSION, writeBandPack, readBandPack
} from '../../src/song/band-pack.js';
import { SCHEMA, TICKS_PER_QUARTER } from '../../src/song/model.js';
import { readZipEntries, readZipEntryData } from '../../src/song/unzip-lite.js';

function song(id, overrides = {}) {
  return {
    schema: SCHEMA, id, title: overrides.title || 'Song ' + id, composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 120, ticksPerQuarter: TICKS_PER_QUARTER,
    parts: [
      { id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 480, midi: 60 }] },
      { id: 'bass', name: 'Bass', notes: [{ start: 0, dur: 480, midi: 36 }] },
    ],
    chords: [],
    ...overrides
  };
}

// ---- own minimal stored-zip builder, for constructing malformed test
// fixtures only -- production code never needs this outside band-pack.js's
// own (unexported) writer.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function buildTestZip(entries) {
  const encoder = new TextEncoder();
  const out = [];
  const push16 = (v) => out.push(v & 0xff, (v >>> 8) & 0xff);
  const push32 = (v) => out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  const pushBytes = (b) => { for (let i = 0; i < b.length; i += 1) out.push(b[i]); };
  const central = [];
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const localOffset = out.length;
    push32(0x04034b50); push16(20); push16(0); push16(0); push16(0); push16(0);
    push32(crc); push32(data.length); push32(data.length);
    push16(nameBytes.length); push16(0);
    pushBytes(nameBytes); pushBytes(data);
    central.push({ nameBytes, crc, size: data.length, localOffset });
  }
  const cdStart = out.length;
  for (const rec of central) {
    push32(0x02014b50); push16(20); push16(20); push16(0); push16(0); push16(0); push16(0);
    push32(rec.crc); push32(rec.size); push32(rec.size);
    push16(rec.nameBytes.length); push16(0); push16(0); push16(0); push16(0); push32(0);
    push32(rec.localOffset); pushBytes(rec.nameBytes);
  }
  const cdSize = out.length - cdStart;
  push32(0x06054b50); push16(0); push16(0); push16(entries.length); push16(entries.length);
  push32(cdSize); push32(cdStart); push16(0);
  return Uint8Array.from(out);
}

// ---- writeBandPack / readBandPack round trip ----

test('writeBandPack then readBandPack round-trips name, songs and parts', () => {
  const songs = [song('a'), song('b', { title: 'Second' })];
  const parts = [{ Alice: 0, Bob: 1 }, null];
  const bytes = writeBandPack({ name: 'Friday practice', songs, parts });
  const pack = readBandPack(bytes);
  assert.equal(pack.name, 'Friday practice');
  assert.equal(pack.songs.length, 2);
  assert.deepEqual(pack.songs[0], songs[0]);
  assert.deepEqual(pack.songs[1], songs[1]);
  assert.deepEqual(pack.parts, parts);
});

test('writeBandPack omits parts entirely when not given, readBandPack reports null per song', () => {
  const songs = [song('a'), song('b')];
  const bytes = writeBandPack({ name: 'No assignments yet', songs });
  const pack = readBandPack(bytes);
  assert.deepEqual(pack.parts, [null, null]);
});

// ---- the zip is readable by unzip-lite, with correct CRC-32 ----

test('writeBandPack produces a zip that unzip-lite can list and read, with correct CRC-32', () => {
  const songs = [song('a')];
  const bytes = writeBandPack({ name: 'Solo', songs });
  const entries = readZipEntries(bytes);
  const names = entries.map((e) => e.name).sort();
  assert.deepEqual(names, ['band-pack.json', 'songs/0.json']);

  const manifestEntry = entries.find((e) => e.name === 'band-pack.json');
  const manifestBytes = readZipEntryData(bytes, manifestEntry);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  assert.equal(manifest.format, BAND_PACK_FORMAT);
  assert.equal(manifest.version, BAND_PACK_VERSION);
  assert.equal(manifest.songs.length, 1);
  assert.equal(manifest.songs[0].file, 'songs/0.json');
});

test('the CRC-32 stored in the local file header matches the entry data', () => {
  const bytes = writeBandPack({ name: 'Checked', songs: [song('a')] });
  const entries = readZipEntries(bytes);
  for (const entry of entries) {
    const data = readZipEntryData(bytes, entry);
    // Local header layout: sig(4) ver(2) flags(2) method(2) time(2) date(2) crc(4) ...
    const localCrc = (
      bytes[entry.localOffset + 14]
      | (bytes[entry.localOffset + 15] << 8)
      | (bytes[entry.localOffset + 16] << 16)
      | (bytes[entry.localOffset + 17] << 24)
    ) >>> 0;
    assert.equal(localCrc, crc32(data));
  }
});

// ---- writeBandPack validation ----

test('writeBandPack rejects an empty name, no songs, or an invalid song', () => {
  assert.throws(() => writeBandPack({ name: '', songs: [song('a')] }), /name/);
  assert.throws(() => writeBandPack({ name: 'Empty', songs: [] }), /song/);
  assert.throws(() => writeBandPack({ name: 'Bad', songs: [{ id: 'x' }] }), /valid song/);
});

test('writeBandPack rejects a part assignment pointing at a part that does not exist', () => {
  assert.throws(
    () => writeBandPack({ name: 'Bad parts', songs: [song('a')], parts: [{ Alice: 9 }] }),
    /part 9|not one of/
  );
});

// ---- readBandPack error cases ----

test('readBandPack rejects a zip with no band-pack.json manifest', () => {
  const encoder = new TextEncoder();
  const bytes = buildTestZip([{ name: 'songs/0.json', data: encoder.encode(JSON.stringify(song('a'))) }]);
  assert.throws(() => readBandPack(bytes), /manifest/);
});

test('readBandPack rejects the wrong format id instead of guessing', () => {
  const encoder = new TextEncoder();
  const manifest = { format: 'challenge', version: '1.0', name: 'x', songs: [{ file: 'songs/0.json' }] };
  const bytes = buildTestZip([
    { name: 'band-pack.json', data: encoder.encode(JSON.stringify(manifest)) },
    { name: 'songs/0.json', data: encoder.encode(JSON.stringify(song('a'))) },
  ]);
  assert.throws(() => readBandPack(bytes), /format/);
});

test('readBandPack rejects a newer major version', () => {
  const encoder = new TextEncoder();
  const manifest = { format: BAND_PACK_FORMAT, version: '2.0', name: 'x', songs: [{ file: 'songs/0.json' }] };
  const bytes = buildTestZip([
    { name: 'band-pack.json', data: encoder.encode(JSON.stringify(manifest)) },
    { name: 'songs/0.json', data: encoder.encode(JSON.stringify(song('a'))) },
  ]);
  assert.throws(() => readBandPack(bytes), /newer/);
});

test('readBandPack rejects an invalid song inside the pack', () => {
  const encoder = new TextEncoder();
  const manifest = { format: BAND_PACK_FORMAT, version: BAND_PACK_VERSION, name: 'x', songs: [{ file: 'songs/0.json', title: 'Broken' }] };
  const bytes = buildTestZip([
    { name: 'band-pack.json', data: encoder.encode(JSON.stringify(manifest)) },
    { name: 'songs/0.json', data: encoder.encode(JSON.stringify({ title: 'no id' })) },
  ]);
  assert.throws(() => readBandPack(bytes), /song 1/);
});
