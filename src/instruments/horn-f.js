// Wired into MODS['horn-f'] in src/app.js. F French horn sounds a perfect
// fifth below what is written, so transposition is -7, matching WIND_KINDS.f
// in src/app.js's WIND_KINDS table. Range (written, treble clef) is a
// conservative beginner range, not the instrument's full compass. Like
// trumpet-bb, MODS['horn-f'] gives this record a fixed windKind ('f') so its
// info() reading never depends on the learner's generic wind preference.
// Curriculum starts at the bottom of this range (written G) and climbs, in
// the same 2-3-notes-per-level shape as the other new brass records, ending
// with an accidentals level, then moves and runs.
export default {
  id: 'horn-f',
  name: 'French horn (F)',
  family: 'brass',
  input: 'mic',
  range: { low: 55, high: 67 }, // conservative beginner range, written pitch
  transposition: -7,
  clefs: ['treble'],
  octavePolicy: 'exact',
  status: 'ready',
  curriculum: [
    { level: 1, items: ['Written G, A and B'] },
    { level: 2, items: ['Add C and D'] },
    { level: 3, items: ['Add E, F and high G'] },
    { level: 4, items: ['Sharps and flats: C sharp and F sharp'] },
    { level: 5, items: ['Moves: two notes'] },
    { level: 6, items: ['Moves: three notes'] },
    { level: 7, items: ['Five-note runs'] }
  ]
};
