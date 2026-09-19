// Not in today's MODS. Standard open-G tuning: [67,50,55,59,62]. Modeled in
// PLAYED order, 5th string to 1st (5,4,3,2,1) -- not sorted low-to-high --
// because the 5th string is re-entrant: it rings at G4 (67), higher than the
// three strings next to it (D3=50, G3=55, B3=59), and only the 1st string
// (D4=62) is above it. This mirrors the same re-entrant idea as the
// ukulele's high-G string (see uke.js). Range covers the full tuning plus an
// assumed 12 frets on the main (non-5th) strings -- a conservative beginner
// range. Curriculum not written yet, so status is planned and curriculum is
// [].
export default {
  id: 'banjo-5-string',
  name: '5-string banjo',
  family: 'fretted',
  input: 'mic',
  range: { low: 50, high: 74 }, // conservative beginner range
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'nearest-octave',
  tuning: [67, 50, 55, 59, 62],
  fretted: true,
  status: 'planned',
  curriculum: []
};
