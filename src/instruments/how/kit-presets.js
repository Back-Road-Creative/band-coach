// Saved layout choices are shared by the canvas, reference diagrams and hit tests.
import { PIECES } from '../drum-kit.js';

// The kit frame is KIT_ASPECT wide and 1 tall (see how/drum-kit.js); a dragged piece's centre must stay inside it.
export const KIT_ASPECT = 1.4;
export const PLACE_SCALE = { min: 0.8, max: 1.6 };

// Dragged pieces: { [pieceId]: { x, y, scale } } in the right-handed frame (the mirror is applied after). An entry with an unknown id or a centre outside the frame is dropped; scale is clamped.
function sanitizePlacements(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const r3 = n => Math.round(n * 1000) / 1000;
  for (const piece of PIECES) {
    const v = Object.prototype.hasOwnProperty.call(raw, piece.id) ? raw[piece.id] : null;
    if (!v || typeof v !== 'object' || !Number.isFinite(v.x) || !Number.isFinite(v.y) || v.x < 0 || v.x > KIT_ASPECT || v.y < 0 || v.y > 1) continue;
    out[piece.id] = { x: r3(v.x), y: r3(v.y), scale: r3(Number.isFinite(v.scale) ? Math.min(PLACE_SCALE.max, Math.max(PLACE_SCALE.min, v.scale)) : 1) };
  }
  return out;
}

export function sanitizeKitPrefs(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const hidden = Array.isArray(p.hiddenPieces) ? p.hiddenPieces : [];
  const placements = sanitizePlacements(p.placements);
  return {
    preset: p.preset === 'compact' ? 'compact' : 'standard',
    leftHanded: p.leftHanded === true,
    hiddenPieces: [...new Set(hidden.filter(id => PIECES.some(p => p.id === id)))],
    ...(Object.keys(placements).length ? { placements } : {})
  };
}

const COMPACT = {
  'tom-high': { x: 0.59, r: 0.10 },
  'tom-mid': { x: 0.81, r: 0.10 },
  kick: { y: 0.77, w: 0.18, h: 0.30 }
};

export function applyKitPreset(layout, aspect, raw, requiredPieces = []) {
  const prefs = sanitizeKitPrefs(raw);
  // A hidden piece reappears when a lesson or reference selects it: never
  // ask the learner to click an invisible target or silently change a beat.
  return layout.filter(p => !prefs.hiddenPieces.includes(p.id) || requiredPieces.includes(p.id)).map(p => {
    const placed = { ...p, ...(prefs.preset === 'compact' ? COMPACT[p.id] : {}) }, pl = prefs.placements && prefs.placements[p.id];
    if (pl) { placed.x = pl.x; placed.y = pl.y; for (const k of ['r', 'w', 'h']) if (placed[k] !== undefined) placed[k] *= pl.scale; }
    return { ...placed, x: prefs.leftHanded ? aspect - placed.x : placed.x };
  });
}
