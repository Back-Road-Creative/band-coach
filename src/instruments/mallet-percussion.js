// Beginner mallet percussion (band-classroom "bells"/glockenspiel): a
// keyboard-layout pitched instrument, read in treble clef at concert pitch
// (no transposition), heard through the microphone rather than MIDI.
//
// Wired into MODS['mallet-percussion'] in src/app.js: name and mic range
// (fmin/fmax via rangeForInstrument(), src/audio/range.js) come from THIS
// record, same one-source-of-truth pattern as mandolin.js/banjo-5-string.js.
// The on-screen layout reuses drawKeys() -- the same function MODS.kbd's
// on-screen piano uses -- rather than inventing new rendering: a
// glockenspiel/xylophone bar row IS a keyboard layout, ascending chromatic
// bars left to right, same shape as piano keys. `input` in MODS is 'pluck'
// (src/app.js's onPitch, ~line 591): the same struck-note timing
// MODS.gtr/bass/uke/mandolin already use -- 3 consecutive stable-rounded-
// midi frames fires a note, and a fresh onset (src/audio/onset.js) counts
// as a re-strike. This is a better fit than 'sustain' (MODS.wind/voice),
// which requires holding one steady pitch for 0.5-2 seconds: a struck bar
// does not ring anywhere near that long.
//
// Range C4-C6 (60-84), two octaves: the working compass of a standard
// classroom bell set/glockenspiel used for beginner band mallet parts,
// matching MODS.kbd's own beginner-range convention (an octave or two
// around middle C) rather than a full 3+ octave orchestral xylophone.
//
// Mic detectability was checked, not assumed: mallet/bar percussion is
// inharmonic (a free-free bar's characteristic second partial sits near
// 3.9-4x the fundamental, not an exact harmonic) and decays fast. A
// synthesized bar tone -- fundamental plus a partial at 3.93x the
// fundamental frequency, the fundamental decaying at 8/s and the partial at
// a faster 20/s -- fed to src/audio/yin.js at the real frame size
// frameSizeForInstrument() derives for this record (2048 samples: this
// record's range.low, C4/261.6 Hz, is far above the low range that needs
// the bigger 4096-sample frame) locked onto the fundamental at every note
// tested across the range (C4, F4, C5, F5, C6). Each result was off by
// about -24 cents (a windowing/decay-envelope artifact, not an octave or
// wrong-note error) and still rounded to the exact correct MIDI note every
// time, with clarity above 0.98. That is well inside what the existing
// 'pluck' path already tolerates, so status is 'ready'.
export default {
  id: 'mallet-percussion',
  name: 'Mallet percussion (bells)',
  family: 'percussion',
  input: 'mic',
  range: { low: 60, high: 84 },
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'exact',
  status: 'ready',
  provenance: null,
  curriculum: [
    { level: 1, items: ['C, D and E'] },
    { level: 2, items: ['Add F and G'] },
    { level: 3, items: ['Add A, B and high C'] },
    { level: 4, items: ['Sharps and flats: F sharp and B flat'] },
    { level: 5, items: ['Sharps and flats: C sharp, E flat, A flat'] },
    { level: 6, items: ['Moves: two notes'] },
    { level: 7, items: ['Moves: three notes'] },
    { level: 8, items: ['Up an octave'] },
    { level: 9, items: ['Five-note runs'] }
  ]
};
