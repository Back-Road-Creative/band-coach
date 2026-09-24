// Drum kit: an unpitched percussion record. Each piece of the kit is one
// entry in `kit`, and each piece is heard as one or more MIDI notes taken
// from the General MIDI Level 1 percussion key map (channel 10): a MIDI
// drum pad, e-kit or keyboard in drum mode sends these note numbers, so a
// note arriving on the MIDI input names the drum that was hit. Where GM
// has several notes for one real piece (e.g. 35 "Acoustic Bass Drum" and
// 36 "Bass Drum 1"; 49/57 "Crash Cymbal 1/2" plus 52 "Chinese" and 55
// "Splash" folded into the crash), all of them map to that piece. The
// FIRST note in each list is the piece's canonical note, the one the app
// uses when it sounds that piece itself.
//
// input is 'midi' for now: a drum kit has no pitch for the mic's pitch
// detector (src/audio/yin.js) to lock onto, so telling a snare from a tom
// by ear needs its own onset/timbre work, which comes later. The trainer
// (curriculum, MODS entry, judging) is a later unit too, so this record
// ships status 'planned' with an empty curriculum; what it ships today is
// the drawn kit in the "How to play it" panel (src/instruments/how/drum-kit.js).
//
// `key` is the suggested computer key for each piece when the trainer takes
// the keyboard. The keys are laid out like the kit itself, seen from the
// throne: pieces on the left of the kit sit under the left hand (d closed
// hi-hat, e open hi-hat, r crash), pieces on the right under the right hand
// (j snare, u high tom, i mid tom, k floor tom, o ride), and the two pedals
// on the keys nearest where the feet would be (f bass drum, c hi-hat pedal).
// The keys follow where each piece sits, not which stick hits it.
export const PIECES = [
  { id: 'kick', name: 'Bass drum', midi: [35, 36], key: 'f' },
  { id: 'snare', name: 'Snare', midi: [38, 37, 40], key: 'j' },
  { id: 'hihat-closed', name: 'Hi-hat (closed)', midi: [42], key: 'd' },
  { id: 'hihat-pedal', name: 'Hi-hat (pedal)', midi: [44], key: 'c' },
  { id: 'hihat-open', name: 'Hi-hat (open)', midi: [46], key: 'e' },
  { id: 'tom-floor', name: 'Floor tom', midi: [41, 43], key: 'k' },
  { id: 'tom-mid', name: 'Mid tom', midi: [45, 47], key: 'i' },
  { id: 'tom-high', name: 'High tom', midi: [48, 50], key: 'u' },
  { id: 'crash', name: 'Crash cymbal', midi: [49, 52, 55, 57], key: 'r' },
  { id: 'ride', name: 'Ride cymbal', midi: [51, 53, 59], key: 'o' }
];

// The piece id a MIDI note belongs to, or null when that note is not one of
// this kit's pieces (e.g. 39, GM hand clap). schema.js guarantees a note
// belongs to at most one piece.
export function pieceForMidi(midi) {
  const piece = PIECES.find(p => p.midi.includes(midi));
  return piece ? piece.id : null;
}

// The note the app plays for a piece (first in its list), or null.
export function canonicalMidi(pieceId) {
  const piece = PIECES.find(p => p.id === pieceId);
  return piece ? piece.midi[0] : null;
}

export default {
  id: 'drum-kit',
  name: 'Drum kit',
  family: 'percussion',
  input: 'midi',
  range: { low: 35, high: 59 },
  transposition: 0,
  clefs: ['percussion'],
  octavePolicy: 'exact',
  status: 'planned',
  provenance: null,
  curriculum: [],
  kit: PIECES
};
