// Extracted from src/app.js MODS.voice (app.js:80-85). Items are scale degrees
// (0-12 semitones) added to a movable tonic chosen from VOICE_KINDS (app.js:111:
// low Do=C3/48, mid Do=G3/55, high Do=C4/60). Range spans the lowest tonic plus
// degree 0 (48) to the highest tonic plus the top degree, 12 (60+12=72). The help
// text at app.js:80 says "Any octave counts, so sing where it is comfortable",
// which is why octavePolicy is nearest-octave rather than exact.
export default {
  id: 'voice',
  name: 'Voice',
  family: 'voice',
  input: 'mic',
  range: { low: 48, high: 72 },
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'nearest-octave',
  status: 'ready',
  provenance: null,
  curriculum: [
    { level: 1, items: ['Match a note: Do, Re, Mi'] },
    { level: 2, items: ['Add Fa and Sol'] },
    { level: 3, items: ['Add La, Ti and high Do'] },
    { level: 4, items: ['From Do only: find the note yourself'] },
    { level: 5, items: ['Two notes in a row'] },
    { level: 6, items: ['Long tones: hold it steady for two seconds'] },
    { level: 7, items: ['Three notes in a row'] },
    { level: 8, items: ['The notes in between'] }
  ]
};
