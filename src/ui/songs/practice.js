// Pure judging for one song-practice step (src/song/lesson.js
// buildLessonPlan): compares what a learner actually played against what
// the step expected, and decides pass/fail against the step's passRule.
// No DOM, no AudioContext, no clock reads — every timestamp is a parameter,
// so this runs under plain `node --test` and the UI layer (src/ui/songs.js)
// supplies real clocks and real detected notes.

import { judgePitch } from '../../core/judge.js';

function ticksToSec(ticks, bpm, ticksPerQuarter) {
  return (ticks / ticksPerQuarter) * (60 / bpm);
}

// expectedNotes: [{ start, dur, midi, velocity? }] in ticks (a step's
// `notes`, already fitted to the instrument by buildLessonPlan/fitToInstrument).
// playedEvents: [{ midi, atSec, durSec?, cents?, velocity? }], in the order
// they were detected, atSec measured from the moment the learner was told
// to start playing. durSec/cents/velocity are optional — nothing upstream
// supplies them yet (the mic pipeline only reports pitch and onset time), so
// every field they feed (durRatio, cents, velocityError, meanAbsCents,
// durationScore, dynamicsScore) stays null until a caller starts passing
// them, and every existing field is computed exactly as before.
// opts.timed: false for the "pitches" step kind (out of time; matched by
// order only, no timing error computed) — every other kind is timed.
// opts.policy: the instrument's octave policy (src/core/judge.js), so e.g.
// a singer's octave is never marked wrong.
// opts.durationTolerance: { min, max } durRatio band counted as "held about
// right" for durationScore (default 0.6..1.5 — a note held clearly too short
// or too long should not read as in tune/in time but wrong duration).
// opts.velocityTolerance: max |velocityError| (MIDI 0-127 units) counted as
// "about as loud as asked" for dynamicsScore (default 24 — roughly one
// dynamic step; no spec value was given, chosen as a first pass).
export function judgeAttempt(expectedNotes, playedEvents, opts = {}) {
  const {
    bpm,
    ticksPerQuarter = 480,
    policy = 'exact',
    timed = true,
    durationTolerance = { min: 0.6, max: 1.5 },
    velocityTolerance = 24,
  } = opts;
  const notes = expectedNotes || [];
  const played = playedEvents || [];
  const matches = [];
  let cursor = 0;
  for (const note of notes) {
    const expectedAt = timed ? ticksToSec(note.start, bpm, ticksPerQuarter) : null;
    let foundAt = -1;
    for (let i = cursor; i < played.length; i++) {
      if (judgePitch({ heardMidi: played[i].midi, targetMidi: note.midi, policy }).ok) {
        foundAt = i;
        break;
      }
    }
    if (foundAt === -1) {
      matches.push({ note, played: null, ok: false, errorMs: null, durRatio: null, cents: null, velocityError: null });
      continue;
    }
    const hit = played[foundAt];
    const errorMs = timed ? (hit.atSec - expectedAt) * 1000 : null;
    // durRatio: how long the note was actually held vs. how long it was
    // written for. Only computable when the caller reports a played
    // duration (durSec) — the mic pipeline does not, today.
    let durRatio = null;
    if (hit.durSec != null && note.dur != null) {
      const expectedDurSec = ticksToSec(note.dur, bpm, ticksPerQuarter);
      durRatio = expectedDurSec > 0 ? hit.durSec / expectedDurSec : null;
    }
    const cents = hit.cents != null ? hit.cents : null;
    const velocityError = hit.velocity != null && note.velocity != null ? hit.velocity - note.velocity : null;
    matches.push({ note, played: hit, ok: true, errorMs, durRatio, cents, velocityError });
    cursor = foundAt + 1;
  }
  const hits = matches.filter((m) => m.ok);
  const hitRate = notes.length ? hits.length / notes.length : 0;
  const errored = hits.map((m) => m.errorMs).filter((e) => e !== null).map(Math.abs);
  const meanErrorMs = errored.length ? errored.reduce((a, b) => a + b, 0) / errored.length : null;
  const centsHits = hits.map((m) => m.cents).filter((c) => c !== null);
  const absCents = centsHits.map(Math.abs);
  const meanAbsCents = absCents.length ? absCents.reduce((a, b) => a + b, 0) / absCents.length : null;
  // meanCents: the SIGNED mean (sharp positive, flat negative), unlike
  // meanAbsCents above -- passesRule() judges the absolute value (a phrase
  // that wanders equally sharp and flat is not "in tune" just because the
  // errors cancel out), but the feedback line below needs a direction to
  // tell the learner which way to correct.
  const meanCents = centsHits.length ? centsHits.reduce((a, b) => a + b, 0) / centsHits.length : null;
  const durRatios = hits.map((m) => m.durRatio).filter((d) => d !== null);
  const durationScore = durRatios.length
    ? durRatios.filter((d) => d >= durationTolerance.min && d <= durationTolerance.max).length / durRatios.length
    : null;
  // dynamicsScore only exists when the phrase itself carries velocity
  // targets — a song with no dynamics markings has nothing to judge here.
  const notesHaveVelocity = notes.some((n) => n.velocity != null);
  const velocityErrors = hits.map((m) => m.velocityError).filter((v) => v !== null);
  const dynamicsScore = notesHaveVelocity && velocityErrors.length
    ? velocityErrors.filter((v) => Math.abs(v) <= velocityTolerance).length / velocityErrors.length
    : notesHaveVelocity ? null : null;
  return {
    matches,
    judgedCount: notes.length,
    hitCount: hits.length,
    hitRate,
    meanErrorMs,
    meanAbsCents,
    meanCents,
    durationScore,
    dynamicsScore,
  };
}

