// Drum kit "how to play it" -- where each piece of a standard five-piece kit
// sits, drawn the way it looks from the throne: the player sits at the bottom
// edge looking at the kit, so the near pieces are low and the far ones high.
// Pure data and functions; no DOM, so the fingerings panel and the trainer's
// canvas draw it and hit-test clicks against the same numbers.
//
// ONE table below holds every position, so a correction is a one-place change.
// Coordinates are in the kit frame, which is KIT_ASPECT wide and 1 tall; x, y,
// r, w and h are all in units of the frame's height, and x/y are the piece's
// centre (x 0 is the player's left, y 0 the far side of the kit). The frame
// keeps its shape (kitFrame letterboxes it into a box) rather than stretching.
//
// `shape` says how a piece is drawn: 'drum' (a head with a rim ring), 'cymbal'
// (a disc with a bell), 'pedal' (a footboard rectangle; the bass drum's rect
// also takes the small shell beyond its footboard) and 'tab' (the open
// hi-hat's small rounded tab on the hi-hat's far edge). Circles carry r,
// rectangles carry w and h.
//
// The kit is set up right-handed (the common default): hi-hat on the far
// left, low and nearest you, with its pedal under the left foot; crash behind
// it; the snare, the largest drum, front-left between the knees; the bass
// drum's pedal at centre front; two rack toms side by side above it; the floor
// tom close in on the right; the ride far right and set back. The hi-hat is one
// pair of cymbals but closed, open and pedal are different sounds with
// different GM notes, so it is one disc (closed), a tab on its far edge (open)
// and its footboard (pedal): three pieces to judge, one cymbal to look at.
import { PIECES } from '../drum-kit.js';

export const KIT_ASPECT = 1.4;

const POSITIONS = {
  kick: { x: 0.70, y: 0.725, w: 0.18, h: 0.41, shape: 'pedal' },
  snare: { x: 0.465, y: 0.66, r: 0.135, shape: 'drum' },
  'hihat-closed': { x: 0.20, y: 0.62, r: 0.115, shape: 'cymbal' },
  'hihat-open': { x: 0.20, y: 0.427, w: 0.19, h: 0.19, shape: 'tab' },
  'hihat-pedal': { x: 0.22, y: 0.84, w: 0.17, h: 0.17, shape: 'pedal' },
  'tom-high': { x: 0.58, y: 0.32, r: 0.11, shape: 'drum' },
  'tom-mid': { x: 0.82, y: 0.32, r: 0.11, shape: 'drum' },
  'tom-floor': { x: 1.09, y: 0.66, r: 0.13, shape: 'drum' },
  crash: { x: 0.32, y: 0.17, r: 0.14, shape: 'cymbal' },
  ride: { x: 1.15, y: 0.28, r: 0.16, shape: 'cymbal' }
};

// The decoration at the bottom edge: the throne the player sits on. Not a
// piece, not clickable. Same units as POSITIONS.
export const THRONE = { x: 0.70, y: 0.975, w: 0.18, h: 0.05 };

// Hit priority: the open-hi-hat tab sits over the closed hi-hat's disc, so it
// is tested first; the rest do not overlap.
const HIT_ORDER = ['hihat-open', 'hihat-closed', 'hihat-pedal', 'kick', 'snare', 'tom-high', 'tom-mid', 'tom-floor', 'crash', 'ride'];

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

// Every piece's drawn spot, as fresh objects: { id, name, shape, x, y, r } for
// circles, { id, name, shape, x, y, w, h } for rectangles.
export function kitLayout() {
  return PIECES.map(p => ({ id: p.id, name: p.name, ...POSITIONS[p.id] }));
}

// Screen-reader sentence for a piece id, or null for an unknown id.
export function describeHit(pieceId) {
  return Object.prototype.hasOwnProperty.call(DESCRIPTIONS, pieceId) ? DESCRIPTIONS[pieceId] : null;
}

// The kit's frame inside a pixel box { x, y, w, h }: as tall as the box lets
// it be, KIT_ASPECT wide per unit of height, centred. A wide box leaves margins
// beside it instead of stretching the kit.
export function kitFrame(box) {
  const h = Math.min(box.h, box.w / KIT_ASPECT), w = h * KIT_ASPECT;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

// Every piece's hit region in canvas pixels, in hit-priority order (the tab
// before the disc it sits on): { id, shape, kind: 'circle', cx, cy, r } or
// { id, shape, kind: 'rect', x, y, w, h, cx, cy }.
export function kitRegions(box) {
  const f = kitFrame(box), u = f.h, at = Object.fromEntries(kitLayout().map(p => [p.id, p]));
  return HIT_ORDER.map(id => {
    const p = at[id], cx = f.x + p.x * u, cy = f.y + p.y * u;
    return p.r !== undefined
      ? { id, shape: p.shape, kind: 'circle', cx, cy, r: p.r * u }
      : { id, shape: p.shape, kind: 'rect', x: cx - p.w * u / 2, y: cy - p.h * u / 2, w: p.w * u, h: p.h * u, cx, cy };
  });
}

// The piece drawn at canvas pixel (px, py) in a box, or null for empty space.
// The first containing region in priority order wins (so the tab beats the
// disc under it); regions otherwise do not overlap, and were two to, the
// nearest centre would win.
export function pieceAt(px, py, box) {
  let best = null, bestDist = Infinity;
  for (const r of kitRegions(box)) {
    const inside = r.kind === 'circle' ? Math.hypot(px - r.cx, py - r.cy) <= r.r : px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
    if (!inside) continue;
    if (r.shape === 'tab') return r.id;
    const d = Math.hypot(px - r.cx, py - r.cy);
    if (d < bestDist) { best = r.id; bestDist = d; }
  }
  return best;
}
