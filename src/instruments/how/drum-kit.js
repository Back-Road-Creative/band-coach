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
// hi-hat's square tab, resting on the top of the hi-hat disc). Circles carry r,
// rectangles carry w and h.
//
// The kit is set up right-handed (the common default): hi-hat on the far
// left, low and nearest you, with its pedal under the left foot; crash behind
// it; the snare, the largest drum, front-left between the knees; the bass
// drum's pedal at centre front; two rack toms side by side above it; the floor
// tom close in on the right; the ride far right and set back. The hi-hat is one
// pair of cymbals but closed, open and pedal are different sounds with
// different GM notes, so it is one disc about crash size (closed), a tab resting on its far edge
// (open) and its footboard (pedal): three pieces to judge, one cymbal to look at. The tab touches the disc, so it
// is the full 24 px phone tap target (a smaller one would need its centre 12 px clear of the disc, and so could not
// touch it), and it sits well clear of the crash so it cannot read as the crash's. The three move as one (kitGroup).
import { PIECES } from '../drum-kit.js';
import { t } from '../../core/i18n.js';
import { applyKitPreset, sanitizeKitPrefs, KIT_ASPECT } from './kit-presets.js';

export { KIT_ASPECT };

const POSITIONS = {
  kick: { x: 0.70, y: 0.725, w: 0.18, h: 0.41, shape: 'pedal' },
  snare: { x: 0.465, y: 0.66, r: 0.135, shape: 'drum' },
  'hihat-closed': { x: 0.15, y: 0.62, r: 0.14, shape: 'cymbal' },
  'hihat-open': { x: 0.15, y: 0.395, w: 0.19, h: 0.19, shape: 'tab' },
  'hihat-pedal': { x: 0.15, y: 0.86, w: 0.15, h: 0.13, shape: 'pedal' },
  'tom-high': { x: 0.57, y: 0.32, r: 0.11, shape: 'drum' },
  'tom-mid': { x: 0.83, y: 0.32, r: 0.11, shape: 'drum' },
  'tom-floor': { x: 1.09, y: 0.66, r: 0.13, shape: 'drum' },
  crash: { x: 0.33, y: 0.14, r: 0.13, shape: 'cymbal' },
  ride: { x: 1.23, y: 0.28, r: 0.16, shape: 'cymbal' }
};

// The decoration at the bottom edge: the throne the player sits on. Not a
// piece, not clickable. Same units as POSITIONS.
export const THRONE = { x: 0.70, y: 0.975, w: 0.18, h: 0.05 };

// Region order in kitRegions(): the open-hi-hat tab first, so pieceAt() returns it before the disc it rests on. Placed pieces may overlap; the nearest centre then wins.
const HIT_ORDER = ['hihat-open', 'hihat-closed', 'hihat-pedal', 'kick', 'snare', 'tom-high', 'tom-mid', 'tom-floor', 'crash', 'ride'];

// Plain-words sentences, one per piece (kit.desc.<id> in the locale tables): where it is and what plays it, for
// a learner who has never sat at a kit. The side words are {left}/{right} params, so a left-handed kit just swaps them.

// The hi-hat is one cymbal on the kit, so its disc, open tab and pedal are placed together: dragging any one moves all three.
const HAT_GROUP = ['hihat-closed', 'hihat-open', 'hihat-pedal'];
export const kitGroup = id => (HAT_GROUP.includes(id) ? [...HAT_GROUP] : [id]);

// One line-drawing per piece, as an SVG path in frame units around a placed piece `p` ({ x, y } plus r or w/h): a rim
// on a drum, a bell on a cymbal, a shell over a footboard on the kick, two cymbals held apart on the open tab and a
// hinged footplate on the hi-hat pedal. The pedal and the open tab are different shapes, never one small square.
export function pieceIcon(id, p) {
  const { x, y } = p, f = n => +n.toFixed(4), pt = (a, b) => f(x + a) + ' ' + f(y + b), ell = (cx, cy, rx, ry) => 'M' + f(cx + rx) + ' ' + f(cy) + 'A' + f(rx) + ' ' + f(ry) + ' 0 1 0 ' + f(cx - rx) + ' ' + f(cy) + 'A' + f(rx) + ' ' + f(ry) + ' 0 1 0 ' + f(cx + rx) + ' ' + f(cy) + 'Z';
  if (id === 'hihat-open') return 'M' + pt(-0.06, -0.035) + 'L' + pt(0, -0.065) + 'L' + pt(0.06, -0.035) + 'M' + pt(-0.06, -0.005) + 'L' + pt(0, -0.025) + 'L' + pt(0.06, -0.005);
  if (id === 'hihat-pedal') return 'M' + pt(-0.055, -0.045) + 'L' + pt(-0.055, -0.005) + 'L' + pt(0.055, -0.005) + 'L' + pt(0.055, -0.03) + 'Z';
  if (id === 'kick') return ell(x, y - p.h * 0.28, p.w * 0.38, p.h * 0.18) + 'M' + pt(-p.w * 0.35, p.h * 0.22) + 'L' + pt(p.w * 0.35, p.h * 0.22) + 'L' + pt(p.w * 0.35, p.h * 0.42) + 'L' + pt(-p.w * 0.35, p.h * 0.42) + 'Z';
  const k = ['crash', 'ride', 'hihat-closed'].includes(id) ? 0.3 : 0.8;
  return ell(x, y, p.r * k, p.r * k);
}

// Every piece's drawn spot, as fresh objects: { id, name, shape, x, y, r } for
// circles, { id, name, shape, x, y, w, h } for rectangles.
export function kitLayout(prefs, requiredPieces = []) {
  return applyKitPreset(PIECES.map(p => ({ id: p.id, name: p.name, ...POSITIONS[p.id] })), KIT_ASPECT, prefs, requiredPieces);
}

// Screen-reader sentence for a piece id, or null for an unknown id.
export function describeHit(pieceId, prefs) {
  if (!PIECES.some(p => p.id === pieceId)) return null;
  const setup = sanitizeKitPrefs(prefs), sides = setup.leftHanded ? ['right', 'left'] : ['left', 'right'];
  return t(pieceId === 'kick' && setup.preset === 'compact' ? 'kit.desc.kick-compact' : 'kit.desc.' + pieceId, { left: t('kit.side.' + sides[0]), right: t('kit.side.' + sides[1]) });
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
export function kitRegions(box, prefs, requiredPieces = []) {
  const f = kitFrame(box), u = f.h, at = Object.fromEntries(kitLayout(prefs, requiredPieces).map(p => [p.id, p]));
  return HIT_ORDER.filter(id => at[id]).map(id => {
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
export function pieceAt(px, py, box, prefs, requiredPieces = []) {
  let best = null, bestDist = Infinity;
  for (const r of kitRegions(box, prefs, requiredPieces)) {
    const inside = r.kind === 'circle' ? Math.hypot(px - r.cx, py - r.cy) <= r.r : px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
    if (!inside) continue;
    if (r.shape === 'tab') return r.id;
    const d = Math.hypot(px - r.cx, py - r.cy);
    if (d < bestDist) { best = r.id; bestDist = d; }
  }
  return best;
}
