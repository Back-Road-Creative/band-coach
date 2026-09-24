import { BLOW_STEPS, DRAW_STEPS } from '../instruments/how/harmonica.js';
import { phraseDifficulty } from './phrase-difficulty.js';
import { recipeForFamily } from '../audio/voices.js';
import { barsOf } from './model.js';

// Lesson generator (plan unit 5.2, F9 "song practice never counts").
//
// Turns any Song (the shared shape owned by src/song/model.js — schema
// 'song/1': { schema, id, title, composer, licence, source, key, metre, bpm,
// ticksPerQuarter, parts: [{ id, name, notes: [{ start, dur, midi, tieFromPrev?,
// confidence? }] }], chords }) into a deterministic practice lesson for one
// instrument record (src/instruments/*.js, validated by src/instruments/schema.js).
//
// Pure module: no DOM, no window/document, no AudioContext, no Math.random,
// no Date.now(). Every ambiguous input (elapsed time, judged counts) is a
// parameter, so this runs under plain `node --test` and so a UI layer can
// drive it with real clocks and real judge results.
//
// Public API:
//   fitToInstrument(song, partId, instrument) -> { notes, shiftSemitones, changed, changes, unplayable }
//     Transposes the part by octaves (most instruments) or, for an instrument
//     with a fixed pitch set (currently only the free-reed family, i.e. a
//     10-hole diatonic harmonica in Richter tuning), by whichever semitone
//     shift lands the most notes on the instrument's real, playable pitches.
//     Never drops a note itself: every input note appears in `notes`
//     (transposed by the chosen shift, each entry's `index` matching its
//     position in `notes`) and any that still cannot be played are listed in
//     `unplayable` with a reason, for the wiring pass to show the learner.
//     buildLessonPlan is what actually removes those notes from the practice
//     steps below -- a step can't require playing a note the instrument
//     can't sound.
//   segment(song, partId) -> [{ bars: [fromBar, toBar], startTick, endTick, notes }]
//     Cuts the part into 1-4 bar phrases at rests, long notes, or the 4-bar
//     cap. Deterministic: same song in, same phrases out.
//   buildLessonPlan(song, partId, instrument, { level }) -> { songId, partId,
//     instrumentId, level, fit, steps }
//     steps is the ordered practice sequence: per phrase, listen -> rhythm-only
//     -> pitches-only (out of time) -> phrase at 50-60% tempo -> a tempo ladder
//     up to full speed; then, for a multi-phrase song, cumulative phrase-chain
//     steps; then one whole-piece step. Each step is plain data:
//     { kind, phraseIndex, bars: [from, to], originTick, bpm, notes, passRule }.
//     originTick is the step's first phrase's segment start tick: time zero
//     for playing it back, capturing the learner and judging the try. The
//     rhythm-only step is judged on onsets alone (any pitch, or a clap).
//   nextStep(plan, results) -> stepIndex (or plan.steps.length when done)
//     results is the chronological attempt history: [{ stepIndex, passed }, ...].
//     Deterministic function of that history: repeats a failed step, drops a
//     failed tempo-ladder rung down to the previous (slower) one after two
//     misses in a row, and skips the very next tempo-ladder rung after a
//     clean first-try pass.
//   creditFor(stepResult) -> { judged, ok, minutes, masteryKeys }
//     stepResult: { step, passed, elapsedMs, judgedCount? }. Wiring pass must
//     merge masteryKeys ({ key: 'midi:<n>', hit }) into the same per-item
//     mastery store the built-in drills use, and add judged/ok/minutes to the
//     session log, so a song counts exactly like a built-in exercise.

function getPart(song, partId) {
  const part = song.parts.find(p => p.id === partId);
  if (!part) throw new Error('lesson: no part "' + partId + '" in song "' + song.id + '"');
  return part;
}

// ---------------------------------------------------------------------------
// fitToInstrument
// ---------------------------------------------------------------------------

