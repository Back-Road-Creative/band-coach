// Not in today's MODS. B flat tenor sax sounds a major ninth (an octave plus
// a major second) below what is written, so transposition is -14, matching
// WIND_KINDS.bbt in src/app.js:110. Range (written, treble clef) is a
// conservative beginner range, not the instrument's full compass. Curriculum
// not written yet, so status is planned and curriculum is [].
export default {
  id: 'sax-tenor-bb',
  name: 'Tenor sax (B flat)',
  family: 'wind',
  input: 'mic',
  range: { low: 55, high: 67 }, // conservative beginner range, written pitch
  transposition: -14,
  clefs: ['treble'],
  octavePolicy: 'exact',
  status: 'planned',
  curriculum: []
};
