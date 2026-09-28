// Unit H4: a two-staff MusicXML piano part (<staves>2</staves>) tags each
// imported note for a hand -- staff 1 -> 'rh', staff 2 -> 'lh' -- so
// handsAvailable (src/song/hand-filter.js) sees a real two-handed part
// instead of inferring one from the middle-C pitch split. A part with no
// <staves>, or <staves>1</staves>, must import exactly as it always has (no
// `hand` field at all); a part with 3+ staves (for example organ pedals)
// gets no hand tags either, plus a warning, since a pedal isn't a hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { importMusicXml, importMxl } from '../../src/song/import-musicxml.js';
import { INSTRUMENTS } from '../../src/instruments/index.js';
import { buildLessonPlan } from '../../src/song/lesson.js';
import { arrangeFor } from '../../src/song/arrange/index.js';
import { validateSong } from '../../src/song/model.js';
import { handsAvailable } from '../../src/song/hand-filter.js';

const kbd = INSTRUMENTS.find((r) => r.id === 'kbd');

function arr(song, partId) {
  const fit = buildLessonPlan(song, partId, kbd).fit;
  return arrangeFor(fit.notes, kbd, {});
}

const TWO_STAFF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><staves>2</staves></attributes>
      <sound tempo="90"/>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

const ONE_STAFF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <sound tempo="90"/>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

const CHORD_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><staves>2</staves></attributes>
      <sound tempo="90"/>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <backup><duration>1</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
      <note><chord/><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

const THREE_STAFF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Organ</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><staves>3</staves></attributes>
      <sound tempo="90"/>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <backup><duration>1</duration></backup>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>2</voice><type>quarter</type><staff>2</staff></note>
      <backup><duration>1</duration></backup>
      <note><pitch><step>C</step><octave>2</octave></pitch><duration>1</duration><voice>3</voice><type>quarter</type><staff>3</staff></note>
    </measure>
  </part>
</score-partwise>`;

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }
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

test('a two-staff part: staff 1 notes get hand:rh, staff 2 notes get hand:lh, and handsAvailable sees both', () => {
  const { song } = importMusicXml(TWO_STAFF_XML, { fileName: 'two-staff.musicxml' });
  assert.equal(validateSong(song).ok !== false, true);
  for (const note of song.parts[0].notes) {
    if (note.midi >= 60) assert.equal(note.hand, 'rh', `midi ${note.midi} should be rh`);
    else assert.equal(note.hand, 'lh', `midi ${note.midi} should be lh`);
  }
  const arrangement = arr(song, 'P1');
  assert.deepEqual(handsAvailable(song, 'P1', arrangement).sort(), ['lh', 'rh']);
});

test('the same two-staff content read through .mxl bytes gives the same hands', () => {
  const zip = buildZip([{ name: 'score.xml', data: Buffer.from(TWO_STAFF_XML, 'utf8'), method: 8 }]);
  const { song } = importMxl(zip, { fileName: 'two-staff.mxl' });
  const { song: expected } = importMusicXml(TWO_STAFF_XML, { fileName: 'two-staff.mxl' });
  assert.deepEqual(song.parts, expected.parts);
  for (const note of song.parts[0].notes) {
    if (note.midi >= 60) assert.equal(note.hand, 'rh');
    else assert.equal(note.hand, 'lh');
  }
});

test('in a two-staff part, a note with no <staff> child defaults to rh, and a <chord/> note keeps its own staff\'s hand', () => {
  const { song } = importMusicXml(CHORD_XML, { fileName: 'chord.musicxml' });
  const notes = song.parts[0].notes;
  assert.equal(notes.length, 3);
  const e4 = notes.find((n) => n.midi === 64);
  assert.equal(e4.hand, 'rh', 'note with no <staff> child defaults to rh (staff 1)');
  const c3 = notes.find((n) => n.midi === 48);
  const g3 = notes.find((n) => n.midi === 55);
  assert.equal(c3.hand, 'lh');
  assert.equal(g3.hand, 'lh', 'chord note keeps its own staff\'s hand');
});

test('a single-staff part (no <staves>, no <staff>) imports unchanged: no hand field at all, handsAvailable is rh-only', () => {
  const { song } = importMusicXml(ONE_STAFF_XML, { fileName: 'one-staff.musicxml' });
  for (const note of song.parts[0].notes) assert.equal('hand' in note, false, `note midi ${note.midi} should carry no hand field`);
  const arrangement = arr(song, 'P1');
  assert.deepEqual(handsAvailable(song, 'P1', arrangement), ['rh']);
});

test('a 3-staff part (e.g. organ with pedals) gets no hand fields and a warning naming the staff count', () => {
  const { song, warnings } = importMusicXml(THREE_STAFF_XML, { fileName: 'organ.musicxml' });
  for (const note of song.parts[0].notes) assert.equal('hand' in note, false);
  assert.ok(warnings.some((w) => /3 staves/.test(w) && /hands not assigned/.test(w)), `expected a staves warning, got: ${JSON.stringify(warnings)}`);
});
