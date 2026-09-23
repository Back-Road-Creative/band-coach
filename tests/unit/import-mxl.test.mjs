import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { importMusicXml, importMxl } from '../../src/song/import-musicxml.js';

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }

// Same minimal zip writer as tests/unit/unzip-lite.test.mjs (kept local:
// this file should stand alone as a proof of the import path).
function buildZip(files) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const stored = f.method === 8 ? zlib.deflateRawSync(f.data) : f.data;
    const localHeader = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(f.method), u16(0), u16(0),
      u32(0), u32(stored.length), u32(f.data.length),
      u16(nameBuf.length), u16(0),
      nameBuf,
    ]);
    const localOffset = offset;
    localChunks.push(localHeader, stored);
    offset += localHeader.length + stored.length;

    const centralHeader = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(f.method), u16(0), u16(0),
      u32(0), u32(stored.length), u32(f.data.length),
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

const CONTAINER_XML =
  '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>';

const PARTWISE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Test Part</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key>
      <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <sound tempo="100"/>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

function timewiseEquivalentOf(partwiseXml) {
  // Hand-transposed timewise version of PARTWISE_XML above (one part, one
  // measure) so the two documents describe the same score.
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-timewise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Test Part</part-name></score-part>
  </part-list>
  <measure number="1">
    <part id="P1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key>
      <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <sound tempo="100"/>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </part>
  </measure>
</score-timewise>`;
}

test('an .mxl zip (with container.xml, deflated entry) imports identically to the plain XML', () => {
  const zip = buildZip([
    { name: 'META-INF/container.xml', data: Buffer.from(CONTAINER_XML, 'utf8'), method: 0 },
    { name: 'score.musicxml', data: Buffer.from(PARTWISE_XML, 'utf8'), method: 8 },
  ]);
  const fromMxl = importMxl(zip, { fileName: 'tune.mxl' });
  const fromXml = importMusicXml(PARTWISE_XML, { fileName: 'tune.mxl' });
  assert.deepEqual(fromMxl.song.parts, fromXml.song.parts);
  assert.equal(fromMxl.song.bpm, fromXml.song.bpm);
  assert.deepEqual(fromMxl.song.key, fromXml.song.key);
  assert.deepEqual(fromMxl.warnings, fromXml.warnings);
});

test('importMusicXml also accepts .mxl bytes directly (ArrayBuffer), as the import route will pass them', () => {
  const zip = buildZip([{ name: 'score.xml', data: Buffer.from(PARTWISE_XML, 'utf8'), method: 8 }]);
  const arrayBuffer = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
  const { song } = importMusicXml(arrayBuffer, { fileName: 'tune.mxl' });
  const { song: expected } = importMusicXml(PARTWISE_XML, { fileName: 'tune.mxl' });
  assert.deepEqual(song.parts, expected.parts);
});

test('a score-timewise document imports identically to its score-partwise equivalent', () => {
  const timewise = timewiseEquivalentOf(PARTWISE_XML);
  const fromTimewise = importMusicXml(timewise);
  const fromPartwise = importMusicXml(PARTWISE_XML);
  assert.deepEqual(fromTimewise.song.parts, fromPartwise.song.parts);
  assert.equal(fromTimewise.song.bpm, fromPartwise.song.bpm);
  assert.deepEqual(fromTimewise.song.key, fromPartwise.song.key);
  assert.deepEqual(fromTimewise.song.metre, fromPartwise.song.metre);
  assert.deepEqual(fromTimewise.warnings, fromPartwise.warnings);
});

test('a compressed .mxl timewise document also imports (both conversions compose)', () => {
  const timewise = timewiseEquivalentOf(PARTWISE_XML);
  const zip = buildZip([{ name: 'score.musicxml', data: Buffer.from(timewise, 'utf8'), method: 8 }]);
  const { song } = importMxl(zip);
  const { song: expected } = importMusicXml(PARTWISE_XML);
  assert.deepEqual(song.parts, expected.parts);
});
