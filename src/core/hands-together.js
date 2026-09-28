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
// Level 15 ("held bass under the melody", j<n>h) and level 16 ("different
// rhythms in each hand", j<n>d) are two more LEARN-then-CHECK stages built
// on the same five pairs, each its own distinct mastery:
//   - Level 15: the left hand holds its note (heldBassMelody's bass) while
//     the right hand plays a short three-note tune over it (heldBassMelody
//     below). Letting go of the bass too soon fails; gradeHeldBass() judges
//     it from real note-on/note-off timestamps, the same as gradeTimedPair.
//   - Level 16: the right hand plays two even notes while the left hand
//     holds one long note underneath, judged as two SEPARATE verdicts
//     (gradeSplitRhythm() returns a state for each hand) rather than one
//     shared pass/fail.
// See isStagedPairId()/handsStageFromId() below for how an id's stage
// ('timed' | 'held' | 'split') is told apart from the plain both-hands id.
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
// towards, or consuming, the shared both-hands item), 'j<n>t' (level 14's
// timed both-hands pair -- "matching rhythms"), 'j<n>h' (level 15's held
// bass) or 'j<n>d' (level 16's split rhythm) -- t/h/d are each their own
// distinct mastery again, so none of them ever credits or consumes the
// plain both-hands item, or each other's. Any other trailing character is
// not a recognised id.
function parseId(id) {
  if (typeof id !== 'string') return null;
  const m = /^(j\d+)([rlthd])?$/.exec(id);
  if (!m) return null;
  const suf = m[2];
  const stage = suf === 't' ? 'timed' : suf === 'h' ? 'held' : suf === 'd' ? 'split' : 'plain';
  return { baseId: m[1], mode: suf === 'r' ? 'right' : suf === 'l' ? 'left' : 'both', timed: suf === 't', stage: stage };
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

// The stage a (possibly staged) id names: 'plain' for a bare 'j<n>' id or a
// mode-suffixed 'j<n>r'/'j<n>l', 'timed'/'held'/'split' for level 14/15/16's
// own ids, null for anything that does not parse as a hands-together id at
// all -- unlike handsModeFromId, an invalid id is never silently folded into
// a default here, since the app.js CHECK branches key directly off this.
export function handsStageFromId(id) {
  const parsed = parseId(id);
  return parsed ? parsed.stage : null;
}

// True for any id that needs a LEARN-then-CHECK e.pair scratchpad (level
// 14/15/16's t/h/d ids) -- what mk() (src/app.js) reads to decide whether to
// build one at all. False for a plain 'j<n>' id or a mode-suffixed
// 'j<n>r'/'j<n>l', which are graded exactly, with no phase and no timing.
export function isStagedPairId(id) {
  const parsed = parseId(id);
  return !!parsed && parsed.stage !== 'plain';
}

export function fingeringLabel(exercise) {
  return 'right hand finger ' + exercise.rh.finger + ', left hand finger ' + exercise.lh.finger;
}

// Has this SRS model actually PLAYED (a graded attempt, reps>0) both hands
// alone, or already holds a genuinely used both-hands (plain j<n>) item? For
// j1r/j1l, `seen` alone is NOT enough: mk() (src/app.js) sets seen the
// instant an element is BUILT, before the learner has played a single note,
// so a seen>0/reps:0 item is only evidence the drill was offered, not that
// it was played -- reps is only ever written by review() (src/app.js's
// credit()), once an element has actually been judged. The plain j<n>
// grandfather clause is unchanged from before this distinction existed:
// seen>0 or reps>0 still counts there (an older both-hands record's `seen`
// is still real historical evidence, since level 13's own gate never
// existed to create a seen-without-reps plain j<n> item in the first
// place), and it()/evaluate() still create seen:0, reps:0 placeholder items
// for ids they only glance at (weight() over every pool id, evaluate() over
// the plain j ids once ready>=1) which never count as evidence either way.
export function bothUnlocked(model) {
  if (!model || typeof model !== 'object') return false;
  const items = model.item || {};
  const played = it => !!it && (it.reps | 0) > 0;
  const used = it => !!it && ((it.seen | 0) > 0 || (it.reps | 0) > 0);
  return (played(items.j1r) && played(items.j1l)) || HANDS_TOGETHER_EXERCISES.some(e => used(items[e.id]));
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

// Level 15 ("held bass under the melody"): for a pair's exercise, the three
// notes the right hand plays over the held bass -- always [rh(i), <the
// neighbouring pair's rh>, rh(i)] (the bass and the first melody note are
// held together, so LEARN can reuse K3's plain both-hands check untouched;
// see the module comment above). The neighbour is the NEXT pair up the
// position, except for the top pair (G), which has none to go up to and so
// steps back down to the previous one (F) instead -- "For the top pair G it
// plays [G, F, G], i.e. 67, 65, 67." Each note keeps its own pair's finger
// number, for hintFor()/prepLine()-style captions.
export function heldBassMelody(exercise) {
  const i = STEPS.findIndex(s => s.rh === exercise.rh.midi);
  const j = i < STEPS.length - 1 ? i + 1 : i - 1;
  const a = STEPS[i], b = STEPS[j];
  return [{ midi: a.rh, finger: a.rf }, { midi: b.rh, finger: b.rf }, { midi: a.rh, finger: a.rf }];
}

// gradeHeldBass(exercise, rec) -- rec = { bassOn, bassOff, notes: [{ midi,
// ms, bassHeld }] }, `notes` in the order they arrived, `bassHeld` recording
// (at the moment each melody note-on arrived) whether the bass was still
// genuinely down. Never mutates its input. Returns { state, reason }:
//   - 'waiting': not enough evidence yet (fewer than three melody notes
//     matched, and the bass has not yet been released early).
//   - 'fail': a melody note that is not the next expected one (reason names
//     the expected note), a melody note played while the bass was not
//     actually held (reason names the left hand and the hold), or the bass
//     released before the last melody note-on (same hold reason).
//   - 'pass': all three melody notes matched, in order, each with the bass
//     genuinely held, and the bass note-off came at or after the last
//     melody note-on.
export function gradeHeldBass(exercise, rec) {
  const bassName = nameFor(exercise.lh.midi, { octave: true });
  const holdReason = 'The left hand let go of ' + bassName + ' before the right hand finished. Keep holding the bass until the last right-hand note.';
  const melody = heldBassMelody(exercise);
  const notes = (rec && rec.notes) || [];
  for (let k = 0; k < notes.length && k < melody.length; k++) {
    const expected = melody[k], got = notes[k];
    if (got.midi !== expected.midi) return { state: 'fail', reason: nameFor(got.midi, { octave: true }) + ' is not the next melody note. Play ' + nameFor(expected.midi, { octave: true }) + ' instead.' };
    if (!got.bassHeld) return { state: 'fail', reason: holdReason };
  }
  const bassOff = rec && rec.bassOff;
  if (notes.length < melody.length) {
    if (bassOff !== undefined && bassOff !== null) return { state: 'fail', reason: holdReason };
    return { state: 'waiting', reason: null };
  }
  if (bassOff === undefined || bassOff === null) return { state: 'waiting', reason: null };
  const lastMs = notes[notes.length - 1].ms;
  if (bassOff < lastMs) return { state: 'fail', reason: holdReason };
  return { state: 'pass', reason: null };
}

// Level 16's own tolerance for the second right-hand note relative to the
// held left-hand note's midpoint: the wider of PAIR_RELEASE_TOL_MS or this
// ratio of the left-hand note's own length, so a longer held note (a more
// forgiving, slower-paced take) gets a proportionally wider window.
export const SPLIT_MID_TOL_RATIO = 0.2;

// gradeSplitRhythm(exercise, rec) -- rec = { lhOn, lhOff, rhOns: [ms, ...],
// rhOffs: [ms, ...] }, never mutated. Each hand is graded on its own
// evidence and gets its OWN state -- there is no single combined pass/fail a
// player can read as "the exercise", by design (decision 4): the left hand
// is judged against the right hand's two onsets/second release, and the
// right hand's second onset is judged against the left hand's own held
// note -- see rh/lh below. Returns { state, reason, rh: { state, reason },
// lh: { state, reason } }, where the outer `state`/`reason` is 'fail' if
// either hand fails (naming that hand's reason), 'pass' once both hands
// have independently passed, else 'waiting'.
export function gradeSplitRhythm(exercise, rec) {
  const lhOn = rec && rec.lhOn, lhOff = rec && rec.lhOff;
  const rhOns = (rec && rec.rhOns) || [], rhOffs = (rec && rec.rhOffs) || [];
  const lh = { state: 'waiting', reason: null };
  const rh = { state: 'waiting', reason: null };

  if (lhOn !== undefined && lhOn !== null && rhOns.length >= 1) {
    const delta = lhOn - rhOns[0];
    if (Math.abs(delta) > PAIR_ONSET_TOL_MS) {
      lh.state = 'fail';
      lh.reason = delta > 0
        ? 'The left hand came in ' + Math.round(delta) + ' ms after the right hand started. Press both hands together.'
        : 'The left hand came in ' + Math.round(Math.abs(delta)) + ' ms before the right hand started. Press both hands together.';
    }
  }
  if (lh.state !== 'fail' && lhOff !== undefined && lhOff !== null && rhOns.length >= 2 && lhOff < rhOns[1]) {
    lh.state = 'fail';
    lh.reason = 'The left hand let go before the second right-hand note. Hold the left hand under both right-hand notes.';
  }
  if (lh.state !== 'fail' && lhOff !== undefined && lhOff !== null && rhOffs.length >= 2) {
    const delta = lhOff - rhOffs[1];
    if (Math.abs(delta) > PAIR_RELEASE_TOL_MS) {
      lh.state = 'fail';
      lh.reason = 'The left hand let go ' + Math.round(Math.abs(delta)) + ' ms ' + (delta > 0 ? 'after' : 'before') + ' the right hand finished. Let go together.';
    } else {
      lh.state = 'pass';
    }
  }

  if (rhOns.length >= 2 && lhOn !== undefined && lhOn !== null && lhOff !== undefined && lhOff !== null) {
    const mid = (lhOn + lhOff) / 2, tol = Math.max(PAIR_RELEASE_TOL_MS, SPLIT_MID_TOL_RATIO * (lhOff - lhOn));
    const delta = rhOns[1] - mid;
    if (Math.abs(delta) > tol) {
      rh.state = 'fail';
      rh.reason = 'The right hand\'s second note came ' + Math.round(Math.abs(delta)) + ' ms ' + (delta > 0 ? 'late' : 'early') + '. It should land in the middle of the held left-hand note.';
    } else {
      rh.state = 'pass';
    }
  }

  const state = (lh.state === 'fail' || rh.state === 'fail') ? 'fail' : (lh.state === 'pass' && rh.state === 'pass') ? 'pass' : 'waiting';
  const reason = lh.state === 'fail' ? lh.reason : rh.state === 'fail' ? rh.reason : null;
  return { state: state, reason: reason, rh: rh, lh: lh };
}