// Standard Richter-tuned 10-hole diatonic harmonica, expressed as semitone
// offsets from hole-1-blow (the tonic). Blow reeds sound the major triad
// arpeggio (0, 4, 7) repeated up two octaves plus the tonic on top (36 = 3
// octaves); draw reeds fill in the dominant-seventh arpeggio between them.
// The pattern itself lives in src/instruments/how/harmonica.js (BLOW_STEPS/
// DRAW_STEPS) so this module and the fingerings panel never disagree about
// what a Richter harmonica can play.
const RICHTER_BLOW_INTERVALS = BLOW_STEPS;
const RICHTER_DRAW_INTERVALS = DRAW_STEPS;

function harmonicaAvailableNotes(instrument) {
  const tonic = instrument.range.low; // hole 1 blow
  const set = new Set();
  RICHTER_BLOW_INTERVALS.forEach(iv => set.add(tonic + iv));
  RICHTER_DRAW_INTERVALS.forEach(iv => set.add(tonic + iv));
  return set;
}

function hasFixedPitchSet(instrument) {
  return instrument.family === 'free-reed';
}

// Candidate transpositions to try, ordered friendliest (smallest change)
// first so a tie between equally-good shifts always picks the smallest one.
function candidateShifts(instrument) {
  if (hasFixedPitchSet(instrument)) {
    // A harmonica cannot be retuned; the song can only be moved to a
    // "friendlier key" by a semitone shift, not by an octave (its range
    // already spans 3 octaves of fixed holes).
    const shifts = [0];
    for (let s = 1; s <= 11; s++) { shifts.push(s, -s); }
    return shifts;
  }
  const shifts = [0];
  for (let o = 1; o <= 8; o++) { shifts.push(o * 12, -o * 12); }
  return shifts;
}

// Every src/instruments/*.js record with a non-zero `transposition` stores
// its `range` in one of two conventions (confirmed against each file's own
// header comment and src/app.js's transposedMicRange, app.js:556-562):
//   - a genuine key-transposing instrument (clarinet-bb, trumpet-bb,
//     sax-alto-eb, sax-tenor-bb, horn-f) is transposed by an interval other
//     than a whole octave, and its `range` is WRITTEN pitch -- what the
//     learner reads on the page, in that instrument's own key.
//   - an octave-only "written an octave away" convention (double-bass,
//     recorder-descant, tin-whistle -- transposition a multiple of 12) keeps
//     `range` in SOUNDING pitch, same as every non-transposing instrument,
//     because the pitch class never changes, only the printed octave.
// `transposition % 12 !== 0` is exactly the data-driven test for the first
// group: no new schema field needed, and it can never disagree with a
// record's own file since it is derived from the same `transposition` value
// every other convention in this codebase already keys off.
function rangeIsWrittenPitch(instrument) {
  return instrument.transposition % 12 !== 0;
}

function notePlayable(shiftedMidi, instrument, availableSet) {
  const rangeMidi = rangeIsWrittenPitch(instrument) ? shiftedMidi - instrument.transposition : shiftedMidi;
  if (rangeMidi < instrument.range.low || rangeMidi > instrument.range.high) return 'out-of-range';
  if (availableSet && !availableSet.has(shiftedMidi)) return 'not-on-instrument';
  return null;
}

// Instrument families that can sound more than one pitch at once (chords).
// Verified via `git grep -h "family: '" -- src/instruments/*.js` (counts on
// origin/main 5b5c5e7): wind 8, fretted 8, bowed 4, brass 3, voice 1,
// percussion 1 (mallet), keys 1, free-reed 1 (harmonica). Only keys and
// fretted (strummed/fingerpicked guitar, uke, mandolin, banjo) and
// percussion (mallet -- two mallets at once) can genuinely sound a chord;
// everything else here is single-line. free-reed (harmonica) is treated as
// single-line even though a real harmonica CAN sound two adjacent holes at
// once, because the app only ever hears one pitch at a time through the mic
// pitch-detection path -- calling it chord-capable would just make every
// chord step silently unpassable.
//
// Defined here (not in feasibility.js, which owns the public isSingleLine
// name -- see its re-export) because fitToInstrument below needs it too,
// and feasibility.js already imports fitToInstrument from this module;
// defining it there and importing it back would make the two files a
// circular pair of ES module imports for no reason.
export const POLYPHONIC_FAMILIES = new Set(['keys', 'fretted', 'percussion']);
export function isSingleLine(instrument) {
  return !POLYPHONIC_FAMILIES.has(instrument.family);
}

