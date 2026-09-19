// Not in today's MODS. B flat trumpet sounds a major second below what is
// written, so transposition is -2 (sounding = written - 2), matching
// WIND_KINDS.bb in src/app.js:110. Range (written, treble clef) is a
// conservative beginner range, not the instrument's full compass. Curriculum
// not written yet, so status is planned and curriculum is [].
export default {
  id: 'trumpet-bb',
  name: 'Trumpet (B flat)',
  family: 'brass',
  input: 'mic',
  range: { low: 60, high: 72 }, // conservative beginner range, written pitch
  transposition: -2,
  clefs: ['treble'],
  octavePolicy: 'exact',
  status: 'planned',
  curriculum: []
};
