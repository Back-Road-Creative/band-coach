// Fingering charts for keyed Boehm-system woodwinds (flute, clarinet, oboe,
// saxophone). UNLIKE brass.js's valve/slide arithmetic, a keyed woodwind's
// fingering does not fall out of a formula, so these are typed data tables,
// same approach as recorder-whistle.js. NEEDS A MUSICIAN'S CHECK: every
// `keys` string below is a good-faith standard beginner fingering written
// from general knowledge, not verified note-by-note against a fingering
// chart or a player. Flag especially: every sharp/flat (chromatic, non-white
// -key) note on all four tables — these are where real charts use "fork"
// or alternate fingerings that a from-memory description is most likely to
// get wrong — and the oboe's top three notes (C5, C#5, D5), which cross the
// octave-key break and use the half-hole technique (`halfHole: true`); D5
// in particular is named in the spec as the note most likely to need
// correcting. Zero dependencies; pure data + lookup; no DOM.
//
// Written pitch throughout (matches each instrument record's `range`, which
// is written, not concert, pitch). `keyedFingeringFor(midi, chart)` returns
// the entry or null if the pitch isn't in this table's range, and throws on
// an unknown chart name.
//
// KNOWN ISSUE (see the unit report, not fixed here): a saxophone's lowest
// written note is Bb3 (midi 58) — written 55-57, inside
// sax-alto-eb.js/sax-tenor-bb.js's current beginner range, do not exist on
// the horn. SAX_NOTES has no entries for them, so keyedFingeringFor returns
// null for 55-57 exactly like an out-of-range pitch. Correcting the two
// records' range.low is a follow-up, not this change.

