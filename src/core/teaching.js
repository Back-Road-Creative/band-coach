// Pure teaching-loop shapes (plan §7B unit B2): the explain -> demo ->
// guided -> check -> repair -> transfer loop (plan §4) that a song-practice
// step belongs to, and the short repair exercise a step that keeps failing
// the SAME thing gets isolated into, before returning to the original step.
// No DOM, no AudioContext, no clock reads -- every input is a plain object
// the caller (src/ui/songs.js) already has (a plan step, a judged result,
// its passRule); this runs under plain `node --test`.

// failedDimension is practice.js's own decision (shared with firstCorrection,
// the plain-word failure message) about which rule a judged result failed
// FIRST -- repairFor below reuses it rather than re-deriving the same
// precedence order a second time.
import { failedDimension } from '../ui/songs/practice.js';

// The whole loop, in order. `demo` and `transfer` are named here so a later
// unit can wire them up (demo: an explicit "watch it played" step before the
// learner is asked to guess at the phrase; transfer: a delayed review once a
// step has been passed) -- neither has a plan.steps `kind` yet, so phaseOf
// below never returns them for a real step.
export const PHASES = ['explain', 'demo', 'guided', 'check', 'repair', 'transfer'];

// Which loop phase a src/song/lesson.js buildLessonPlan step belongs to. A
// step with no passRule (the "listen" kind) is pure explanation -- nothing
// is judged. "rhythm"/"pitches" are the guided, narrower-than-the-whole-
// phrase steps; "phrase-slow"/"tempo-ladder"/"chain"/"whole" are where the
// learner is actually checked against the full phrase at speed. "repair" is
// the short isolated exercise repairFor (below) builds.
export function phaseOf(step) {
  if (!step || !step.passRule) return 'explain';
  if (step.kind === 'rhythm' || step.kind === 'pitches') return 'guided';
  if (step.kind === 'repair') return 'repair';
  if (step.kind === 'phrase-slow' || step.kind === 'tempo-ladder' || step.kind === 'chain' || step.kind === 'whole') return 'check';
  return 'explain';
}

// The next phase in the §4 loop. explain/demo/guided always move forward --
// there is nothing to fail yet. check branches on whether the try passed:
// a fail goes to repair (isolate the one thing that broke); a pass moves on
// to transfer. repair itself loops back to check (returnTo, below) once
// passed -- the whole point is to come back to the original phrase, not stay
// isolated -- and repeats itself (stays 'repair') on another miss.
export function nextPhase(phase, passed) {
  if (phase === 'explain') return 'demo';
  if (phase === 'demo') return 'guided';
  if (phase === 'guided') return 'check';
  if (phase === 'check') return passed ? 'transfer' : 'repair';
  if (phase === 'repair') return passed ? 'check' : 'repair';
  return phase;
}

// notes/matches share the same index order (judgeAttempt, practice.js) --
// so noteIndices (from failedDimension) index straight into step.notes.
// Isolating just the failing note(s) with nothing around them plays like a
// pop quiz, not a phrase, so each failing index also pulls in its immediate
// neighbour on either side, then the whole set is capped at 6 notes,
// trimming neighbours (never a failing note itself) first.
function notesAround(notes, noteIndices) {
  const keep = new Set(noteIndices);
  noteIndices.forEach((i) => {
    if (i - 1 >= 0) keep.add(i - 1);
    if (i + 1 < notes.length) keep.add(i + 1);
  });
  const sorted = Array.from(keep).sort((a, b) => a - b);
  while (sorted.length > 6) {
    const dropAt = sorted.findIndex((i) => !noteIndices.includes(i));
    if (dropAt === -1) break; // every kept index is itself a failing note -- leave it, rare (>6 failures at once)
    sorted.splice(dropAt, 1);
  }
  return sorted.map((i) => notes[i]);
}

// A short repair exercise for a FAILED check step, isolating just the
// note(s) that failed plus one neighbour either side, then returning to the
// original step (returnTo -- the caller, src/ui/songs.js, fills in the
// stepIndex to come back to; repairFor only knows the step, not its
// position in the plan). null when failedDimension found nothing to isolate
// -- no dim at all (result actually passed, or an inconsistent hand-built
// result), or 'extras' (a wrong note struck alongside the right ones isn't
// one of the step's own expected notes, so there is nothing to isolate it
// around).
export function repairFor(step, result, passRule) {
  const { dim, noteIndices } = failedDimension(result, passRule);
  if (!dim || dim === 'extras') return null;
  const notes = notesAround(step.notes, noteIndices);
  if (!notes.length) return null;
  let repairPassRule = { ...passRule, hitRate: Math.min(passRule.hitRate, 0.8) };
  // pitch isolation is untimed, like the "pitches" step kind -- the note
  // that was missed was never judged on WHEN it landed, only whether it
  // landed at all, so timing has nothing to say about it here.
  if (dim === 'pitch') repairPassRule = { ...repairPassRule, maxMeanErrorMs: null };
  return {
    kind: 'repair',
    dim,
    returnTo: null, // caller (src/ui/songs.js) fills in the stepIndex to return to
    phraseIndex: step.phraseIndex,
    bars: step.bars,
    originTick: notes[0].start,
    bpm: step.bpm,
    notes,
    passRule: repairPassRule,
  };
}
