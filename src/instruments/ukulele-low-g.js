// Not in today's MODS. Same standard-ukulele pitches as uke.js (G3 C4 E4 A4)
// but with a low, non-re-entrant G string, so the tuning IS already
// low-to-high: [55,60,64,69]. Range extends the open strings by an assumed
// 12 frets, same formula as uke.js -- a conservative beginner range.
// Curriculum not written yet, so status is planned and curriculum is [].
export default {
  id: 'ukulele-low-g',
  name: 'Low-G ukulele',
  family: 'fretted',
  input: 'mic',
  range: { low: 55, high: 81 }, // conservative beginner range
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'nearest-octave',
  tuning: [55, 60, 64, 69],
  fretted: true,
  status: 'planned',
  curriculum: []
};
