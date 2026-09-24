// One reader for a learner's saved instrument setup — the capo, alternate
// tuning and left-handed flag fingerings.js remembers per instrument, plus
// what Songs needs to arrange a song the same way this instrument is set
// up today: the effective tuning as MIDI pitches, the saved harmonica key
// and any voice range found by the range test. Zero DOM; pure functions;
// caller owns api.store('fingerings') and DB.prefs.
//
// Moved unchanged from src/ui/fingerings.js's loadStore/rememberedFor
// (P4-5) so Songs can read the same rules without importing the panel.

import { alternateTuningsFor } from './how.js';
import { tuningFor } from '../../instruments/how/fretboard.js';

// Validates a raw fingerings store value (api.store('fingerings').get(),
// or already-decoded JSON) against what THIS instrument currently allows —
// a corrupt or hand-edited blob, an instrument swap that no longer offers
// a saved alternate tuning, or a capo out of range must never throw and
// never resurrect a value that doesn't make sense for this instrument.
export function readFingeringSetup(storeValue, instrument) {
  const store = storeValue && typeof storeValue === 'object' && storeValue.byInstrument && typeof storeValue.byInstrument === 'object'
    ? storeValue
    : { byInstrument: {} };
  const entry = instrument && store.byInstrument[instrument.id];
  if (!entry || typeof entry !== 'object') return { capo: 0, tuning: null, leftHanded: false };
  const alts = alternateTuningsFor(instrument);
  const validCapo = Number.isInteger(entry.capo) && entry.capo >= 0 && entry.capo <= 11 ? entry.capo : 0;
  const validTuning = alts && typeof entry.tuning === 'string' && alts.includes(entry.tuning) ? entry.tuning : null;
  const validLeftHanded = typeof entry.leftHanded === 'boolean' ? entry.leftHanded : false;
  return { capo: validCapo, tuning: validTuning, leftHanded: validLeftHanded };
}

// Same validation app.js's sanitizeDB applies to DB.prefs.voiceRange
// (app.js's sanitizeDB, "voiceRange"): a range must be two finite numbers
// with low below high, clamped to a playable MIDI span (24-96) so a
// corrupt or hand-edited backup never hands Songs an unplayable range.
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function readVoiceRange(prefs) {
  const r = prefs && prefs.voiceRange;
  if (!r || typeof r !== 'object' || !Number.isFinite(r.low) || !Number.isFinite(r.high) || !(r.low < r.high)) return null;
  return { low: clamp(Math.round(r.low), 24, 96), high: clamp(Math.round(r.high), 24, 96) };
}

// Same validation app.js's sanitizeDB applies to DB.prefs.harpKey: an
// integer 0-11, anything else defaults to key of C (0).
function readHarpKey(prefs) {
  return (prefs && Number.isInteger(prefs.harpKey) && prefs.harpKey >= 0 && prefs.harpKey <= 11) ? prefs.harpKey : 0;
}

// The full picture Songs needs for one instrument: the saved capo/tuning/
// left-handed setup (above), the effective tuning as MIDI pitches
// (fretboard.js's tuningFor for a validated alternate, else the
// instrument's own factory tuning, or null for an instrument with none),
// the learner's saved harmonica key, and any voice range found by the
// range test — read straight from prefs since neither is per-instrument.
export function instrumentSetup(instrument, { fingeringsStore, prefs } = {}) {
  let raw = null;
  try { raw = fingeringsStore && typeof fingeringsStore.get === 'function' ? fingeringsStore.get() : fingeringsStore; } catch (e) { raw = null; }
  const setup = readFingeringSetup(raw, instrument);
  // setup.tuning only ever holds a key readFingeringSetup already checked
  // against alternateTuningsFor(instrument), so tuningFor(setup.tuning)
  // here can never hit its "unknown tuning" throw.
  const tuningMidi = setup.tuning ? tuningFor(setup.tuning) : (instrument && Array.isArray(instrument.tuning) ? instrument.tuning : null);
  return Object.assign({}, setup, {
    tuningMidi: tuningMidi,
    harpKey: readHarpKey(prefs),
    voiceRange: readVoiceRange(prefs)
  });
}
