// Not in today's MODS. Standard tuning, fifths G3 D4 A4 E5 = [55,62,69,76]
// (courses in unison pairs, modeled here as one pitch per course like the
// app's guitar/bass/uke records). Range extends the open strings by an
// assumed 12 frets, same formula as gtr.js/bass.js -- a conservative
// beginner range, not the instrument's full compass. Curriculum not written
// yet, so status is planned and curriculum is [].
export default {
  id: 'mandolin',
  name: 'Mandolin',
  family: 'fretted',
  input: 'mic',
  range: { low: 55, high: 88 }, // conservative beginner range
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'nearest-octave',
  tuning: [55, 62, 69, 76],
  fretted: true,
  status: 'planned',
  curriculum: []
};
