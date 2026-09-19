// Not in today's MODS. Standard 5-string tuning, adding a low B below
// bass.js's EADG: B0 E1 A1 D2 G2 = [23,28,33,38,43], already low-to-high.
// Range extends the open strings by an assumed 12 frets, same formula as
// bass.js -- a conservative beginner range. Curriculum not written yet, so
// status is planned and curriculum is [].
export default {
  id: 'bass-5-string',
  name: '5-string bass',
  family: 'fretted',
  input: 'mic',
  range: { low: 23, high: 55 }, // conservative beginner range
  transposition: 0,
  clefs: ['bass'],
  octavePolicy: 'nearest-octave',
  tuning: [23, 28, 33, 38, 43],
  fretted: true,
  status: 'planned',
  curriculum: []
};
