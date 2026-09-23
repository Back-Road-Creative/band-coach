import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { inflateRaw, readZipEntries, readZipEntryData, readMxlRootEntry, MAX_ENTRY_BYTES } from '../../src/song/unzip-lite.js';

// A minimal, hand-rolled ZIP writer for the test only: local file header +
// data (stored or deflate) per entry, then one central directory entry per
// file, then a single end-of-central-directory record. No data descriptors,
// no zip64 — small test fixtures only.
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }

function buildZip(files) {
  // files: [{ name, data: Buffer, method: 0|8, declaredUncompressedSize? }]
  // declaredUncompressedSize, when present, is written into both headers
  // INSTEAD of f.data.length — lets a test simulate a zip whose header lies
  // about how big the entry really unpacks to.
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const stored = f.method === 8 ? zlib.deflateRawSync(f.data) : f.data;
    const declaredSize = f.declaredUncompressedSize ?? f.data.length;
    const localHeader = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(f.method), u16(0), u16(0),
      u32(0), u32(stored.length), u32(declaredSize),
      u16(nameBuf.length), u16(0),
      nameBuf,
    ]);
    const localOffset = offset;
    localChunks.push(localHeader, stored);
    offset += localHeader.length + stored.length;

    const centralHeader = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(f.method), u16(0), u16(0),
      u32(0), u32(stored.length), u32(declaredSize),
      u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(localOffset),
      nameBuf,
    ]);
    centralChunks.push(centralHeader);
  }
  const centralStart = offset;
  const central = Buffer.concat(centralChunks);
  offset += central.length;
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(central.length), u32(centralStart), u16(0),
  ]);
  return new Uint8Array(Buffer.concat([...localChunks, central, eocd]));
}

test('inflateRaw byte-exactly reverses a stored-then-deflated round trip (small content)', () => {
  const original = Buffer.from('The quick brown fox jumps over the lazy dog. '.repeat(3), 'utf8');
  const compressed = zlib.deflateRawSync(original);
  const out = inflateRaw(new Uint8Array(compressed));
  assert.deepEqual(Buffer.from(out), original);
});

test('inflateRaw byte-exactly reverses content large/varied enough to force dynamic Huffman blocks', () => {
  const parts = [];
  for (let i = 0; i < 5000; i++) parts.push(String.fromCharCode(32 + ((i * 37 + i * i) % 95)));
  const original = Buffer.from(parts.join(''), 'latin1');
  const compressed = zlib.deflateRawSync(original, { level: 9 });
  // Sanity: this content is varied enough that zlib does not emit a single
  // fixed-Huffman or stored block only — dynamic Huffman is exercised.
  const out = inflateRaw(new Uint8Array(compressed));
  assert.deepEqual(Buffer.from(out), original);
});

test('readZipEntries + readZipEntryData decode a stored entry byte-exactly', () => {
  const data = Buffer.from('stored content, no compression at all', 'utf8');
  const zip = buildZip([{ name: 'hello.txt', data, method: 0 }]);
  const entries = readZipEntries(zip);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'hello.txt');
  const out = readZipEntryData(zip, entries[0]);
  assert.deepEqual(Buffer.from(out), data);
});

test('readZipEntries + readZipEntryData decode a deflated entry byte-exactly', () => {
  const data = Buffer.from('deflated content '.repeat(200), 'utf8');
  const zip = buildZip([{ name: 'song.musicxml', data, method: 8 }]);
  const entries = readZipEntries(zip);
  const out = readZipEntryData(zip, entries[0]);
  assert.deepEqual(Buffer.from(out), data);
});

test('readMxlRootEntry follows META-INF/container.xml to the rootfile', () => {
  const musicxml = Buffer.from('<score-partwise version="3.1"><part-list/></score-partwise>', 'utf8');
  const container = Buffer.from(
    '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>',
    'utf8'
  );
  const zip = buildZip([
    { name: 'META-INF/container.xml', data: container, method: 0 },
    { name: 'score.musicxml', data: musicxml, method: 8 },
  ]);
  const found = readMxlRootEntry(zip);
  assert.equal(found.name, 'score.musicxml');
  assert.deepEqual(Buffer.from(found.bytes), musicxml);
});

test('readMxlRootEntry falls back to the first non-META-INF .xml/.musicxml entry when there is no container.xml', () => {
  const musicxml = Buffer.from('<score-partwise version="3.1"><part-list/></score-partwise>', 'utf8');
  const zip = buildZip([{ name: 'anything.xml', data: musicxml, method: 0 }]);
  const found = readMxlRootEntry(zip);
  assert.equal(found.name, 'anything.xml');
  assert.deepEqual(Buffer.from(found.bytes), musicxml);
});

// ---- zip-bomb / output-size cap -----------------------------------------

test('inflateRaw stops and throws a clear error as soon as output would exceed a small override cap', () => {
  // A highly-compressible "bomb": a large zero buffer deflates to almost
  // nothing but expands back to its full size — exactly the shape that
  // would freeze a tab if left uncapped.
  const bomb = Buffer.alloc(1024 * 1024, 0); // 1 MB of zeros
  const compressed = zlib.deflateRawSync(bomb, { level: 9 });
  assert.ok(compressed.length < 4096, 'fixture should compress far smaller than its inflated size');
  assert.throws(
    () => inflateRaw(new Uint8Array(compressed), 1024), // override cap: 1 KB
    /larger than the.*limit|zip bomb/i
  );
});

test('readZipEntryData rejects an entry whose declared uncompressed size exceeds the cap, without inflating it', () => {
  const small = Buffer.from('tiny payload', 'utf8');
  const zip = buildZip([{ name: 'huge.musicxml', data: small, method: 8, declaredUncompressedSize: MAX_ENTRY_BYTES + 1 }]);
  const entries = readZipEntries(zip);
  assert.equal(entries[0].uncompressedSize, MAX_ENTRY_BYTES + 1);
  assert.throws(() => readZipEntryData(zip, entries[0]), /larger than the.*limit|zip bomb/i);
});

test('readZipEntryData still accepts a normal deflated entry well under the cap', () => {
  const data = Buffer.from('ordinary musicxml content '.repeat(500), 'utf8');
  const zip = buildZip([{ name: 'song.musicxml', data, method: 8 }]);
  const entries = readZipEntries(zip);
  const out = readZipEntryData(zip, entries[0]);
  assert.deepEqual(Buffer.from(out), data);
});

test('readZipEntryData honors a per-call maxBytes override to reject a smaller entry a caller wants capped tighter', () => {
  const data = Buffer.from('x'.repeat(2000), 'utf8');
  const zip = buildZip([{ name: 'song.musicxml', data, method: 8 }]);
  const entries = readZipEntries(zip);
  assert.throws(() => readZipEntryData(zip, entries[0], 1000), /larger than the.*limit|zip bomb/i);
});
