// Turns a practice-item id (the keys of a model's `item` map, see
// src/app.js `it(id)`/`info()`) into a short, plain-words label — but only
// for the id shapes that carry everything needed to name themselves. Some
// shapes ('s<string>f<fret>', 'w<written>', 'v<degree>') need per-instrument
// context (a tuning, a transposing instrument's key, a voice's chosen
// range) that this pure module is never given, so they are left for the
// caller to show as a raw code instead. Pure, no DOM.
//
// Note-name spelling routes through src/core/note-names.js, the same module
// src/app.js's own `nname()` uses (see setNoteNaming there), so a keyboard
// item here always reads the same as it does in the trainer, in whichever
// naming system/accidentals the learner picked.
import { name as noteNameFor } from '../../core/note-names.js';
const pc = (m) => ((Math.round(m) % 12) + 12) % 12;
const nname = (m) => noteNameFor(m, true);

/**
 * Returns a short plain-words label for `id`, or null when this module has
 * no context-free way to name that shape (the caller should fall back to
 * showing the raw id).
 */
export function itemLabel(id) {
  if (typeof id !== 'string' || id.length < 2) return null;
  const k = id[0];
  const rest = id.slice(1);
  if (k === 'n' && /^\d{1,3}$/.test(rest)) return nname(+rest);
  if (k === 'p' && /^\d{1,2}$/.test(rest)) { const p = +rest; return p >= 0 && p < 12 ? noteNameFor(p, false) + ' (any octave)' : null; }
  if (k === 'h') {
    const m = /^([bd])(\d{1,2})$/.exec(rest);
    if (!m) return null;
    return (m[1] === 'b' ? 'Blow hole ' : 'Draw hole ') + m[2];
  }
  return null;
}
