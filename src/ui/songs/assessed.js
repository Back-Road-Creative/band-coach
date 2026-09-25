// "Not assessed" labels for a judged try (plan P4-10): every judged step's
// result now names all four dimensions the app COULD grade -- notes,
// timing, holding notes, being in tune -- rather than only the ones the
// step's own passRule happened to set. A dimension that step never judges
// (e.g. pitch on a rhythm step, hold/tune on an instrument the mic can't
// measure that way) says so in plain words instead of just going quiet, so
// the learner never mistakes silence for "everything else was fine".
//
// Pure: no DOM, no AudioContext -- src/ui/songs.js owns the clock and the
// render.

// dims/unassessed for a judged step's learning event (plan 6.4): each
// dimension is read straight off judgeAttempt()'s own aggregate against
// the SAME numbers step.passRule already judges pass/fail with -- never a
// new threshold invented here. A dimension the step's passRule never set
// (e.g. tune/hold on a non-sustaining instrument, pitch on a rhythm step
// where a clap is deliberately pitch-free -- practice.js's judgeOnsets
// comment) is left out of `dims` and listed in `unassessed` instead of
// guessed at. Moved unchanged from src/ui/songs.js (P4-10).
export function dimsFromStep(step, result) {
  const dims = {}, unassessed = [], rule = step.passRule || {};
  // A percussion step (src/song/lesson.js's percussionRules) is the only
  // kind of step that ever sets minPieceRate -- that is the one signal
  // available here (no instrument param) that this step's fifth "which
  // drum" dimension applies at all.
  const isPercussion = rule.minPieceRate != null;
  if (!result || !result.judgedCount) { unassessed.push('pitch', 'onset', 'hold', 'tune'); if (isPercussion) unassessed.push('drum'); return { dims, unassessed }; }
  if (step.kind === 'rhythm') unassessed.push('pitch');
  else dims.pitch = result.matches.every((m) => m.ok && m.pitchOk !== false) ? 'ok' : 'miss';
  if (rule.maxMeanErrorMs != null && result.meanErrorMs != null) dims.onset = result.meanErrorMs <= rule.maxMeanErrorMs ? 'ok' : 'miss';
  else unassessed.push('onset');
  if (rule.minDurationScore != null && result.durationScore != null) dims.hold = result.durationScore >= rule.minDurationScore ? 'ok' : 'miss';
  else unassessed.push('hold');
  if (rule.maxMeanAbsCents != null && result.meanAbsCents != null) dims.tune = result.meanAbsCents <= rule.maxMeanAbsCents ? 'ok' : 'miss';
  else unassessed.push('tune');
  if (isPercussion) {
    if (result.pieceRate != null) dims.drum = result.pieceRate >= rule.minPieceRate ? 'ok' : 'miss';
    else unassessed.push('drum');
  }
  return { dims, unassessed };
}

// Plain-word label for every dim key this panel ever renders -- never the
// key itself. `drum` (P4-12) is the fifth, percussion-only dim: whether the
// mic/e-kit hits it heard named the right piece.
const DIM_LABEL = { pitch: 'Notes', onset: 'Timing', hold: 'Holding notes', tune: 'In tune', drum: 'Which drum' };
const DIM_ORDER = ['pitch', 'onset', 'hold', 'tune'];

// Why a dim is unassessed, in the learner's own words -- never the raw dim
// key, never a made-up number. `instrument` (src/instruments/*.js) decides
// the hold/tune wording: a keyboard key (family 'keys') or a fretted
// instrument's own fret (family 'fretted', fretted: true) has a fixed pitch
// and a fixed length once struck, so "not judged" would be true but less
// helpful than saying why.
function reasonFor(dim, step, instrument) {
  if (dim === 'pitch') return 'a clapped rhythm has no pitches';
  if (dim === 'onset') return 'an untimed step';
  if (dim === 'hold') return instrument && instrument.family === 'keys' ? "a keyboard key can't be judged for length here" : 'not judged on this step';
  if (dim === 'drum') return "the microphone can't tell toms and cymbals apart";
  return instrument && (instrument.family === 'keys' || instrument.fretted) ? 'keyboards are always in tune' : 'not judged on this step';
}

// `dims`/`unassessed` straight from dimsFromStep(); `{step, instrument}` is
// only ever read for the not-assessed reason text above, never to re-derive
// ok/miss (dimsFromStep already decided that). Returns one entry per dim, in
// the fixed pitch/onset/hold/tune order (plus `drum` last, only for a
// percussion step), `{dim, state, text}` where `text` is the whole display
// line ("Notes: Right", "In tune: Not assessed (keyboards are always in
// tune)") -- never the dim key alone.
//
// A judged-nothing try (dimsFromStep's `!result || !result.judgedCount`
// branch: `dims` empty, all four -- or five, for a percussion step -- in
// `unassessed`) gets one shared, honest reason instead of four different
// structural reasons that would otherwise misdescribe a step that WAS
// timed/sustaining but simply heard nothing.
export function assessmentLines(dims, unassessed, { step, instrument } = {}) {
  const isPercussion = dims.drum !== undefined || unassessed.includes('drum');
  const order = isPercussion ? DIM_ORDER.concat('drum') : DIM_ORDER;
  const nothingHeard = Object.keys(dims).length === 0 && DIM_ORDER.every((d) => unassessed.includes(d));
  return order.map((dim) => {
    const label = DIM_LABEL[dim];
    if (dims[dim]) return { dim, state: dims[dim], text: label + ': ' + (dims[dim] === 'ok' ? 'Right' : 'Miss') };
    const reason = nothingHeard ? 'nothing was heard this try' : reasonFor(dim, step, instrument);
    return { dim, state: 'not-assessed', text: label + ': Not assessed (' + reason + ')' };
  });
}
