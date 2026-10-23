// Saved layout choices are shared by the canvas, reference diagrams and hit tests.
import { PIECES } from '../drum-kit.js';

export function sanitizeKitPrefs(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const hidden = Array.isArray(p.hiddenPieces) ? p.hiddenPieces : [];
  return {
    preset: p.preset === 'compact' ? 'compact' : 'standard',
    leftHanded: p.leftHanded === true,
    hiddenPieces: [...new Set(hidden.filter(id => PIECES.some(p => p.id === id)))]
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
    const placed = { ...p, ...(prefs.preset === 'compact' ? COMPACT[p.id] : {}) };
    return { ...placed, x: prefs.leftHanded ? aspect - placed.x : placed.x };
  });
}
