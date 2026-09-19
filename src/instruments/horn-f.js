// Not in today's MODS. F French horn sounds a perfect fifth below what is
// written, so transposition is -7, matching WIND_KINDS.f in src/app.js:110.
// Range (written, treble clef) is a conservative beginner range, not the
// instrument's full compass. Curriculum not written yet, so status is
// planned and curriculum is [].
export default {
  id: 'horn-f',
  name: 'French horn (F)',
  family: 'brass',
  input: 'mic',
  range: { low: 55, high: 67 }, // conservative beginner range, written pitch
  transposition: -7,
  clefs: ['treble'],
  octavePolicy: 'exact',
  status: 'planned',
  curriculum: []
};
