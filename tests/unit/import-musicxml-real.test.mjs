// Runs the importer against MusicXML files it has never seen before: a real
// Finale export plus two of the W3C Music Notation Community Group's own
// conformance examples, all under tests/fixtures/musicxml/ (see the README
// there for provenance/licence and the independently-derived note counts
// cited below). Every expected value here was read directly out of the XML
// — see the cited fragments — not produced by running the importer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { importMusicXml, importMxl } from '../../src/song/import-musicxml.js';
import { validateSong } from '../../src/song/model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, '../fixtures/musicxml');
const readFixture = (name) => readFileSync(path.join(fixturesDir, name), 'utf8');

const TPQ = 480;

test('tutorial-chopin-prelude.musicxml (real Finale v28.0 export): key, metre, tempo and the opening chord', () => {
  const xml = readFixture('tutorial-chopin-prelude.musicxml');
  const { song, warnings } = importMusicXml(xml, { fileName: 'tutorial-chopin-prelude.musicxml' });
  assert.doesNotThrow(() => validateSong(song));

  // <key><fifths>-3</fifths><mode>minor</mode></key> -> tonic = ((7*-3 + 9) mod 12 + 12) mod 12 = 0 (C).
  assert.deepEqual(song.key, { tonic: 0, mode: 'minor' });
  // <time symbol="common"><beats>4</beats><beat-type>4</beat-type></time>
  assert.deepEqual(song.metre, { num: 4, den: 4 });
  // <sound tempo="40"/> is the very first <sound>, before any note.
  assert.equal(song.bpm, 40);
  // No <rights>/<creator type="composer"> in <identification>, and no
  // <movement-title>/<work-title> either, so the title falls back to the
  // fileName and composer/licence stay null (see ident.js).
  assert.equal(song.title, 'tutorial-chopin-prelude');
  assert.equal(song.composer, null);
  assert.equal(song.licence, null);

  assert.equal(song.parts.length, 1);
  // Measure 1's first four <note> elements are one <chord/> group (a <note>
  // with no <chord/> starts it, three more each carry <chord/>): G3, C4,
  // Eb4 (<alter>-1</alter>), G4, all <duration>4</duration> with
  // <divisions>4</divisions> -> 480 ticks, all starting at tick 0.
  // midi = (octave+1)*12 + stepPC + alter: G3=55, C4=60, Eb4=63, G4=67.
  const opening = song.parts[0].notes.slice(0, 4);
  assert.deepEqual(opening, [
    { start: 0, dur: TPQ, midi: 55 },
    { start: 0, dur: TPQ, midi: 60 },
    { start: 0, dur: TPQ, midi: 63 },
    { start: 0, dur: TPQ, midi: 67 },
  ]);

  // The file's <note> elements are all pitched (no <rest>/<grace>): a
  // standalone regex sweep (see fixtures README) counted 27 of them, so the
  // importer must not have silently dropped or merged any.
  assert.equal(song.parts[0].notes.length, 27);

  // <direction placement="below"><direction-type><dynamics>...<sound
  // dynamics="112"/></direction> has no tempo attribute and must not be
  // misread as a tempo change (bpm stays 40, no tempoMap at all).
  assert.equal(song.tempoMap, undefined);

  // Three simultaneous <voice> ids (1, 2, 3) are used across the part -> the
  // "N voices flattened" warning must fire, naming the part.
  assert.ok(warnings.some((w) => /3 voices/.test(w) && /Piano/.test(w)), `expected a 3-voices warning, got: ${JSON.stringify(warnings)}`);
});

test('harmonic-element.musicxml (W3C conformance example): a chord with <technical><harmonic> markup, no key/time/sound at all', () => {
  const xml = readFixture('harmonic-element.musicxml');
  const { song, warnings } = importMusicXml(xml, { fileName: 'harmonic-element.musicxml' });
  assert.doesNotThrow(() => validateSong(song));

  // <attributes> has only <divisions>/<clef>, no <key> or <time> anywhere in
  // the file, and no <sound> either -> the importer's absent-value defaults.
  assert.equal(song.key, null);
  assert.deepEqual(song.metre, { num: 4, den: 4 });
  assert.equal(song.bpm, 120);
  assert.ok(warnings.includes('no tempo found; defaulted to 120 bpm'));

  // A 4-note <chord/> group: B3 starts it, then E4, F#4 (<alter>1</alter>)
  // and B4 each carry <chord/>, all wrapped in
  // <notations><technical><harmonic>> the importer must ignore.
  // <divisions>1</divisions>, <duration>1</duration> -> 480 ticks.
  // midi = (octave+1)*12 + stepPC + alter: B3=59, E4=64, F#4=66, B4=71.
  assert.deepEqual(song.parts[0].notes, [
    { start: 0, dur: TPQ, midi: 59 },
    { start: 0, dur: TPQ, midi: 64 },
    { start: 0, dur: TPQ, midi: 66 },
    { start: 0, dur: TPQ, midi: 71 },
  ]);
});

test('barline-multiple-coda.musicxml (W3C conformance example): divisions persists with no repeated <attributes>, whole-measure rests, a <barline> with 3 <coda/> children ignored', () => {
  const xml = readFixture('barline-multiple-coda.musicxml');
  const { song, warnings } = importMusicXml(xml, { fileName: 'barline-multiple-coda.musicxml' });
  assert.doesNotThrow(() => validateSong(song));

  // <key><fifths>0</fifths></key> with no <mode> -> defaults to major.
  assert.deepEqual(song.key, { tonic: 0, mode: 'major' });
  assert.deepEqual(song.metre, { num: 4, den: 4 });
  // No <sound> anywhere.
  assert.equal(song.bpm, 120);
  assert.ok(warnings.includes('no tempo found; defaulted to 120 bpm'));

  // 5 measures, each just <note><rest measure="yes"/><duration>4</duration></note>
  // -> 5 rests, 0 pitched notes kept, even though only measure 1 declares
  // <divisions>1</divisions> (measures 2-5 have no <attributes> at all, so
  // it must carry over rather than reset/throw). The <barline
  // location="right"> with one, two then three <coda/> children (measures
  // 1-3) isn't inspected by the importer at all and must not warn or throw.
  assert.deepEqual(song.parts[0].notes, []);
  assert.equal(warnings.length, 1, `expected only the tempo-default warning, got: ${JSON.stringify(warnings)}`);
});

test('the same real score read through a .mxl archive (synthetic zip, real MusicXML content) imports identically', () => {
  const xmlText = readFixture('tutorial-chopin-prelude.musicxml');
  const zip = buildZip([
    { name: 'META-INF/container.xml', data: Buffer.from(CONTAINER_XML, 'utf8'), method: 0 },
    { name: 'score.musicxml', data: Buffer.from(xmlText, 'utf8'), method: 8 },
  ]);
  const fromMxl = importMxl(zip, { fileName: 'tutorial-chopin-prelude.mxl' });
  const fromXml = importMusicXml(xmlText, { fileName: 'tutorial-chopin-prelude.mxl' });
  assert.deepEqual(fromMxl.song.parts, fromXml.song.parts);
  assert.equal(fromMxl.song.bpm, 40);
  assert.deepEqual(fromMxl.song.key, { tonic: 0, mode: 'minor' });
  assert.deepEqual(fromMxl.warnings, fromXml.warnings);
});

// --- .mxl zip writer, same minimal implementation as tests/unit/import-mxl.test.mjs ---
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
const CONTAINER_XML =
  '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>';