// Whether a judgeAttempt() result satisfies a step's passRule. A null
// passRule (the "listen" step kind) always passes — there is nothing to
// judge, the learner just heard the phrase.
export function passesRule(result, passRule) {
  if (!passRule) return true;
  if (result.hitRate < passRule.hitRate) return false;
  if (passRule.maxMeanErrorMs != null) {
    if (result.meanErrorMs == null) return result.judgedCount === 0;
    if (result.meanErrorMs > passRule.maxMeanErrorMs) return false;
  }
  if (passRule.maxMeanAbsCents != null && result.meanAbsCents != null) {
    if (result.meanAbsCents > passRule.maxMeanAbsCents) return false;
  }
  if (passRule.minDurationScore != null && result.durationScore != null) {
    if (result.durationScore < passRule.minDurationScore) return false;
  }
  return true;
}

// Plain-word feedback for a FAILED step that fell down ONLY on hold or tune
// -- everything else about it (hit rate, timing) was fine, so telling the
// learner the one concrete thing to fix beats the generic "try that again"
// src/ui/songs.js falls back to otherwise. Returns null when there is no
// hold/tune rule to judge, or when hit rate or timing is what actually
// failed (those keep the existing generic message -- singling out hold/tune
// there would be misleading).
export function holdTuneFeedback(result, passRule) {
  if (!passRule) return null;
  if (result.hitRate < passRule.hitRate) return null;
  if (passRule.maxMeanErrorMs != null) {
    if (result.meanErrorMs == null) { if (result.judgedCount !== 0) return null; }
    else if (result.meanErrorMs > passRule.maxMeanErrorMs) return null;
  }
  const holdFailed = passRule.minDurationScore != null && result.durationScore != null
    && result.durationScore < passRule.minDurationScore;
  const tuneFailed = passRule.maxMeanAbsCents != null && result.meanAbsCents != null
    && result.meanAbsCents > passRule.maxMeanAbsCents;
  if (!holdFailed && !tuneFailed) return null;
  if (holdFailed && tuneFailed) return 'Hold each note a little longer, right in the middle of the pitch.';
  if (holdFailed) return 'Hold each note a little longer.';
  const sharp = result.meanCents == null || result.meanCents >= 0;
  return sharp
    ? 'A little sharp — aim for the middle of the note.'
    : 'A little flat — aim for the middle of the note.';
}
