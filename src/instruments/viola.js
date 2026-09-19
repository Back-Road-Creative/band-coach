// Not in today's MODS. Standard tuning, fifths C3 G3 D4 A4 = [48,55,62,69].
// Range is a conservative beginner range around first position.
// Curriculum not written yet, so status is planned and curriculum is [].
export default {
  id: 'viola',
  name: 'Viola',
  family: 'bowed',
  input: 'mic',
  range: { low: 48, high: 74 }, // conservative beginner range
  transposition: 0,
  clefs: ['alto'],
  octavePolicy: 'exact',
  tuning: [48, 55, 62, 69],
  status: 'planned',
  curriculum: []
};
