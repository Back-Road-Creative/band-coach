// Drum kit "how to play it" -- where each piece of a standard five-piece kit
// sits, seen from above with the player on the throne at the bottom edge.
// Pure data and functions; no DOM, so the fingerings panel draws it and a
// later trainer can hit-test clicks against the same numbers.
//
// Coordinates live in the unit square: x runs 0 (player's left) to 1
// (player's right), y runs 0 (far side of the kit) to 1 (the throne), the
// same direction SVG's y axis runs. `r` is each piece's drawn radius in the
// same units. `shape` is 'drum', 'cymbal' (drawn as a thin ring) or 'pedal'.
//
// The kit is set up right-handed (the common default): hi-hat and crash on
// the left, ride and floor tom on the right, bass drum pedal under the right
// foot, hi-hat pedal under the left. The hi-hat is one pair of cymbals, but
// closed and open are different sounds with different GM notes, so each is
// drawn as its own spot on the left (closed nearer the player, open just
// beyond it) and the pedal gets its own spot by the left foot.
import { PIECES } from '../drum-kit.js';

const POSITIONS = {
  kick: { x: 0.50, y: 0.78, r: 0.14, shape: 'drum' },
  snare: { x: 0.33, y: 0.62, r: 0.10, shape: 'drum' },
  'hihat-closed': { x: 0.13, y: 0.52, r: 0.09, shape: 'cymbal' },
  'hihat-open': { x: 0.13, y: 0.33, r: 0.08, shape: 'cymbal' },
  'hihat-pedal': { x: 0.20, y: 0.88, r: 0.06, shape: 'pedal' },
  'tom-high': { x: 0.40, y: 0.38, r: 0.08, shape: 'drum' },
  'tom-mid': { x: 0.58, y: 0.36, r: 0.08, shape: 'drum' },
  'tom-floor': { x: 0.74, y: 0.62, r: 0.11, shape: 'drum' },
  crash: { x: 0.22, y: 0.14, r: 0.11, shape: 'cymbal' },
  ride: { x: 0.80, y: 0.20, r: 0.12, shape: 'cymbal' }
};

// Plain-words sentences, one per piece: where it is and what plays it, for
// a learner who has never sat at a kit.
const DESCRIPTIONS = {
  kick: 'Bass drum: the big drum on the floor in front of you, played with your right foot on its pedal.',
  snare: 'Snare drum: the drum between your knees, just left of centre; in a basic beat the left stick plays it while the right stick crosses over to the hi-hat.',
  'hihat-closed': 'Hi-hat, closed: the pair of cymbals on your left, held shut with your left foot down on the pedal; tap the top cymbal with a stick (the right stick crosses over in a basic beat).',
  'hihat-open': 'Hi-hat, open: the same pair of cymbals on your left, with your left foot eased up off the pedal so they ring apart; hit the top cymbal with a stick.',
  'hihat-pedal': 'Hi-hat pedal: press the pedal by your left foot to clap the two hi-hat cymbals together, no stick needed.',
  'tom-high': 'High tom: the smaller drum mounted above the bass drum, on the left; hit it with either stick.',
  'tom-mid': 'Mid tom: the drum mounted above the bass drum, on the right; hit it with either stick.',
  'tom-floor': 'Floor tom: the big drum standing on its own legs to your right; hit it with the right stick.',
  crash: 'Crash cymbal: the cymbal up high on your left; strike its edge with a stick for a loud splash, often on the first beat of a new section.',
  ride: 'Ride cymbal: the large cymbal on your right; tap it with the right stick to keep a steady beat.'
};

// Every piece's drawn spot, as fresh objects: { id, name, x, y, r, shape }.
export function kitLayout() {
  return PIECES.map(p => ({ id: p.id, name: p.name, ...POSITIONS[p.id] }));
}

// Screen-reader sentence for a piece id, or null for an unknown id.
export function describeHit(pieceId) {
  return Object.prototype.hasOwnProperty.call(DESCRIPTIONS, pieceId) ? DESCRIPTIONS[pieceId] : null;
}

// The piece whose drawn circle contains (x, y), the nearest centre winning
// where two touch, or null for empty space.
export function pieceAt(x, y) {
  let best = null;
  let bestDist = Infinity;
  for (const p of kitLayout()) {
    const d = Math.hypot(x - p.x, y - p.y);
    if (d <= p.r && d < bestDist) { best = p.id; bestDist = d; }
  }
  return best;
}
