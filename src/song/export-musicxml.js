// The shared Song shape -> MusicXML (uncompressed, score-partwise).
//
// Wiring: `exportMusicXml(song) -> string` produces the full text of a
// `.musicxml` file. One <part> per song part; measures come from
// model.js's barsOf, which honours song.metreChanges, so bars can change
// width partway through. A note that runs past a barline
// is written as two-or-more tied notes rather than one overlong duration --
// that is what real notation software (and importMusicXml, which walks
// measure-by-measure) expects. song.tempoMap/keyChanges entries are written
// as extra <sound tempo>/<attributes><key> at the measure where they fall.
// Deterministic: the same Song always produces byte-identical XML. No I/O,
// no DOM/global -- the caller writes the string to a file or a download.
//
// Pairs with src/song/import-musicxml.js; see tests/unit/export-musicxml.test.mjs
// for the round-trip proof against every starter song.

import { TICKS_PER_QUARTER, barsOf, partRange } from './model.js';
import { spellMidi } from '../notation/spell.js';

// Same letter -> natural pitch-class table as import-musicxml.js's STEP_PC
// and notation/spell.js's LETTER_BASE_PC. Kept local (not imported) so this
// module has no dependency beyond model.js and spell.js.
const LETTER_BASE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// tonic (0-11) + mode -> the key name spellMidi()/keyAccidentals() expect
// ("C", "F#", "Bbm", ...). Covers the same 12 pitch classes x 2 modes as
// src/ui/editor.js's PC_TO_MAJOR_KEY/PC_TO_MINOR_KEY (kept local rather than
// imported -- song/ export logic should not depend on ui/).
const PC_TO_MAJOR_KEY = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const PC_TO_MINOR_KEY = ['Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'A#m', 'Bm'];

// Note/rest duration (in ticks, divisions == TICKS_PER_QUARTER) -> a
// MusicXML <type> name and dot count, smallest first. Durations with no
// exact match here are written with only <duration> (still valid XML; a
// reader without <type> just can't guess the note's visual shape).
const BASE_TYPES = [
  ['64th', TICKS_PER_QUARTER / 16],
  ['32nd', TICKS_PER_QUARTER / 8],
  ['16th', TICKS_PER_QUARTER / 4],
  ['eighth', TICKS_PER_QUARTER / 2],
  ['quarter', TICKS_PER_QUARTER],
  ['half', TICKS_PER_QUARTER * 2],
  ['whole', TICKS_PER_QUARTER * 4],
];

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function typeForDuration(dur) {
  for (const [name, base] of BASE_TYPES) {
    if (dur === base) return { name, dots: 0 };
    if (dur === base * 1.5) return { name, dots: 1 };
    if (dur === base * 1.75) return { name, dots: 2 };
  }
  return null;
}

// Reverses import-musicxml.js's keyFromFifthsAndMode: the smallest-magnitude
// fifths count (searched 0, +1, -1, +2, -2, ...) whose formula lands back on
// `tonic` for this `mode`.
function fifthsFor(tonic, mode) {
  const order = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7];
  for (const fifths of order) {
    const t = (((7 * fifths + (mode === 'minor' ? 9 : 0)) % 12) + 12) % 12;
    if (t === tonic) return fifths;
  }
  return 0; // unreachable: 7 is coprime with 12, every tonic has a match in [-7, 7]
}

function keyNameFor(tonic, mode) {
  return mode === 'minor' ? PC_TO_MINOR_KEY[tonic] : PC_TO_MAJOR_KEY[tonic];
}

// A MusicXML <note>/<rest> element for one already-barline-clipped segment.
// `seg` is either { rest: true, dur } or { midi, dur, tieStart, tieStop, chord }.
function noteXml(seg, keyName) {
  if (seg.rest) {
    const type = typeForDuration(seg.dur);
    return '<note><rest/><duration>' + seg.dur + '</duration>' +
      (type ? '<type>' + type.name + '</type>' + '<dot/>'.repeat(type.dots) : '') +
      '</note>';
  }
  const spelled = spellMidi(seg.midi, keyName);
  const alter = spelled.accidental === '#' ? 1 : spelled.accidental === 'b' ? -1 : 0;
  // Recompute the octave from the letter+alter actually chosen (rather than
  // trusting spelled.octave) so an enharmonic spelling that crosses a
  // register boundary (e.g. B# for a C, in a 7-sharp key) still round-trips
  // to the exact same midi number: (octave+1)*12 + pcRaw must equal midi.
  const pcRaw = LETTER_BASE_PC[spelled.letter] + alter;
  const octave = (seg.midi - pcRaw) / 12 - 1;
  const type = typeForDuration(seg.dur);
  let xml = '<note>';
  if (seg.chord) xml += '<chord/>';
  xml += '<pitch><step>' + spelled.letter + '</step>';
  if (alter !== 0) xml += '<alter>' + alter + '</alter>';
  xml += '<octave>' + octave + '</octave></pitch>';
  xml += '<duration>' + seg.dur + '</duration>';
  if (seg.tieStop) xml += '<tie type="stop"/>';
  if (seg.tieStart) xml += '<tie type="start"/>';
  if (type) xml += '<type>' + type.name + '</type>' + '<dot/>'.repeat(type.dots);
  if (seg.tieStop || seg.tieStart) {
    xml += '<notations>';
    if (seg.tieStop) xml += '<tied type="stop"/>';
    if (seg.tieStart) xml += '<tied type="start"/>';
    xml += '</notations>';
  }
  xml += '</note>';
  return xml;
}

