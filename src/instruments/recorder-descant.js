// Not in today's MODS. Descant (soprano) recorder is conventionally notated
// as non-transposing in beginner method books even though it sounds an
// octave above orchestral concert pitch, so transposition is 0 here (as
// specified for this unit). Range (treble clef) is a conservative beginner
// range covering the classic first few recorder notes (B, A, G, ...), not
// the instrument's full compass. Curriculum not written yet, so status is
// planned and curriculum is [].
export default {
  id: 'recorder-descant',
  name: 'Descant recorder',
  family: 'wind',
  input: 'mic',
  range: { low: 67, high: 79 }, // conservative beginner range
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'exact',
  status: 'planned',
  curriculum: []
};
