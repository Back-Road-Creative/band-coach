// F13 (range half): a small MIDI keyboard (25, 32, 37, 49 keys) cannot play a note outside its range, so a lesson
// asking for one is unplayable. The learner plays their lowest, then their highest key; the range is kept per
// keyboard (by the name it reports) and keyboard lessons are moved by whole octaves to sit inside it.
// Pure: no DOM, no storage, no clock. The caller owns the notes and where the range is kept.
export const MIN_SPAN = 12; // a span under an octave is a mis-press, not a keyboard

export function startCapture() { return { step: 'low' }; }

// Feed one incoming note-on. Returns the next state (the same object when the event is ignored):
// { step: 'low' } -> { step: 'high', low } -> { step: 'done', range }. A refused highest key keeps step 'high' and adds `reason`.
export function captureNote(state, note, velocity) {
  if (!state || !Number.isInteger(note) || note < 0 || note > 127) return state;
  if (velocity !== undefined && !(velocity > 0)) return state; // velocity 0 is a note-off sent as a note-on
  if (state.step === 'low') return { step: 'high', low: note };
  if (state.step !== 'high') return state;
  if (note <= state.low) return { step: 'high', low: state.low, reason: 'not-higher' };
  if (note - state.low < MIN_SPAN) return { step: 'high', low: state.low, reason: 'too-narrow' };
  return { step: 'done', range: { low: state.low, high: note } };
}

export const rangeKeys = range => range.high - range.low + 1;

export function sanitizeRange(r) {
  if (!r || typeof r !== 'object' || !Number.isFinite(r.low) || !Number.isFinite(r.high)) return null;
  const low = Math.round(r.low), high = Math.round(r.high);
  return low >= 0 && high <= 127 && low < high ? { low: low, high: high } : null;
}

// { deviceName: {low, high} }; anything unreadable is dropped, so a stale or hand-edited backup can never break a lesson.
export function sanitizeRanges(o) {
  const out = {}; if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
  Object.keys(o).slice(0, 32).forEach(k => { const r = sanitizeRange(o[k]); if (k && k !== '__proto__' && k.length <= 120 && r) out[k] = r; });
  return out;
}

// Keep a lesson's notes inside [low, high]: shift the whole phrase by whole octaves (fewest first) if that fits it,
// otherwise leave it as it is and say so. No usable range -> never changes a note.
export function fitToRange(notes, range) {
  const r = sanitizeRange(range);
  if (!r || !notes.length) return { notes: notes, fits: true, shift: 0 };
  const lo = Math.min(...notes), hi = Math.max(...notes);
  if (hi - lo > r.high - r.low) return { notes: notes, fits: false, shift: 0 };
  for (let k = 0, n = 11; k <= n; k++) for (const sgn of k ? [-1, 1] : [1]) {
    const s = sgn * k * 12; if (lo + s >= r.low && hi + s <= r.high) return s ? { notes: notes.map(m => m + s), fits: true, shift: s } : { notes: notes, fits: true, shift: 0 };
  }
  return { notes: notes, fits: false, shift: 0 };
}