// For a single-line instrument, which note indices belong to a chord (two or
// more notes sharing the same `start`) and should be dropped down to just
// the highest-pitched note of each group -- a single-line player plays one
// note at a time, so the top note (usually the melody line in a written-out
// chord) is what buildLessonPlan actually asks them to play; see
// feasibility.js's "Has chords" wording for what the learner is told.
// Overlapping-but-different-start notes (e.g. a held drone under a melody)
// are NOT treated as chords here -- only exact same-start groups -- since
// reducing a partial overlap would have to cut a note mid-duration rather
// than drop it outright, a different (and unimplemented) shape of fix.
function chordReductionFor(notes) {
  const byStart = new Map();
  notes.forEach((n, index) => {
    const group = byStart.get(n.start) || [];
    group.push(index);
    byStart.set(n.start, group);
  });
  const dropIndices = new Set();
  let chordCount = 0;
  for (const group of byStart.values()) {
    if (group.length < 2) continue;
    chordCount++;
    let topIndex = group[0];
    for (const idx of group) { if (notes[idx].midi > notes[topIndex].midi) topIndex = idx; }
    for (const idx of group) { if (idx !== topIndex) dropIndices.add(idx); }
  }
  return { dropIndices, chordCount };
}

export function fitToInstrument(song, partId, instrument) {
  const part = getPart(song, partId);
  const notes = part.notes;
  const availableSet = hasFixedPitchSet(instrument) ? harmonicaAvailableNotes(instrument) : null;
  // A single-line instrument can't sound two notes of a chord together --
  // reduce each same-start group down to its top note (chordReductionFor
  // above); everything else here is unchanged.
  const chords = isSingleLine(instrument) ? chordReductionFor(notes) : { dropIndices: new Set(), chordCount: 0 };

  if (notes.length === 0) {
    return { notes: [], shiftSemitones: 0, changed: false, changes: [], unplayable: [] };
  }

  let best = null;
  for (const shift of candidateShifts(instrument)) {
    const details = [];
    notes.forEach((n, index) => {
      const shiftedMidi = n.midi + shift;
      // A dropped chord note is unplayable at every shift alike -- record it
      // once per candidate (matching the range/harmonica reasons below) and
      // skip the range/availableSet check, which would just duplicate the
      // reason on a note that's leaving anyway.
      if (chords.dropIndices.has(index)) {
        details.push({ start: n.start, dur: n.dur, originalMidi: n.midi, attemptedMidi: shiftedMidi, reason: 'chord-note', index });
        return;
      }
      const reason = notePlayable(shiftedMidi, instrument, availableSet);
      // `index` into `notes` (== into `fittedNotes` below, same order) so a
      // caller can drop exactly the flagged notes without guessing from
      // start/midi alone, which breaks on two notes sharing both.
      if (reason) details.push({ start: n.start, dur: n.dur, originalMidi: n.midi, attemptedMidi: shiftedMidi, reason, index });
    });
    if (best === null || details.length < best.details.length) {
      best = { shift, details };
    }
    // iterated friendliest-first: first perfect fit wins -- but a chord part
    // never reaches zero details (its dropped notes are unplayable at every
    // shift), so this just falls through to the last candidate, same cost
    // as before for the common (chordless) case.
    if (best.details.length === 0) break;
  }

  const shift = best.shift;
  const fittedNotes = notes.map(n => ({ ...n, midi: n.midi + shift }));

  const changes = [];
  if (shift !== 0) {
    const dir = shift > 0 ? 'up' : 'down';
    const abs = Math.abs(shift);
    changes.push(
      abs % 12 === 0
        ? 'transposed ' + (abs / 12) + ' octave' + (abs === 12 ? '' : 's') + ' ' + dir
        : 'shifted ' + abs + ' semitone' + (abs === 1 ? '' : 's') + ' ' + dir + " to fit the instrument's playable notes"
    );
  }
  if (chords.chordCount > 0) {
    changes.push('reduced ' + chords.chordCount + ' chord' + (chords.chordCount === 1 ? '' : 's') + ' to their top note');
  }

  return {
    notes: fittedNotes,
    shiftSemitones: shift,
    changed: shift !== 0,
    changes,
    unplayable: best.details
  };
}

