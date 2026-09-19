// Not in today's MODS. Standard orchestral tuning, fourths E1 A1 D2 G2 =
// [28,33,38,43] (sounding pitch). Double bass sounds an octave below what is
// written on the bass-clef staff, so transposition is -12 (sounding = written
// - 12). Range and tuning here are in sounding pitch, matching the app's
// convention for gtr/bass. Range is a conservative beginner range around
// first position. Curriculum not written yet, so status is planned and
// curriculum is [].
export default {
  id: 'double-bass',
  name: 'Double bass',
  family: 'bowed',
  input: 'mic',
  range: { low: 28, high: 48 }, // conservative beginner range
  transposition: -12,
  clefs: ['bass'],
  octavePolicy: 'exact',
  tuning: [28, 33, 38, 43],
  fretted: false,
  status: 'planned',
  curriculum: []
};
