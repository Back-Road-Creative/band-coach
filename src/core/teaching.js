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

// The whole loop, in order. `demo` and `transfer` have their own step kinds
// (demoFor / interludeAfter below): runtime steps src/ui/songs.js slots in
// between plan steps the way it does a repair, never entries in
// buildLessonPlan's own plan.steps (that would shift every saved
// stepIndex a learner is resuming from).
export const PHASES = ['explain', 'demo', 'guided', 'check', 'repair', 'transfer'];

// Which loop phase a src/song/lesson.js buildLessonPlan step belongs to. A
// step with no passRule (the "listen" kind) is pure explanation -- nothing
// is judged. "rhythm"/"pitches" are the guided, narrower-than-the-whole-
// phrase steps; "phrase-slow"/"tempo-ladder"/"chain"/"whole" are where the
// learner is actually checked against the full phrase at speed. "repair" is
// the short isolated exercise repairFor (below) builds.
export function phaseOf(step) {
  if (step && step.kind === 'demo') return 'demo';
  if (step && step.kind === 'transfer') return 'transfer';
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
// Several notes can fail the SAME dim in one try (three missed pitches, say)
// -- repairFor below isolates only the single WORST of them (plan §7B unit
// R1V2): one clear thing to fix reads as a repair, not a second pop quiz
// over the whole failing set. "Worst" is dim-specific severity (the biggest
// timing miss, the furthest-out cents, the furthest-out hold ratio); a
// dim with no severity of its own (pitch: a note is either heard or it
// isn't; piece: right drum or wrong one) has no way to rank its misses, so
// the first one broken in the phrase -- the one the learner hit first --
// is the one worth fixing first.
function worstNoteIndex(dim, result, noteIndices) {
  if (noteIndices.length <= 1) return noteIndices[0];
  const matches = result.matches || [];
  if (dim === 'onset') return noteIndices.reduce((best, i) => (Math.abs(matches[i].errorMs) > Math.abs(matches[best].errorMs) ? i : best));
  if (dim === 'tune') return noteIndices.reduce((best, i) => (Math.abs(matches[i].cents) > Math.abs(matches[best].cents) ? i : best));
  if (dim === 'hold') return noteIndices.reduce((best, i) => (Math.abs(matches[i].durRatio - 1) > Math.abs(matches[best].durRatio - 1) ? i : best));
  return noteIndices[0];
}

// A short repair exercise for a FAILED check step, isolating the SINGLE
// worst note that failed (worstNoteIndex above), then returning to the
// original step (returnTo -- the caller, src/ui/songs.js, fills in the
// stepIndex to come back to; repairFor only knows the step, not its
// position in the plan). null when failedDimension found nothing to isolate
// -- no dim at all (result actually passed, or an inconsistent hand-built
// result), or 'extras' (a wrong note struck alongside the right ones isn't
// one of the step's own expected notes, so there is nothing to isolate it
// around).
export function repairFor(step, result, passRule) {
  const { dim, noteIndices } = failedDimension(result, passRule);
  if (!dim || dim === 'extras' || !noteIndices.length) return null;
  const note = step.notes[worstNoteIndex(dim, result, noteIndices)];
  if (!note) return null;
  const notes = [note];
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

// ---------------------------------------------------------------------------
// demo and transfer: the two runtime step kinds
// ---------------------------------------------------------------------------

const DEMO_TEMPO_SCALE = 0.55; // same slow speed as the plan's own phrase-slow step

// The passage played slowly for the learner to watch and hear before being
// asked to play it: never judged (passRule null), so nothing about it ever
// enters practice.results. `step` is any step of the passage with its 1x
// tempo (the listen step); an untimed one (bpm 0) stays untimed.
export function demoFor(step) {
  return {
    kind: 'demo',
    phraseIndex: step.phraseIndex,
    bars: step.bars,
    originTick: step.originTick,
    bpm: step.bpm > 0 ? Math.round(step.bpm * DEMO_TEMPO_SCALE) : 0,
    tempoScale: step.bpm > 0 ? DEMO_TEMPO_SCALE : 0,
    notes: step.notes,
    passRule: null,
  };
}

// One passage's identity for "is this phrase's check sequence finished":
// a phrase's own steps share a phraseIndex; chain steps reuse the index of
// the phrase they extend to, so they are told apart by kind.
function sectionKey(step) {
  return (step.kind === 'chain' || step.kind === 'whole' ? step.kind : 'phrase') + ':' + step.phraseIndex;
}

// Whether a demo or transfer step belongs between `prev` (the step just
// finished, `passed` or not) and `next` (the plan step nextStep picked), and
// which. Driven by nextPhase: explain -> demo shows before the first guided
// step (Learn only -- Rehearse and Check are meant to be played without
// hearing it first); check + passed -> transfer once the passage's last check
// step is done (not between ladder rungs). Check never earns anything to
// review and a rested hand (`unassessed`) judged nothing, so both get null.
//   { step, blocking, review }: `blocking` true is a screen of its own
//   (next section is coming); false is a note only, with `review` the
//   { phraseIndex, bars, kind } to queue for a later session because there
//   is no next section to carry the skill into.
export function interludeAfter({ prev, passed, next, mode, unassessed }) {
  if (!prev || unassessed) return null;
  const phase = nextPhase(phaseOf(prev), passed);
  if (phase === 'demo') {
    if (mode !== 'learn' || !next || phaseOf(next) !== 'guided') return null;
    return { step: demoFor(prev), blocking: true, review: null };
  }
  if (phase === 'transfer' && phaseOf(prev) === 'check') {
    if (mode === 'check') return null;
    if (next && phaseOf(next) === 'check' && sectionKey(next) === sectionKey(prev)) return null;
    const step = { kind: 'transfer', phraseIndex: prev.phraseIndex, fromBars: prev.bars, toBars: null, passRule: null, notes: [] };
    if (next && next.kind === 'listen') return { step: { ...step, toBars: next.bars }, blocking: true, review: null };
    return { step, blocking: false, review: { phraseIndex: prev.phraseIndex, bars: prev.bars, kind: prev.kind } };
  }
  return null;
}

// The delayed review queue (persisted by src/ui/songs.js in
// api.store('songs-review') -> DB.panels, so save/load/backup carry it like
// every other panel store). Newest first, one entry per song+part (the latest passage passed),
// bounded. The caller owns the clock: `at` is the caller's epoch ms.
export const REVIEW_MAX = 20;
const reviewSame = (a, b) => a.songId === b.songId && a.partId === b.partId; // one review per song+part: the latest passage passed replaces the earlier one

export function sanitizeReviewQueue(raw) {
  const items = raw && typeof raw === 'object' && Array.isArray(raw.items) ? raw.items : [];
  const out = [];
  for (const e of items) {
    if (!e || typeof e !== 'object') continue;
    const { songId, partId, instrumentId, phraseIndex, bars, kind, at } = e;
    if (typeof songId !== 'string' || typeof partId !== 'string' || typeof kind !== 'string') continue;
    if (!Array.isArray(bars) || bars.length !== 2 || !bars.every(Number.isInteger)) continue;
    if (!Number.isFinite(at)) continue;
    if (phraseIndex !== null && !Number.isInteger(phraseIndex)) continue;
    out.push({ songId, partId, instrumentId: typeof instrumentId === 'string' ? instrumentId : null, phraseIndex, bars: [bars[0], bars[1]], kind, at });
    if (out.length >= REVIEW_MAX) break;
  }
  return out;
}

export function addReview(queue, entry, at) {
  const rest = queue.filter((e) => !reviewSame(e, entry));
  return [{ ...entry, bars: [entry.bars[0], entry.bars[1]], at }, ...rest].slice(0, REVIEW_MAX);
}

// Due = queued before `before` (the moment the current app session began),
// i.e. in an EARLIER session -- "next session", not the next minute.
export function dueReviews(queue, { songId, partId, before }) {
  return queue.filter((e) => e.songId === songId && e.partId === partId && e.at < before);
}

export function dropReviews(queue, { songId, partId, before }) {
  return queue.filter((e) => !(e.songId === songId && e.partId === partId && e.at < before));
}