// ---------------------------------------------------------------------------
// segment
// ---------------------------------------------------------------------------

// beatTicks/barTicks: the OPENING metre only (song.metre), used wherever a
// caller needs one flat tick-per-beat number for the whole song (buildLessonPlan's
// phraseDifficulty call below). segment() itself must NOT use these once a
// song carries metreChanges -- see barBoundariesThrough/beatTicksAt.
function beatTicks(song) {
  return song.ticksPerQuarter * (4 / song.metre.den);
}

function barTicks(song) {
  return song.metre.num * beatTicks(song);
}

// The beat length (ticks) of whichever metre is in force at `tick` --
// song.metre until the first song.metreChanges entry at or before `tick`,
// then that entry's own num/den, and so on. Mirrors model.js's private
// metreSegmentsOf() but kept local here (BC-12) rather than exported from
// model.js, since lesson.js is the only caller that needs "beat" rather
// than "bar" granularity.
function beatTicksAt(song, tick) {
  let metre = song.metre;
  for (const change of song.metreChanges || []) {
    if (change.tick <= tick) metre = change;
    else break;
  }
  return song.ticksPerQuarter * (4 / metre.den);
}

// Real bar boundaries (model.js's barsOf(), the one source of truth honoring
// metreChanges) truncated to just past `lastEnd` -- segment() only needs
// bars the part's own notes actually reach, not the whole song's boundaries
// when another part runs longer. Always has >=2 entries (barsOf's own
// guarantee), so boundaries.length - 1 is always a valid bar count.
function barBoundariesThrough(song, lastEnd) {
  const all = barsOf(song);
  const boundaries = [all[0]];
  for (let i = 1; i < all.length; i++) {
    boundaries.push(all[i]);
    if (all[i] >= lastEnd) break;
  }
  return boundaries;
}

// Which bar (index into a boundaries array from barBoundariesThrough) tick
// `tick` falls in.
function barIndexAt(boundaries, tick) {
  for (let i = 0; i < boundaries.length - 1; i++) {
    if (tick < boundaries[i + 1]) return i;
  }
  return boundaries.length - 2;
}

export function segment(song, partId) {
  const part = getPart(song, partId);
  const notes = part.notes;
  if (notes.length === 0) return [];

  const MAX_PHRASE_BARS = 4;

  const lastEnd = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  const boundaries = barBoundariesThrough(song, lastEnd);
  const totalBars = boundaries.length - 1;

  const breaksAfterBar = new Set();
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const end = n.start + n.dur;
    const next = notes[i + 1];
    // The beat in force AT this note -- a long-note/rest-break judged in the
    // wrong metre's beat length is as wrong as a boundary on the wrong tick.
    const beat = beatTicksAt(song, n.start);
    const LONG_REST = beat; // a full beat of silence is a natural breath
    const LONG_NOTE = beat * 2; // a note held two beats or more is a natural resting point
    const isLongNote = n.dur >= LONG_NOTE;
    const gapToNext = next ? next.start - end : Infinity;
    const isRestBreak = gapToNext >= LONG_REST;
    if (isLongNote || isRestBreak) {
      breaksAfterBar.add(barIndexAt(boundaries, end - 1));
    }
  }

  const phrases = [];
  let phraseStartBar = 0;
  for (let bar = 0; bar < totalBars; bar++) {
    const barsInPhrase = bar - phraseStartBar + 1;
    const isLastBar = bar === totalBars - 1;
    if (isLastBar || barsInPhrase >= MAX_PHRASE_BARS || breaksAfterBar.has(bar)) {
      const from = boundaries[phraseStartBar];
      const to = boundaries[bar + 1];
      phrases.push({
        bars: [phraseStartBar, bar],
        startTick: from,
        endTick: to,
        notes: notes.filter(n => n.start >= from && n.start < to)
      });
      phraseStartBar = bar + 1;
    }
  }
  return phrases;
}

