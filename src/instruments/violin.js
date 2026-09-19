// Not in today's MODS. Standard tuning, fifths G3 D4 A4 E5 = [55,62,69,76].
// Range is a conservative beginner range: open G string up to roughly first
// position on the E string, not the instrument's full compass.
// Curriculum not written yet, so status is planned and curriculum is [].
export default {
  id: 'violin',
  name: 'Violin',
  family: 'bowed',
  input: 'mic',
  range: { low: 55, high: 81 }, // conservative beginner range
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'exact',
  tuning: [55, 62, 69, 76],
  fretted: false,
  status: 'planned',
  curriculum: []
};
