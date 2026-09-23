// Wired into MODS.trumpet-bb in src/app.js. B flat trumpet sounds a major
// second below what is written, so transposition is -2 (sounding = written -
// 2), matching WIND_KINDS.bb in src/app.js's WIND_KINDS table. Range
// (written, treble clef) is a conservative beginner range covering the
// instrument's first-octave open partials and valve combinations, not its
// full compass. MODS.trumpet-bb gives this record its own fixed windKind
// ('bb') so its info() reading never depends on the learner's generic wind
// preference (prefs.wind) -- see the windKind comment in app.js. Curriculum
// follows beginner method-book order: written C, D, E first (the notes
// nearest open/one-valve fingerings), then F and G, then the notes up to
// high C, then the two accidentals in this range, then moves and runs --
// the same shape MODS.kbd/mallet-percussion already use for a first-octave
// curriculum.
export default {
  id: 'trumpet-bb',
  name: 'Trumpet (B flat)',
  family: 'brass',
  input: 'mic',
  range: { low: 60, high: 72 }, // conservative beginner range, written pitch
  transposition: -2,
  clefs: ['treble'],
  octavePolicy: 'exact',
  status: 'ready',
  curriculum: [
    { level: 1, items: ['Written C, D and E'] },
    { level: 2, items: ['Add F and G'] },
    { level: 3, items: ['Add A, B and high C'] },
    { level: 4, items: ['Sharps and flats: F sharp and B flat'] },
    { level: 5, items: ['Moves: two notes'] },
    { level: 6, items: ['Moves: three notes'] },
    { level: 7, items: ['Five-note runs'] }
  ]
};
