// Piano "hands together" exercises: the right hand and the left hand each
// play one note at the same time, each with its own standard finger number
// (1 = thumb ... 5 = little finger). Pure logic, no DOM, no audio, no
// randomness — everything the practice loop needs to know which two notes
// are expected and whether what came back counts.
//
// Material: C-major five-finger position, the standard first "hands
// together" material in beginner method books (Alfred's, Faber). The right
// hand sits thumb-on-C and plays C-D-E-F-G with fingers 1-2-3-4-5; the left
// hand sits little-finger-on-C (an octave below) and plays the same letter
// names with fingers 5-4-3-2-1. Both hands move in parallel motion up the
// position, one letter name at a time, which is exactly how these five-
// finger exercises are introduced. MIDI values are absolute (kbd's
// octavePolicy is 'exact', see src/instruments/kbd.js), matching the
// keyboard mod's own middle-C-is-60 convention (app.js N(60, 62, 64, ...)).
const STEPS = [
  { name: 'C', rh: 60, rf: 1, lh: 48, lf: 5 },
  { name: 'D', rh: 62, rf: 2, lh: 50, lf: 4 },
  { name: 'E', rh: 64, rf: 3, lh: 52, lf: 3 },
  { name: 'F', rh: 65, rf: 4, lh: 53, lf: 2 },
  { name: 'G', rh: 67, rf: 5, lh: 55, lf: 1 }
];

export const HANDS_TOGETHER_EXERCISES = STEPS.map((s, i) => ({
  id: 'j' + (i + 1),
  name: s.name,
  label: s.name + ', both hands together',
  short: s.name + ' (both hands)',
  rh: { midi: s.rh, finger: s.rf },
  lh: { midi: s.lh, finger: s.lf }
}));

// A task/SRS id is 'j<n>' (both-hands mastery, unchanged) or 'j<n>r'/'j<n>l'
// (right-only / left-only practice, its own distinct mastery — see B1(4):
// crediting a mode-suffixed id keeps a right-only pass from ever counting
// towards, or consuming, the shared both-hands item). Any other trailing
// character is not a recognised id.
function parseId(id) {
  if (typeof id !== 'string') return null;
  const m = /^(j\d+)([rl])?$/.exec(id);
  if (!m) return null;
  return { baseId: m[1], mode: m[2] === 'r' ? 'right' : m[2] === 'l' ? 'left' : 'both' };
}

export function handsTogetherById(id) {
  const parsed = parseId(id);
  if (!parsed) return null;
  return HANDS_TOGETHER_EXERCISES.find(e => e.id === parsed.baseId) || null;
}

// The mode a (possibly mode-suffixed) id names, defaulting to 'both' for
// anything that does not parse as one of these ids at all -- callers that
// already validated the id with handsTogetherById() get a real mode back.
export function handsModeFromId(id) {
  const parsed = parseId(id);
  return parsed ? parsed.mode : 'both';
}

export function fingeringLabel(exercise) {
  return 'right hand finger ' + exercise.rh.finger + ', left hand finger ' + exercise.lh.finger;
}

// EXACT grading: independent note-on events, as a real MIDI keyboard (or two
// hands on the computer keys) delivers — more than one pitch can be known at
// the same time. `heldMidis` is every MIDI note the caller currently
// considers "held together" (its own timing window; see the `held` array
// pattern already used for the 'chord' task in src/app.js onNote()). Never
// mutates its input.
//
// `mode` ('both' default | 'right' | 'left'): 'both' requires both hands, as
// always -- byte-for-byte the same result as before this parameter existed.
// 'right'/'left' require only the named hand's note; the OTHER hand's note
// is optional accompaniment -- it is never required and, since it is one of
// exercise.rh.midi/exercise.lh.midi, it is excluded from `wrong` exactly like
// it would be in 'both' mode, so it is never reported as a mistake either.
// Any note that is neither hand's note is still wrong, in every mode.
export function gradeHandsTogetherExact(exercise, heldMidis, mode) {
  mode = mode || 'both';
  const midis = heldMidis || [];
  const rh = midis.includes(exercise.rh.midi);
  const lh = midis.includes(exercise.lh.midi);
  const wrong = midis.filter(m => m !== exercise.rh.midi && m !== exercise.lh.midi);
  const need = mode === 'right' ? rh : mode === 'left' ? lh : rh && lh;
  return { ok: need && wrong.length === 0, rh: rh, lh: lh, wrong: wrong };
}

// APPROXIMATE grading: a single detected pitch, as a monophonic microphone
// pitch detector reports. It can confirm at most ONE of the two notes and
// can never know both sounded together, so this never reports both hands
// correct — only which single hand's note (if either) it heard.
//
// `mode` gets the equivalent 'right'/'left' rule as the exact grader above:
// the OTHER hand's note, heard alone, is optional accompaniment -- not a
// pass (it is not evidence for the hand actually being assessed), but also
// not `wrong` (a caller must not fail the element for it). Only a pitch that
// is neither hand's note is `wrong`. 'both' mode's return shape is untouched
// (no `wrong` field), matching every existing caller.
export function gradeHandsTogetherApprox(exercise, midi, mode) {
  mode = mode || 'both';
  const isRh = midi === exercise.rh.midi, isLh = midi === exercise.lh.midi;
  if (mode === 'right') { if (isRh) return { ok: true, hand: 'rh', wrong: false }; if (isLh) return { ok: false, hand: null, wrong: false }; return { ok: false, hand: null, wrong: true }; }
  if (mode === 'left') { if (isLh) return { ok: true, hand: 'lh', wrong: false }; if (isRh) return { ok: false, hand: null, wrong: false }; return { ok: false, hand: null, wrong: true }; }
  if (isRh) return { ok: true, hand: 'rh' };
  if (isLh) return { ok: true, hand: 'lh' };
  return { ok: false, hand: null };
}