// Ticks in one bar of `metre` ({ num, den }). Mirrors model.js's private
// barTicksOf, which only ever sees the song's single initial metre.
function barTicksFor(metre) {
  return metre.num * (4 / metre.den) * TICKS_PER_QUARTER;
}

// The active `metre` for the bar starting at `boundaries[i]`.
function metreAt(song, boundaries, i) {
  const mStart = boundaries[i];
  let metre = song.metre;
  for (const c of song.metreChanges ?? []) {
    if (c.tick <= mStart) metre = { num: c.num, den: c.den };
  }
  return metre;
}

// The active `key` ({ tonic, mode }) for the bar starting at `boundaries[i]`.
function keyAt(song, boundaries, i) {
  const mStart = boundaries[i];
  let key = song.key ?? { tonic: 0, mode: 'major' };
  for (const c of song.keyChanges ?? []) {
    if (c.tick <= mStart) key = { tonic: c.tonic, mode: c.mode };
  }
  return key;
}

// The measure index `i` such that `boundaries[i] <= tick < boundaries[i+1]`
// (clamped into the last measure for a tick at or past the song's end).
function measureIndexForTick(boundaries, tick) {
  for (let i = 0; i < boundaries.length - 1; i++) {
    if (tick >= boundaries[i] && tick < boundaries[i + 1]) return i;
  }
  return boundaries.length - 2;
}

// Splits the notes starting in measure `i` (plus any tied continuation
// carried in from the previous measure) into position-grouped segments
// clipped to this measure's length, and reports what still needs to carry
// into the next measure.
function buildMeasure(part, boundaries, i, carryIn) {
  const mStart = boundaries[i];
  const mEnd = boundaries[i + 1];
  const mLen = mEnd - mStart;

  const byPos = new Map();
  if (carryIn.length) {
    byPos.set(0, carryIn.map((c) => {
      const segDur = Math.min(c.remaining, mLen);
      return { midi: c.midi, dur: segDur, tieStop: true, tieStart: c.remaining > segDur, leftover: c.remaining - segDur };
    }));
  }

  // Bar boundaries can be non-uniform (a metre change mid-song), so notes
  // are matched directly against this measure's own [mStart, mEnd) range
  // rather than via model.js's notesInBar, which assumes one fixed width.
  const newNotes = part.notes.filter((note) => note.start >= mStart && note.start < mEnd);
  for (const note of newNotes) {
    const pos = note.start - mStart;
    const available = mLen - pos;
    const segDur = Math.min(note.dur, available);
    const seg = { midi: note.midi, dur: segDur, tieStop: Boolean(note.tieFromPrev), tieStart: note.dur > segDur, leftover: note.dur - segDur };
    if (byPos.has(pos)) byPos.get(pos).push(seg);
    else byPos.set(pos, [seg]);
  }

  const groups = [...byPos.keys()].sort((a, b) => a - b).map((pos) => ({ pos, notes: byPos.get(pos) }));
  const carryOut = [];
  for (const g of groups) {
    for (const n of g.notes) {
      if (n.leftover > 0) carryOut.push({ midi: n.midi, remaining: n.leftover });
    }
  }
  return { mLen, groups, carryOut };
}

function groupsToNotesXml(groups, mLen, keyName) {
  let xml = '';
  let cursor = 0;
  for (const g of groups) {
    if (g.pos > cursor) {
      xml += noteXml({ rest: true, dur: g.pos - cursor }, keyName);
      cursor = g.pos;
    }
    const advance = Math.max(...g.notes.map((n) => n.dur));
    g.notes.forEach((n, idx) => {
      xml += noteXml({ midi: n.midi, dur: n.dur, tieStart: n.tieStart, tieStop: n.tieStop, chord: idx > 0 }, keyName);
    });
    cursor += advance;
  }
  if (cursor < mLen) xml += noteXml({ rest: true, dur: mLen - cursor }, keyName);
  return xml;
}

