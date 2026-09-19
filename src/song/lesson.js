import { BLOW_STEPS, DRAW_STEPS } from '../instruments/how/harmonica.js';

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
//     Never drops a note: every input note appears in `notes` (transposed by
//     the chosen shift) and any that still cannot be played are listed in
//     `unplayable` with a reason, for the wiring pass to show the learner.
//   segment(song, partId) -> [{ bars: [fromBar, toBar], startTick, endTick, notes }]
//     Cuts the part into 1-4 bar phrases at rests, long notes, or the 4-bar
//     cap. Deterministic: same song in, same phrases out.
//   buildLessonPlan(song, partId, instrument, { level }) -> { songId, partId,
//     instrumentId, level, fit, steps }
//     steps is the ordered practice sequence: per phrase, listen -> rhythm-only
//     -> pitches-only (out of time) -> phrase at 50-60% tempo -> a tempo ladder
//     up to full speed; then, for a multi-phrase song, cumulative phrase-chain
//     steps; then one whole-piece step. Each step is plain data:
//     { kind, phraseIndex, bars: [from, to], bpm, notes, passRule }.
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

function notePlayable(shiftedMidi, instrument, availableSet) {
  if (shiftedMidi < instrument.range.low || shiftedMidi > instrument.range.high) return 'out-of-range';
  if (availableSet && !availableSet.has(shiftedMidi)) return 'not-on-instrument';
  return null;
}

export function fitToInstrument(song, partId, instrument) {
  const part = getPart(song, partId);
  const notes = part.notes;
  const availableSet = hasFixedPitchSet(instrument) ? harmonicaAvailableNotes(instrument) : null;

  if (notes.length === 0) {
    return { notes: [], shiftSemitones: 0, changed: false, changes: [], unplayable: [] };
  }

  let best = null;
  for (const shift of candidateShifts(instrument)) {
    const details = [];
    for (const n of notes) {
      const shiftedMidi = n.midi + shift;
      const reason = notePlayable(shiftedMidi, instrument, availableSet);
      if (reason) details.push({ start: n.start, dur: n.dur, originalMidi: n.midi, attemptedMidi: shiftedMidi, reason });
    }
    if (best === null || details.length < best.details.length) {
      best = { shift, details };
    }
    if (best.details.length === 0) break; // iterated friendliest-first: first perfect fit wins
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

function beatTicks(song) {
  return song.ticksPerQuarter * (4 / song.metre.den);
}

function barTicks(song) {
  return song.metre.num * beatTicks(song);
}

export function segment(song, partId) {
  const part = getPart(song, partId);
  const notes = part.notes;
  if (notes.length === 0) return [];

  const bt = barTicks(song);
  const beat = beatTicks(song);
  const LONG_REST = beat; // a full beat of silence is a natural breath
  const LONG_NOTE = beat * 2; // a note held two beats or more is a natural resting point
  const MAX_PHRASE_BARS = 4;

  const lastEnd = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  const totalBars = Math.max(1, Math.ceil(lastEnd / bt));

  const breaksAfterBar = new Set();
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const end = n.start + n.dur;
    const next = notes[i + 1];
    const isLongNote = n.dur >= LONG_NOTE;
    const gapToNext = next ? next.start - end : Infinity;
    const isRestBreak = gapToNext >= LONG_REST;
    if (isLongNote || isRestBreak) {
      breaksAfterBar.add(Math.floor((end - 1) / bt));
    }
  }

  const phrases = [];
  let phraseStartBar = 0;
  for (let bar = 0; bar < totalBars; bar++) {
    const barsInPhrase = bar - phraseStartBar + 1;
    const isLastBar = bar === totalBars - 1;
    if (isLastBar || barsInPhrase >= MAX_PHRASE_BARS || breaksAfterBar.has(bar)) {
      const from = phraseStartBar * bt;
      const to = (bar + 1) * bt;
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

function hitRateFor(level, base) {
  const bonus = Math.min(Math.max((level || 1) - 1, 0), 5) * 0.02;
  return Math.min(0.95, Math.round((base + bonus) * 1000) / 1000);
}

export function buildLessonPlan(song, partId, instrument, opts = {}) {
  const level = opts.level || 1;
  const fit = fitToInstrument(song, partId, instrument);
  const fittedSong = {
    ...song,
    parts: song.parts.map(p => (p.id === partId ? { ...p, notes: fit.notes } : p))
  };
  const phrases = segment(fittedSong, partId);
  const bpm = song.bpm;
  const slowBpm = Math.round(bpm * 0.55);

  const steps = [];
  phrases.forEach((phrase, pi) => {
    const notes = phrase.notes;
    steps.push({ kind: 'listen', phraseIndex: pi, bars: phrase.bars, bpm, notes, passRule: null });
    steps.push({
      kind: 'rhythm', phraseIndex: pi, bars: phrase.bars, bpm, notes,
      passRule: { hitRate: hitRateFor(level, 0.8), maxMeanErrorMs: 120 }
    });
    steps.push({
      kind: 'pitches', phraseIndex: pi, bars: phrase.bars, bpm: 0, notes,
      passRule: { hitRate: hitRateFor(level, 0.8), maxMeanErrorMs: null }
    });
    steps.push({
      kind: 'phrase-slow', phraseIndex: pi, bars: phrase.bars, bpm: slowBpm, notes,
      passRule: { hitRate: hitRateFor(level, 0.8), maxMeanErrorMs: 150 }
    });
    LADDER_FRACTIONS.forEach(fraction => {
      steps.push({
        kind: 'tempo-ladder', phraseIndex: pi, bars: phrase.bars, bpm: Math.round(bpm * fraction), notes,
        passRule: { hitRate: hitRateFor(level, 0.85), maxMeanErrorMs: 100 }
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
        bpm,
        notes: chained.flatMap(p => p.notes),
        passRule: { hitRate: hitRateFor(level, 0.8), maxMeanErrorMs: 120 }
      });
    }
  }

  if (phrases.length > 0) {
    steps.push({
      kind: 'whole',
      phraseIndex: null,
      bars: [phrases[0].bars[0], phrases[phrases.length - 1].bars[1]],
      bpm,
      notes: fit.notes,
      passRule: { hitRate: hitRateFor(level, 0.8), maxMeanErrorMs: 120 }
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

export function creditFor(stepResult) {
  const { step, passed, elapsedMs, judgedCount } = stepResult;
  const judged = typeof judgedCount === 'number' ? judgedCount : step.notes.length;
  const minutes = Math.round(((elapsedMs || 0) / 60000) * 100) / 100;
  const seenKeys = new Set(step.notes.map(n => 'midi:' + n.midi));
  const masteryKeys = Array.from(seenKeys).map(key => ({ key, hit: !!passed }));
  return {
    judged,
    ok: passed ? judged : 0,
    minutes,
    masteryKeys
  };
}