function noteName(midi) {
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

function buildTable(entries) {
  return entries.map(e => ({ midi: e.midi, name: noteName(e.midi), keys: e.keys, ...(e.halfHole ? { halfHole: true } : {}) }));
}

// Flute, concert pitch (transposition 0, matches flute.js), one octave C4-C5
// (60-72), the low register a beginner flute lesson starts in.
export const FLUTE_NOTES = buildTable([
  { midi: 60, keys: 'left hand: thumb, 1 2 3; right hand: 1 2 3; footjoint: low C and low C# keys down' },
  { midi: 61, keys: 'left hand: thumb, 1 2 3; right hand: 1 2 3; footjoint: low C# key down' },
  { midi: 62, keys: 'left hand: thumb, 1 2 3; right hand: 1 2 3' },
  { midi: 63, keys: 'left hand: thumb, 1 2 3; right hand: 1 2, Eb key' },
  { midi: 64, keys: 'left hand: thumb, 1 2 3; right hand: 1 2' },
  { midi: 65, keys: 'left hand: thumb, 1 2 3; right hand: 1' },
  { midi: 66, keys: 'left hand: thumb, 1 2; right hand: 1 2 3' },
  { midi: 67, keys: 'left hand: thumb, 1 2; right hand: 1' },
  { midi: 68, keys: 'left hand: thumb, 1 2; right hand: none, Eb key' },
  { midi: 69, keys: 'left hand: thumb, 1; right hand: none' },
  { midi: 70, keys: 'left hand: thumb, 1; right hand: 2 3' },
  { midi: 71, keys: 'left hand: thumb; right hand: none' },
  { midi: 72, keys: 'left hand: thumb, 1; right hand: none' }
]);

// B flat clarinet, written pitch (transposition -2, matches clarinet-bb.js),
// G3-G4 (55-67), the chalumeau (lowest) register — below the break, so no
// register key.
export const CLARINET_NOTES = buildTable([
  { midi: 55, keys: 'left hand: thumb, 1 2 3; right hand: 1 2 3, right pinky low E key' },
  { midi: 56, keys: 'left hand: thumb, 1 2 3; right hand: 1 2 3, right pinky low Eb/D# key' },
  { midi: 57, keys: 'left hand: thumb, 1 2 3; right hand: 1 2 3' },
  { midi: 58, keys: 'left hand: thumb, 1 2 3; right hand: 1 2, right pinky side Bb key' },
  { midi: 59, keys: 'left hand: thumb, 1 2 3; right hand: 1 2' },
  { midi: 60, keys: 'left hand: thumb, 1 2 3; right hand: 1' },
  { midi: 61, keys: 'left hand: thumb, 1 2 3; right hand: side key' },
  { midi: 62, keys: 'left hand: thumb, 1 2; right hand: 1 2' },
  { midi: 63, keys: 'left hand: thumb, 1 2; right hand: 1, side key' },
  { midi: 64, keys: 'left hand: thumb, 1 2; right hand: none' },
  { midi: 65, keys: 'left hand: thumb, 1; right hand: 1 2' },
  { midi: 66, keys: 'left hand: thumb, 1; right hand: 1, side key' },
  { midi: 67, keys: 'left hand: thumb, 1; right hand: none' }
]);

// Oboe, written = concert pitch (transposition 0, matches oboe.js), D4-D5
// (62-74). The top three notes (C5, C#5, D5) sit at or past the octave-key
// break and use the half-hole technique (LH first finger rolled to leave a
// sliver open), flagged `halfHole: true` — least confident of this whole
// file, see the top comment.
export const OBOE_NOTES = buildTable([
  { midi: 62, keys: 'left hand: thumb, 1 2 3; right hand: 1 2 3, right pinky low C and Eb keys' },
  { midi: 63, keys: 'left hand: thumb, 1 2 3; right hand: 1 2 3, right pinky Eb key' },
  { midi: 64, keys: 'left hand: thumb, 1 2 3; right hand: 1 2 3' },
  { midi: 65, keys: 'left hand: thumb, 1 2 3; right hand: 1 2, F key' },
  { midi: 66, keys: 'left hand: thumb, 1 2 3; right hand: 1 2' },
  { midi: 67, keys: 'left hand: thumb, 1 2 3; right hand: 1' },
  { midi: 68, keys: 'left hand: thumb, 1 2 3; right hand: side Ab key' },
  { midi: 69, keys: 'left hand: thumb, 1 2 3; right hand: none' },
  { midi: 70, keys: 'left hand: thumb, 1 2, Bb key; right hand: none' },
  { midi: 71, keys: 'left hand: thumb, 1 2; right hand: none' },
  { midi: 72, keys: 'left hand: thumb, half-hole on 1, octave key; right hand: none', halfHole: true },
  { midi: 73, keys: 'left hand: thumb, half-hole on 1, octave key; right hand: side key', halfHole: true },
  { midi: 74, keys: 'left hand: thumb, half-hole on 1, octave key; right hand: 1 2 3', halfHole: true }
]);

// Saxophone (alto, tenor, and every other size — all saxes share written
// fingerings, matches sax-alto-eb.js and sax-tenor-bb.js), written Bb3-G4
// (58-67). A sax's lowest written note is Bb3 (58); there is no 55-57 —
// see the KNOWN ISSUE in the top comment. This table simply has no entries
// for 55-57, so keyedFingeringFor returns null for them like any
// out-of-range pitch.
export const SAX_NOTES = buildTable([
  { midi: 58, keys: 'left hand: thumb, 1 2 3, bis/side Bb key; right hand: 1 2 3, low Bb key' },
  { midi: 59, keys: 'left hand: thumb, 1 2 3; right hand: 1 2 3, low B key' },
  { midi: 60, keys: 'left hand: thumb, 1 2 3; right hand: 1 2 3' },
  { midi: 61, keys: 'left hand: thumb, 1 2 3; right hand: 1 2' },
  { midi: 62, keys: 'left hand: thumb, 1 2 3; right hand: 1' },
  { midi: 63, keys: 'left hand: thumb, 1 2 3; right hand: side Eb key' },
  { midi: 64, keys: 'left hand: thumb, 1 2; right hand: none' },
  { midi: 65, keys: 'left hand: thumb, 1; right hand: none' },
  { midi: 66, keys: 'left hand: thumb, 1, side F# key; right hand: none' },
  { midi: 67, keys: 'left hand: thumb; right hand: none' }
]);

export function keyedFingeringFor(midi, chart) {
  const table = chart === 'flute' ? FLUTE_NOTES : chart === 'clarinet' ? CLARINET_NOTES : chart === 'oboe' ? OBOE_NOTES : chart === 'sax' ? SAX_NOTES : null;
  if (!table) throw new Error('unknown chart ' + JSON.stringify(chart));
  return table.find(n => n.midi === midi) || null;
}
