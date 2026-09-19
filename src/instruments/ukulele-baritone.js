// Not in today's MODS. Standard baritone tuning (like the top four guitar
// strings), D3 G3 B3 E4 = [50,55,59,64], already low-to-high. Range extends
// the open strings by an assumed 12 frets, same formula as uke.js -- a
// conservative beginner range. Curriculum not written yet, so status is
// planned and curriculum is [].
export default {
  id: 'ukulele-baritone',
  name: 'Baritone ukulele',
  family: 'fretted',
  input: 'mic',
  range: { low: 50, high: 76 }, // conservative beginner range
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'exact',
  tuning: [50, 55, 59, 64],
  fretted: true,
  status: 'planned',
  curriculum: []
};