function attributesXml(metre, fifths, mode, clef) {
  return '<attributes><divisions>' + TICKS_PER_QUARTER + '</divisions>' +
    '<key><fifths>' + fifths + '</fifths><mode>' + mode + '</mode></key>' +
    '<time><beats>' + metre.num + '</beats><beat-type>' + metre.den + '</beat-type></time>' +
    '<clef><sign>' + clef.sign + '</sign><line>' + clef.line + '</line></clef>' +
    '</attributes>';
}

// Treble clef unless the part's notes sit mostly below middle C (midi 60),
// in which case bass clef reads more naturally.
function clefFor(part) {
  const range = partRange(part);
  if (range.low === null) return { sign: 'G', line: 2 };
  const mid = (range.low + range.high) / 2;
  return mid < 60 ? { sign: 'F', line: 4 } : { sign: 'G', line: 2 };
}

// Note spelling (spellMidi's keyName) stays fixed at the song's initial key
// throughout -- only the written <attributes>/<key> that a reader sees
// changes per segment; re-spelling every note per key segment is a bigger
// change than "don't drop the mid-song changes" calls for.
function partXml(song, part, boundaries, keyName, fifths, mode, includeTempo, changeMeasures, tempoByMeasure) {
  const clef = clefFor(part);
  let carry = [];
  const measures = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const { mLen, groups, carryOut } = buildMeasure(part, boundaries, i, carry);
    carry = carryOut;
    let body = '';
    if (i === 0) {
      body += attributesXml(song.metre, fifths, mode, clef);
    } else if (changeMeasures.has(i)) {
      const metre = metreAt(song, boundaries, i);
      const key = keyAt(song, boundaries, i);
      body += attributesXml(metre, fifthsFor(key.tonic, key.mode), key.mode, clef);
    }
    if (includeTempo) {
      if (i === 0) body += '<sound tempo="' + song.bpm + '"/>';
      for (const bpm of tempoByMeasure.get(i) ?? []) body += '<sound tempo="' + bpm + '"/>';
    }
    body += groupsToNotesXml(groups, mLen, keyName);
    measures.push('<measure number="' + (i + 1) + '">' + body + '</measure>');
  }
  return '<part id="' + escapeXml(part.id) + '">' + measures.join('') + '</part>';
}

function identificationXml(song) {
  let inner = '';
  if (song.composer) inner += '<creator type="composer">' + escapeXml(song.composer) + '</creator>';
  if (song.licence) inner += '<rights>' + escapeXml(song.licence) + '</rights>';
  return inner ? '<identification>' + inner + '</identification>' : '';
}

export function exportMusicXml(song) {
  const boundaries = barsOf(song);
  const keyInfo = song.key ?? { tonic: 0, mode: 'major' };
  const fifths = fifthsFor(keyInfo.tonic, keyInfo.mode);
  const keyName = keyNameFor(keyInfo.tonic, keyInfo.mode);

  // Which measures need a fresh <attributes> block (a metre and/or key
  // change lands there), and which need extra <sound tempo> elements --
  // computed once, from tick to measure index, and shared by every part.
  const changeMeasures = new Set();
  for (const c of song.metreChanges ?? []) {
    const i = measureIndexForTick(boundaries, c.tick);
    if (i > 0) changeMeasures.add(i);
  }
  for (const c of song.keyChanges ?? []) {
    const i = measureIndexForTick(boundaries, c.tick);
    if (i > 0) changeMeasures.add(i);
  }
  const tempoByMeasure = new Map();
  for (const t of song.tempoMap ?? []) {
    const i = measureIndexForTick(boundaries, t.tick);
    if (i === 0) continue; // measure 1's tempo is always song.bpm
    if (!tempoByMeasure.has(i)) tempoByMeasure.set(i, []);
    tempoByMeasure.get(i).push(t.bpm);
  }

  const partListXml = song.parts
    .map((p) => '<score-part id="' + escapeXml(p.id) + '"><part-name>' + escapeXml(p.name) + '</part-name></score-part>')
    .join('');
  const partsXml = song.parts
    .map((part, idx) => partXml(song, part, boundaries, keyName, fifths, keyInfo.mode, idx === 0, changeMeasures, tempoByMeasure))
    .join('');

  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n' +
    '<score-partwise version="4.0">' +
    '<movement-title>' + escapeXml(song.title) + '</movement-title>' +
    identificationXml(song) +
    '<part-list>' + partListXml + '</part-list>' +
    partsXml +
    '</score-partwise>\n';
}
