// Not in today's MODS. Concert-pitch instrument, transposition 0, matching
// WIND_KINDS.c in src/app.js:110. Range (treble clef) is a conservative
// beginner range, not the instrument's full compass. Curriculum not written
// yet, so status is planned and curriculum is [].
export default {
  id: 'flute',
  name: 'Flute',
  family: 'wind',
  input: 'mic',
  range: { low: 60, high: 72 }, // conservative beginner range
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'exact',
  status: 'planned',
  curriculum: []
};
