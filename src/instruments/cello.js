// Not in today's MODS. Standard tuning, fifths C2 G2 D3 A3 = [36,43,50,57]
// (an octave below viola). Range is a conservative beginner range around
// first position. Curriculum not written yet, so status is planned and
// curriculum is [].
export default {
  id: 'cello',
  name: 'Cello',
  family: 'bowed',
  input: 'mic',
  range: { low: 36, high: 62 }, // conservative beginner range
  transposition: 0,
  clefs: ['bass'],
  octavePolicy: 'exact',
  tuning: [36, 43, 50, 57],
  fretted: false,
  status: 'planned',
  curriculum: []
};