// ---------------------------------------------------------------------------
// buildLessonPlan
// ---------------------------------------------------------------------------

const LADDER_FRACTIONS = [0.6, 0.75, 0.9, 1.0];

// Unit E3: on a sustaining instrument (src/audio/voices.js recipeForFamily
// === 'sustain' -- bowed, wind, free-reed, voice) a note is not "played"
// just by starting on the right pitch: it has to be HELD, and it can drift
// out of tune the whole time it sounds, neither of which a plucked/struck/
// brass instrument's attack-only judging can even measure (practice.js's
// durationScore/meanAbsCents stay null unless the capture reports durSec/
// cents -- see src/ui/songs.js). So only sustaining families gain these two
// extra pass conditions; every other family's passRule is untouched.
// Thresholds are a flat first pass (not scaled by tempo-ladder rung or
// level) -- the plan calls stricter-at-higher-rungs optional, and a flat
// number is the simplest thing that could work; revisit with real usage.
export const HOLD_MIN_DURATION_SCORE = 0.6; // at least 6 of 10 matched notes must land in practice.js's own default 0.6-1.5x duration-ratio band -- neither a stab nor an overheld drone should read as "held it"
export const TUNE_MAX_MEAN_ABS_CENTS = 40; // mean pitch error under 40 cents, comfortably inside a semitone (100 cents) with room to spare -- close to the +/-45 cents app.js's own live-tuner drill (src/app.js:1055) already treats as "in tune"

// Adds the two sustain-only pass conditions to `passRule` when `instrument`
// belongs to a sustaining family; returns `passRule` completely unchanged
// (same object, same keys) otherwise -- so a non-sustaining instrument's
// plan is byte-identical to what buildLessonPlan produced before this unit.
function sustainRules(instrument, passRule) {
  if (!passRule) return passRule;
  if (recipeForFamily(instrument.family) !== 'sustain') return passRule;
  return { ...passRule, minDurationScore: HOLD_MIN_DURATION_SCORE, maxMeanAbsCents: TUNE_MAX_MEAN_ABS_CENTS };
}

function hitRateFor(level, base) {
  const bonus = Math.min(Math.max((level || 1) - 1, 0), 5) * 0.02;
  return Math.min(0.95, Math.round((base + bonus) * 1000) / 1000);
}

