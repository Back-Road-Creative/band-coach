// Descant (soprano) recorder sounds an octave above how beginner method
// books notate it -- the classic "written middle C, sounds C5" convention,
// the same octave-only display gap double-bass.js documents with its own
// `transposition: -12` (sounding = written - 12). Here it runs the other
// way: sounding = written + 12, so transposition is +12. The OLD range here
// ({ low: 67, high: 79 }, G4-G5) was the WRITTEN B-A-G range mistakenly used
// as the record's `range`; rangeForInstrument (src/audio/range.js) feeds
// range straight to the pitch detector's fmin/fmax against the microphone,
// which hears the real SOUNDING frequency, so range must be sounding pitch
// (matching double-bass.js's own "Range and tuning here are in sounding
// pitch" convention) -- fixed below to 72-86 (C5-D6), the fingering table's
// own values (src/instruments/how/recorder-whistle.js's RECORDER_NOTES).
// octavePolicy stays exact: descant recorder's own range is narrow, and a
// learner playing the right pitch class a whole octave off the fingering
// they were just shown is a fingering they should be told about, not one
// that silently passes.
// Curriculum: B A G first (RECORDER_NOTES' easiest baroque fingering, top
// three notes of the first octave), then the high C D above them, then the
// low E, D, C below G finishing the diatonic run, then the forked-fingering
// F -- see src/app.js's MODS['recorder-descant'].levels for the full order.
export default {
  id: 'recorder-descant',
  name: 'Descant recorder',
  family: 'wind',
  input: 'mic',
  range: { low: 72, high: 86 }, // sounding pitch: C5-D6
  transposition: 12,
  clefs: ['treble'],
  octavePolicy: 'exact',
  status: 'ready',
  provenance: null,
  curriculum: [
    { level: 1, items: ['First three notes: B, A, G'] },
    { level: 2, items: ['Two more, going up: high C and D'] },
    { level: 3, items: ['Going down: E'] },
    { level: 4, items: ['Down to low D and C'] },
    { level: 5, items: ['Moves: two notes'] },
    { level: 6, items: ['The tricky note: F (forked fingering)'] },
    { level: 7, items: ['Long tones: two steady seconds'] },
    { level: 8, items: ['Moves: three notes'] },
    { level: 9, items: ['Five-note runs'] }
  ]
};
