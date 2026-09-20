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

export function handsTogetherById(id) {
  return HANDS_TOGETHER_EXERCISES.find(e => e.id === id) || null;
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
export function gradeHandsTogetherExact(exercise, heldMidis) {
  const midis = heldMidis || [];
  const rh = midis.includes(exercise.rh.midi);
  const lh = midis.includes(exercise.lh.midi);
  const wrong = midis.filter(m => m !== exercise.rh.midi && m !== exercise.lh.midi);
  return { ok: rh && lh && wrong.length === 0, rh: rh, lh: lh, wrong: wrong };
}

// APPROXIMATE grading: a single detected pitch, as a monophonic microphone
// pitch detector reports. It can confirm at most ONE of the two notes and
// can never know both sounded together, so this never reports both hands
// correct — only which single hand's note (if either) it heard.
export function gradeHandsTogetherApprox(exercise, midi) {
  if (midi === exercise.rh.midi) return { ok: true, hand: 'rh' };
  if (midi === exercise.lh.midi) return { ok: true, hand: 'lh' };
  return { ok: false, hand: null };
}
