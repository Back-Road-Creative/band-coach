// Saved layout choices are shared by the canvas, reference diagrams and hit tests.
import { PIECES, pieceForMidi, canonicalMidi } from '../drum-kit.js';

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

// Learned MIDI maps (K3): { [deviceName]: { [note]: pieceId } }, one map per MIDI device so a second kit never inherits the first one's pads.
const MAX_LEARNED_DEVICES = 8;
const MAX_DEVICE_NAME = 80;
const isNote = n => Number.isInteger(n) && n >= 0 && n <= 127;
export const deviceKey = name => (typeof name === 'string' ? name.trim().slice(0, MAX_DEVICE_NAME) : '');
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function sanitizeMidiMaps(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const name of Object.keys(raw)) {
    const key = deviceKey(name), src = raw[name];
    if (!key || key === '__proto__' || has(out, key) || Object.keys(out).length >= MAX_LEARNED_DEVICES) continue;
    if (!src || typeof src !== 'object' || Array.isArray(src)) continue;
    const map = {};
    for (const n of Object.keys(src)) if (/^\d{1,3}$/.test(n) && isNote(Number(n)) && PIECES.some(p => p.id === src[n])) map[n] = src[n];
    if (Object.keys(map).length) out[key] = map;
  }
  return out;
}

// Per device, beside the learned map. `hatShared`: { [device]: note } where the closed and open hi-hat were taught the same note on purpose (the map holds that note under one of them, so the share is saved here; it is dropped when that note no longer belongs to a hi-hat piece). `cc4Only`: { [device]: true } for a hi-hat pedal that sends only CC4, never a note; with it unset a device's CC4 is never read as a hit, because many pedals send CC4 and a note together.
function sanitizeDeviceFlags(raw, midiMaps, valid) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const name of Object.keys(raw)) {
    const key = deviceKey(name);
    if (!key || key === '__proto__' || has(out, key) || Object.keys(out).length >= MAX_LEARNED_DEVICES) continue;
    if (valid(raw[name], midiMaps[key])) out[key] = raw[name];
  }
  return out;
}
const sanitizeHatShared = (raw, midiMaps) => sanitizeDeviceFlags(raw, midiMaps, (note, map) => isNote(note) && !!map && hatPartner(map[note]) !== null);
const sanitizeCc4Only = (raw, midiMaps) => sanitizeDeviceFlags(raw, midiMaps, v => v === true);
// The note a device's closed and open hi-hat share, or null; and whether its pedal is CC4-only.
export const hatSharedNote = (rawKit, device) => { const m = rawKit && typeof rawKit === 'object' ? rawKit.hatShared : null, key = deviceKey(device); return m && typeof m === 'object' && key && has(m, key) && isNote(m[key]) ? m[key] : null; };
export const pedalCc4Only = (rawKit, device) => { const m = rawKit && typeof rawKit === 'object' ? rawKit.cc4Only : null, key = deviceKey(device); return !!(m && typeof m === 'object' && key && has(m, key) && m[key] === true); };

// The other half of the one pair of pieces that may deliberately share a note (many e-kits send one note for the hi-hat whatever its pedal does), or null.
export const hatPartner = id => (id === 'hihat-closed' ? 'hihat-open' : id === 'hihat-open' ? 'hihat-closed' : null);

// `map` with `pieceId` now heard on `note`: the piece's earlier note and any other piece that owned this note are dropped, so a note names one piece and a pad one note. With `shareHat`, a note already owned by the other hi-hat piece is kept by that owner (a note names one piece, so the newcomer has no entry of its own and the shared note plays as the owner); nothing else may share.
export function learnPad(map, pieceId, note, { shareHat = false } = {}) {
  const next = {};
  if (map && typeof map === 'object') for (const n of Object.keys(map)) if (isNote(Number(n)) && PIECES.some(p => p.id === map[n])) next[n] = map[n];
  if (!PIECES.some(p => p.id === pieceId) || !isNote(note)) return next;
  const shares = shareHat && has(next, note) && next[note] === hatPartner(pieceId);
  for (const n of Object.keys(next)) if (next[n] === pieceId || (!shares && Number(n) === note)) delete next[n];
  if (!shares) next[note] = pieceId;
  return next;
}

// The learned map for one device, or undefined (an unknown device keeps GM).
function kitMapFor(rawKit, device) {
  const maps = rawKit && typeof rawKit === 'object' ? rawKit.midiMaps : null, key = deviceKey(device);
  return maps && typeof maps === 'object' && key && has(maps, key) ? maps[key] : undefined;
}

// A note from `device`, read through its learned map: a learned note comes back as the General MIDI note of the piece it was taught as, so the trainer, the Songs drum practice and the reference all hear the piece without knowing about maps. Anything else comes back unchanged.
export function kitNoteFor(rawKit, device, note) {
  const map = kitMapFor(rawKit, device);
  if (!map || !has(map, note)) return note;
  const piece = pieceForMidi(note, map);
  return piece ? canonicalMidi(piece) : note;
}

export function sanitizeKitPrefs(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const hidden = Array.isArray(p.hiddenPieces) ? p.hiddenPieces : [];
  const placements = sanitizePlacements(p.placements), midiMaps = sanitizeMidiMaps(p.midiMaps), hatShared = sanitizeHatShared(p.hatShared, midiMaps), cc4Only = sanitizeCc4Only(p.cc4Only, midiMaps);
  return {
    preset: p.preset === 'compact' ? 'compact' : 'standard',
    leftHanded: p.leftHanded === true,
    hiddenPieces: [...new Set(hidden.filter(id => PIECES.some(p => p.id === id)))],
    ...(Object.keys(placements).length ? { placements } : {}),
    ...(Object.keys(midiMaps).length ? { midiMaps } : {}),
    ...(Object.keys(hatShared).length ? { hatShared } : {}),
    ...(Object.keys(cc4Only).length ? { cc4Only } : {})
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
