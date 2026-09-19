// Not in today's MODS. Non-transposing, bass clef, transposition 0, matching
// WIND_KINDS.bc in src/app.js:110 (trombone/euphonium/tuba group). Range
// (sounding, bass clef) is a conservative beginner range, not the
// instrument's full compass. Curriculum not written yet, so status is
// planned and curriculum is [].
export default {
  id: 'trombone',
  name: 'Trombone',
  family: 'brass',
  input: 'mic',
  range: { low: 40, high: 52 }, // conservative beginner range
  transposition: 0,
  clefs: ['bass'],
  octavePolicy: 'exact',
  status: 'planned',
  curriculum: []
};
