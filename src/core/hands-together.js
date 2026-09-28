// Level 13's Both/Right only/Left only gate: Both stays disabled (the level
// is built right-hand-only) until the right hand alone (j<n>r) and the left
// hand alone (j<n>l) have each actually been shown at least once -- see
// bothUnlocked() below. A player who already holds a genuinely used plain
// j1-j5 item (an earlier both-hands record, from before the gate existed or
// from any other route) is grandfathered straight to Both open.
//
// Level 14 ("matching rhythms", j<n>t) reuses the same five pairs with real
// timing on top: LEARN (both notes held together, untimed) then CHECK
// (press together within PAIR_ONSET_TOL_MS, let go together within
// PAIR_RELEASE_TOL_MS) -- see isTimedPairId() and gradeTimedPair() below.
// It is its own distinct spaced-repetition mastery, never the plain
// both-hands item's.
//
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
import { nameFor } from './note-names.js';

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

// A task/SRS id is 'j<n>' (both-hands mastery, unchanged), 'j<n>r'/'j<n>l'
// (right-only / left-only practice, its own distinct mastery — see B1(4):
// crediting a mode-suffixed id keeps a right-only pass from ever counting
// towards, or consuming, the shared both-hands item), or 'j<n>t' (level 14's
// timed both-hands pair -- "matching rhythms" -- its own distinct mastery
// again, so a timed pass never credits or consumes the plain both-hands
// item either). Any other trailing character is not a recognised id.
function parseId(id) {
  if (typeof id !== 'string') return null;
  const m = /^(j\d+)([rlt])?$/.exec(id);
  if (!m) return null;
  return { baseId: m[1], mode: m[2] === 'r' ? 'right' : m[2] === 'l' ? 'left' : 'both', timed: m[2] === 't' };
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

// Level 14 ("matching rhythms") ids only -- the one thing that tells the
// rest of the app an id needs LEARN-then-CHECK timing grading, rather than
// the plain-'both' exact grading a bare 'j<n>' id gets. Any other id
// (including 'j<n>r'/'j<n>l', which are also 'both'-free of this) is false.
export function isTimedPairId(id) {
  const parsed = parseId(id);
  return !!parsed && !!parsed.timed;
}

export function fingeringLabel(exercise) {
  return 'right hand finger ' + exercise.rh.finger + ', left hand finger ' + exercise.lh.finger;
}

// Has this SRS model actually SEEN evidence for both hands played alone, or
// already holds a genuinely used both-hands (plain j<n>) item? "Shown" means
// seen>0 or reps>0 -- NOT mere key existence: it()/evaluate() create seen:0,
// reps:0 placeholder items for ids they only glance at (weight() over every
// pool id, evaluate() over the plain j ids once ready>=1), and those must
// never count as evidence a hand was actually practised.
export function bothUnlocked(model) {
  if (!model || typeof model !== 'object') return false;
  const items = model.item || {};
  const used = it => !!it && ((it.seen | 0) > 0 || (it.reps | 0) > 0);
  return (used(items.j1r) && used(items.j1l)) || HANDS_TOGETHER_EXERCISES.some(e => used(items[e.id]));
}

// The Hands mode the level-13 task actually builds: 'both' stays gated to
// 'right' until bothUnlocked() says otherwise. The saved preference itself
// (DB.prefs.kbdHands) is never rewritten by this -- once unlocked, whatever
// the player has it set to (still 'both', typically) just takes effect.
export function effectiveHands(pref, unlocked) {
  const mode = pref === 'right' || pref === 'left' ? pref : 'both';
  return mode === 'both' && !unlocked ? 'right' : mode;
}

const FINGER_WORD = { 1: 'thumb', 2: 'index finger', 3: 'middle finger', 4: 'ring finger', 5: 'little finger' };

// A one-line "before you start" caption naming each hand's starting finger
// and key -- read aloud in everyday words, not a fingering diagram, since a
// beginner has not necessarily learned to read one yet. `nameOf` defaults to
// this module's own note-naming convention (letters, with octave, matching
// the keyboard mod's on-screen labels) but a caller may inject any namer.
export function prepLine(exercise, nameOf) {
  const namer = nameOf || (m => nameFor(m, { octave: true }));
  const rh = exercise.rh, lh = exercise.lh;
  return 'Before you start: right hand ' + FINGER_WORD[rh.finger] + ' (finger ' + rh.finger + ') on ' + namer(rh.midi) +
    '; left hand ' + FINGER_WORD[lh.finger] + ' (finger ' + lh.finger + ') on ' + namer(lh.midi) + '.';
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

// Level 14 ("matching rhythms"): how close together is close enough,
// measured from real note-on/note-off timestamps (performance.now(), read
// by the caller when the event actually arrives -- never now()/
// actx.currentTime, which can sit frozen while the AudioContext is
// suspended). Onset gets the tighter tolerance (a keyboardist's two hands
// landing together is a fast, deliberate motion); release is a little more
// forgiving since letting go together is a softer, less practised motion.
export const PAIR_ONSET_TOL_MS = 100;
export const PAIR_RELEASE_TOL_MS = 150;

// gradeTimedPair(exercise, rec) -- rec = { on: {midi: ms}, off: {midi: ms} },
// keyed by the exercise's own rh.midi/lh.midi, never mutated. Returns
// { state, reason, deltaMs }:
//   - 'waiting': not enough evidence yet either to pass or fail (one or
//     both onsets missing, or onsets in tolerance but one or both releases
//     missing).
//   - 'fail': the two onsets (or, once onset already passed, the two
//     releases) are further apart than their tolerance -- `reason` is a
//     plain-language sentence naming which hand was early/late and by how
//     many milliseconds (rounded).
//   - 'pass': both onsets and both releases landed within tolerance of
//     each other.
export function gradeTimedPair(exercise, rec) {
  const on = (rec && rec.on) || {}, off = (rec && rec.off) || {};
  const rhOn = on[exercise.rh.midi], lhOn = on[exercise.lh.midi];
  if (rhOn === undefined || lhOn === undefined) return { state: 'waiting', reason: null, deltaMs: null };
  const onsetDelta = rhOn - lhOn;
  if (Math.abs(onsetDelta) > PAIR_ONSET_TOL_MS) {
    const ms = Math.round(Math.abs(onsetDelta));
    const reason = onsetDelta > 0
      ? 'Right hand came in ' + ms + ' ms after the left hand. Press both keys at the same moment.'
      : 'Left hand came in ' + ms + ' ms after the right hand. Press both keys at the same moment.';
    return { state: 'fail', reason: reason, deltaMs: ms };
  }
  const rhOff = off[exercise.rh.midi], lhOff = off[exercise.lh.midi];
  if (rhOff === undefined || lhOff === undefined) return { state: 'waiting', reason: null, deltaMs: null };
  const releaseDelta = rhOff - lhOff;
  if (Math.abs(releaseDelta) > PAIR_RELEASE_TOL_MS) {
    const ms = Math.round(Math.abs(releaseDelta));
    const reason = releaseDelta > 0
      ? 'The right hand let go ' + ms + ' ms after the left hand. Let go together.'
      : 'The right hand let go ' + ms + ' ms before the left hand. Let go together.';
    return { state: 'fail', reason: reason, deltaMs: ms };
  }
  return { state: 'pass', reason: null, deltaMs: Math.round(Math.abs(releaseDelta)) };
}
