// Wired into MODS.trombone in src/app.js. Non-transposing, bass clef,
// transposition 0. The bass-clef branch of WIND_KINDS.bc in src/app.js's
// WIND_KINDS table is a display/notation register shift for the shared 'w'
// item-id space, not a pitch transposition -- see the info() 'w' branch
// comment in app.js; this record's own transposition stays 0 because
// trombone genuinely sounds at written pitch. Range (sounding = written,
// bass clef) is a conservative beginner range, not the instrument's full
// compass. MODS.trombone gives this record a fixed windKind ('bc'), and its
// curriculum uses generic level names (not letter names) because this
// range's notes are not one recognisable diatonic set.
export default {
  id: 'trombone',
  name: 'Trombone',
  family: 'brass',
  input: 'mic',
  range: { low: 40, high: 52 }, // conservative beginner range
  transposition: 0,
  clefs: ['bass'],
  octavePolicy: 'exact',
  status: 'ready',
  provenance: null,
  curriculum: [
    { level: 1, items: ['First three notes'] },
    { level: 2, items: ['Two more, going up'] },
    { level: 3, items: ['Up to the top'] },
    { level: 4, items: ['Moves: two notes'] },
    { level: 5, items: ['Moves: three notes'] },
    { level: 6, items: ['Five-note runs'] }
  ]
};