export function buildLessonPlan(song, partId, instrument, opts = {}) {
  const level = opts.level || 1;
  const fit = fitToInstrument(song, partId, instrument);
  // fit.notes keeps every input note (fitToInstrument's own contract); a
  // practice step must not, or a note flagged unplayable in fit.unplayable
  // (see songs.js's "will be skipped" warning) would still show up as
  // something the learner has to hit to pass. Drop those by `index`, the
  // position each unplayable entry shares with its note in fit.notes --
  // robust to two notes at the same start/pitch, which start/midi matching
  // is not.
  const unplayableIndices = new Set(fit.unplayable.map(u => u.index));
  const playableNotes = fit.notes.filter((n, index) => !unplayableIndices.has(index));
  const fittedSong = {
    ...song,
    parts: song.parts.map(p => (p.id === partId ? { ...p, notes: playableNotes } : p))
  };
  const phrases = segment(fittedSong, partId);
  // song.bpm is a single flat tempo -- a song with a tempoMap (see
  // export-midi.js:91, which DOES honour it) speeding up or slowing down
  // mid-piece plays every step at the wrong speed past the first change.
  // Out of scope here (BC-12 is metre, not tempo); left as a named gap.
  const bpm = song.bpm;
  const slowBpm = Math.round(bpm * 0.55);

  const bt = beatTicks(fittedSong);

  const steps = [];
  phrases.forEach((phrase, pi) => {
    const notes = phrase.notes;
    // originTick: the phrase's segment start (a bar line), the zero of the
    // one phrase-local clock playback, capture and judging share
    // (src/ui/songs/practice.js phraseSec) -- NOT notes[0].start, which
    // would drop a pickup rest before the first note.
    const originTick = phrase.startTick;
    // Difficulty (plan unit "phrase difficulty on steps"): one score per
    // phrase, shared by every per-phrase step kind so the learner sees the
    // same "Easy/Medium/Hard" word from the first listen through the top of
    // the tempo ladder. Chain and whole-piece steps span more than one
    // phrase and are left without a `difficulty` -- a single phrase's score
    // would misrepresent them.
    const difficulty = phraseDifficulty(phrase, { beatTicks: bt, key: song.key }).score;
    steps.push({ kind: 'listen', phraseIndex: pi, bars: phrase.bars, originTick, bpm, notes, passRule: null, difficulty });
    steps.push({
      kind: 'rhythm', phraseIndex: pi, bars: phrase.bars, originTick, bpm, notes, difficulty,
      // maxExtras: 0 -- a wrong note struck alongside a chord (practice.js
      // judgeAttempt's extras) never lowers hitRate, so without this every
      // other rule here could still pass around it; see passesRule().
      passRule: { hitRate: hitRateFor(level, 0.8), maxMeanErrorMs: 120, maxExtras: 0 }
    });
    steps.push({
      kind: 'pitches', phraseIndex: pi, bars: phrase.bars, originTick, bpm: 0, notes, difficulty,
      passRule: sustainRules(instrument, { hitRate: hitRateFor(level, 0.8), maxMeanErrorMs: null, maxExtras: 0 })
    });
    steps.push({
      kind: 'phrase-slow', phraseIndex: pi, bars: phrase.bars, originTick, bpm: slowBpm, notes, difficulty,
      passRule: sustainRules(instrument, { hitRate: hitRateFor(level, 0.8), maxMeanErrorMs: 150, maxExtras: 0 })
    });
    LADDER_FRACTIONS.forEach(fraction => {
      steps.push({
        kind: 'tempo-ladder', phraseIndex: pi, bars: phrase.bars, originTick, bpm: Math.round(bpm * fraction), notes, difficulty,
        passRule: sustainRules(instrument, { hitRate: hitRateFor(level, 0.85), maxMeanErrorMs: 100, maxExtras: 0 })
      });
    });
  });

  if (phrases.length > 1) {
    for (let upTo = 1; upTo < phrases.length; upTo++) {
      const chained = phrases.slice(0, upTo + 1);
      steps.push({
        kind: 'chain',
        phraseIndex: upTo,
        bars: [chained[0].bars[0], chained[chained.length - 1].bars[1]],
        originTick: chained[0].startTick,
        bpm,
        notes: chained.flatMap(p => p.notes),
        passRule: sustainRules(instrument, { hitRate: hitRateFor(level, 0.8), maxMeanErrorMs: 120, maxExtras: 0 })
      });
    }
  }

  if (phrases.length > 0) {
    steps.push({
      kind: 'whole',
      phraseIndex: null,
      bars: [phrases[0].bars[0], phrases[phrases.length - 1].bars[1]],
      originTick: phrases[0].startTick,
      bpm,
      notes: playableNotes,
      passRule: sustainRules(instrument, { hitRate: hitRateFor(level, 0.8), maxMeanErrorMs: 120, maxExtras: 0 })
    });
  }

  return { songId: song.id, partId, instrumentId: instrument.id, level, fit, steps };
}

