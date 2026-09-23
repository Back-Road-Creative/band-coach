// Pure note-naming module: turns a MIDI pitch (or bare pitch class 0-11)
// into a display name under one of three "systems" (letters / german /
// fixed-do solfege), each spellable with sharps, flats, or the mixed
// spelling the app has always used. No DOM, no AudioContext -- caller owns
// everything, including which pref is "current" (see setNoteNaming below).
//
// Table shape mirrors src/app.js's own NAMES exactly for 'letters'+'mixed',
// so the app's default output is byte-identical to before this module
// existed: C C♯ D E♭ E F F♯ G A♭ A B♭ B.
export const LETTERS_SHARPS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const LETTERS_FLATS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
export const LETTERS_MIXED = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

// Fixed-do solfege: Do Re Mi Fa Sol La Si (not the movable-do "Ti" used
// elsewhere in the app for scale degrees -- that is a different concept,
// see src/app.js's SOLFA map, and stays untouched by this pref).
const SOLFEGE_SHARPS = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const SOLFEGE_FLATS = ['Do', 'Re♭', 'Re', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];
const SOLFEGE_MIXED = ['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];

const SYSTEMS = ['letters', 'german', 'solfege'];
const ACCIDENTALS = ['mixed', 'sharps', 'flats'];

function lettersTable(accidentals) { return accidentals === 'sharps' ? LETTERS_SHARPS : accidentals === 'flats' ? LETTERS_FLATS : LETTERS_MIXED; }
function solfegeTable(accidentals) { return accidentals === 'sharps' ? SOLFEGE_SHARPS : accidentals === 'flats' ? SOLFEGE_FLATS : SOLFEGE_MIXED; }

// German naming reuses the letters table for every pitch class except B:
// the natural (pc 11) is "H", and whatever spells pc 10 with a flat "B"
// (mixed and flats accidentals) is relabelled plain "B" -- German has no
// letter B-flat, it just calls that note B.
function germanTable(accidentals) {
  const t = lettersTable(accidentals).slice();
  t[11] = 'H';
  if (t[10] === 'B♭') t[10] = 'B';
  return t;
}

function tableFor(system, accidentals) {
  if (system === 'solfege') return solfegeTable(accidentals);
  if (system === 'german') return germanTable(accidentals);
  return lettersTable(accidentals);
}

// nameFor(midiOrPc, { system, accidentals, octave }) -- pure, stateless.
export function nameFor(midiOrPc, opts) {
  const o = opts || {};
  const system = SYSTEMS.indexOf(o.system) >= 0 ? o.system : 'letters';
  const accidentals = ACCIDENTALS.indexOf(o.accidentals) >= 0 ? o.accidentals : 'mixed';
  const pc = ((Math.round(midiOrPc) % 12) + 12) % 12;
  const table = tableFor(system, accidentals);
  return table[pc] + (o.octave ? (Math.floor(midiOrPc / 12) - 1) : '');
}

export const DEFAULT_NOTE_NAMING = { system: 'letters', accidentals: 'mixed' };

// Module-level "current pref" -- a shared singleton across every importer
// (src/app.js, src/ui/fingerings/notes.js, src/ui/history/item-label.js all
// import this same module instance), so one setNoteNaming() call on load,
// on backup restore, or on the options control's change event keeps every
// note name in the app in sync without threading the pref through every
// call site by hand.
let current = Object.assign({}, DEFAULT_NOTE_NAMING);

export function setNoteNaming(pref) {
  const system = pref && SYSTEMS.indexOf(pref.system) >= 0 ? pref.system : 'letters';
  const accidentals = pref && ACCIDENTALS.indexOf(pref.accidentals) >= 0 ? pref.accidentals : 'mixed';
  current = { system: system, accidentals: accidentals };
}

export function getNoteNaming() { return current; }

// Convenience wrapper reading the current pref -- what nname()/noteName()/
// itemLabel() actually call.
export function name(midiOrPc, octave) {
  return nameFor(midiOrPc, { system: current.system, accidentals: current.accidentals, octave: !!octave });
}

export function sanitizeNoteNaming(v) {
  const p = (v && typeof v === 'object') ? v : {};
  return { system: SYSTEMS.indexOf(p.system) >= 0 ? p.system : 'letters', accidentals: ACCIDENTALS.indexOf(p.accidentals) >= 0 ? p.accidentals : 'mixed' };
}
