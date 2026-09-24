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
// input is 'mic+midi': a drum kit has no pitch for the mic's pitch detector
// (src/audio/yin.js) to lock onto, so the mic path (src/app.js's onset
// detector plus src/audio/drum-classify.js) hears an onset and its
// band-energy shape rather than a note. That only tells kick, snare and
// hi-hat apart -- toms, crash and ride come back as "a hit, unknown drum"
// (piece null) -- so a level whose bars need those pieces is judged
// leniently on a mic hit rather than pretending the mic can name them (see
// src/app.js's onHit/tickKitBar). The trainer (MODS['drum-kit'] in
// src/app.js) takes a MIDI kit, the computer keys below, a click on the
// drawn kit, or a real kit through the microphone; its levels are
// TRAINER_LEVELS below, and the record's curriculum is derived from them so
// the two never drift.
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

// A kit bar, written as space-separated 'cell:hits' steps: `cell` is a
// src/core/rhythm.js cell id, `hits` names one entry per sounding note of
// that cell, comma-separated. Pieces sounding together join with '+', and
// 'FS' is a flam (two snare hits a hair apart, judged within 40 ms).
const ALIAS = { K: 'kick', S: 'snare', H: 'hihat-closed', P: 'hihat-pedal', O: 'hihat-open', T1: 'tom-high', T2: 'tom-mid', T3: 'tom-floor', C: 'crash', R: 'ride' };
export function kitBar(text, tip) {
  const cells = [], hits = [];
  text.split(' ').forEach(step => {
    const [cell, list] = step.split(':');
    cells.push(cell);
    (list ? list.split(',') : []).forEach(h => {
      const flam = h === 'FS', pieces = (flam ? 'S' : h).split('+').map(a => { if (!ALIAS[a]) throw new Error('unknown drum: ' + a); return ALIAS[a]; });
      hits.push({ pieces, flam });
    });
  });
  return tip ? { cells, hits, tip } : { cells, hits };
}
const ALONE = PIECES.map(p => Object.keys(ALIAS).find(a => ALIAS[a] === p.id));
const L = (name, metre, bpm, bars, swing) => Object.assign({ name, metre, bpm, bars: bars.map(b => typeof b === 'string' ? kitBar(b) : b) }, swing ? { swing } : {});
const ROCK = 'ee:H+K,H ee:H+S,H ee:H+K,H ee:H+S,H';
// The trainer's levels, in teaching order. Stickings (R/L) and accents are
// not judged -- a key, a click or a MIDI note says which drum and when,
// not which hand -- so a rudiment's sticking rides along as a tip.
export const TRAINER_LEVELS = [
  L('One drum at a time', '4/4', 66, ALONE.map(a => Array(4).fill('q:' + a).join(' '))),
  L('Bass drum and snare on the beat', '4/4', 70, ['q:K q:S q:K q:S', 'q:K q:K q:S q:K', 'q:K+H q:S+H q:K+H q:S+H']),
  L('Rock beat: eighths on the hi-hat', '4/4', 72, [ROCK, 'ee:H+K,H ee:H+S,H ee:H+K,H ee:H+S,H+S']),
  L('Bass drum variations', '4/4', 72, ['ee:H+K,H ee:H+S,H ee:H+K,H+K ee:H+S,H', 'ee:H+K,H+K ee:H+S,H ee:H+K,H ee:H+S,H', 'ee:H+K,H ee:H+S,H+K ee:H,H+K ee:H+S,H']),
  L('Fills around the toms', '4/4', 72, ['ee:H+K,H ee:H+S,H ee:T1,T2 ee:T3,T3', 'ee:T1,T1 ee:T2,T2 ee:T3,T3 q:C+K', 'ssss:S,S,T1,T1 ssss:T2,T2,T3,T3 ee:S,S q:C+K']),
  L('Snare rudiments: singles, doubles, paradiddle, flam', '4/4', 60, [kitBar('ee:S,S ee:S,S ee:S,S ee:S,S', 'Single strokes: R L R L.'), kitBar('ssss:S,S,S,S ssss:S,S,S,S q:S q:S', 'Double strokes: R R L L.'), kitBar('ssss:S,S,S,S ssss:S,S,S,S q:S q:S', 'Paradiddle: R L R R, L R L L.'), kitBar('q:FS q:FS q:FS q:FS', 'Flam: a soft grace hit just before the main one, both on the snare.')]),
  L('Three-four time', '3/4', 80, ['q:K+H q:S+H q:S+H', 'ee:K+H,H ee:S+H,H ee:S+H,H']),
  L('Six-eight time', '6/8', 72, ['e3:K+H,H,H e3:S+H,H,H', 'e3:K+H,H,K+H e3:S+H,H,H']),
  L('Swing ride pattern', '4/4', 100, ['q:R ee:R+P,R q:R ee:R+P,R', 'q:R+K ee:R+P+K,R q:R+K ee:R+P+K,R'], 1)
];

export default {
  id: 'drum-kit',
  name: 'Drum kit',
  family: 'percussion',
  input: 'mic+midi',
  range: { low: 35, high: 59 },
  transposition: 0,
  clefs: ['percussion'],
  octavePolicy: 'exact',
  status: 'ready',
  provenance: null,
  curriculum: TRAINER_LEVELS.map((l, i) => ({ level: i + 1, items: [l.name] })),
  kit: PIECES
};