// ---------------------------------------------------------------------------
// nextStep
// ---------------------------------------------------------------------------

// Every trailing result for this step, in the current unbroken streak on it
// (any mix of pass/fail), used to tell a clean first try from a pass-after-retry.
function attemptsOnCurrentStep(results, stepIndex) {
  let count = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i].stepIndex !== stepIndex) break;
    count++;
  }
  return count;
}

// Trailing consecutive FAILURES on this exact step.
function trailingFails(results, stepIndex) {
  let count = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i].stepIndex !== stepIndex || results[i].passed) break;
    count++;
  }
  return count;
}

export function nextStep(plan, results) {
  const steps = plan.steps;
  if (!results || results.length === 0) return steps.length > 0 ? 0 : 0;

  const last = results[results.length - 1];
  const lastIndex = last.stepIndex;

  if (last.passed) {
    const attemptsOnStep = attemptsOnCurrentStep(results, lastIndex);
    let next = lastIndex + 1;
    const cur = steps[lastIndex];
    const after = steps[next];
    const skip = steps[next + 1];
    if (
      attemptsOnStep === 1 &&
      cur && cur.kind === 'tempo-ladder' &&
      after && after.kind === 'tempo-ladder' && after.phraseIndex === cur.phraseIndex &&
      skip && skip.kind === 'tempo-ladder' && skip.phraseIndex === cur.phraseIndex
    ) {
      next += 1; // clean first try: skip the very next rung
    }
    return next >= steps.length ? steps.length : next;
  }

  // failed: repeat, unless this is the second consecutive miss on a tempo
  // ladder rung, in which case drop back to the previous (slower) rung.
  const consecutiveFails = trailingFails(results, lastIndex);
  const cur = steps[lastIndex];
  if (consecutiveFails >= 2 && cur && cur.kind === 'tempo-ladder') {
    for (let i = lastIndex - 1; i >= 0; i--) {
      if (steps[i].phraseIndex !== cur.phraseIndex) break;
      if (steps[i].kind === 'tempo-ladder') return i;
    }
  }
  return lastIndex;
}

// ---------------------------------------------------------------------------
// creditFor
// ---------------------------------------------------------------------------

// `matches`, when given (src/ui/songs/practice.js judgeAttempt()'s
// result.matches), scores each mastery key by that NOTE's own outcome
// (hit = ok && pitchOk !== false -- a clap onset with no pitch, ok:true/
// pitchOk:false, is not evidence the pitch was right) instead of the whole
// step's pass/fail: a step that failed only because ONE note was missed
// should not mark every other, correctly-played note as missed too, and a
// step that happened to pass should not credit a note it never actually
// got right. A midi key that appears more than once (a repeated note)
// counts as hit only if EVERY occurrence hit.
// With no `matches` (older callers, or a step judgeAttempt never ran
// per-note matching for), falls back to the original one-outcome-for-the-
// whole-step behaviour.
export function creditFor(stepResult) {
  const { step, passed, elapsedMs, judgedCount, matches } = stepResult;
  const judged = typeof judgedCount === 'number' ? judgedCount : step.notes.length;
  const minutes = Math.round(((elapsedMs || 0) / 60000) * 100) / 100;
  let masteryKeys;
  if (Array.isArray(matches)) {
    const perKey = new Map();
    matches.forEach(m => {
      if (!m || !m.note || m.note.midi == null) return;
      const key = 'midi:' + m.note.midi, hit = !!(m.ok && m.pitchOk !== false);
      perKey.set(key, (perKey.has(key) ? perKey.get(key) : true) && hit);
    });
    masteryKeys = Array.from(perKey, ([key, hit]) => ({ key, hit }));
  } else {
    const seenKeys = new Set(step.notes.map(n => 'midi:' + n.midi));
    masteryKeys = Array.from(seenKeys).map(key => ({ key, hit: !!passed }));
  }
  return {
    judged,
    ok: passed ? judged : 0,
    minutes,
    masteryKeys
  };
}
