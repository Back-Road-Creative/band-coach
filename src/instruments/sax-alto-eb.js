// Not in today's MODS. E flat alto sax sounds a major sixth below what is
// written, so transposition is -9, matching WIND_KINDS.eb in
// src/app.js:110. Range (written, treble clef) is a conservative beginner
// range, not the instrument's full compass. Curriculum not written yet, so
// status is planned and curriculum is [].
export default {
  id: 'sax-alto-eb',
  name: 'Alto sax (E flat)',
  family: 'wind',
  input: 'mic',
  range: { low: 55, high: 67 }, // conservative beginner range, written pitch
  transposition: -9,
  clefs: ['treble'],
  octavePolicy: 'exact',
  status: 'planned',
  curriculum: []
};
